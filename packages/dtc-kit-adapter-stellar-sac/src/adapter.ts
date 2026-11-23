// SPDX-License-Identifier: Apache-2.0
import { Account, Asset, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";
import type { AddressRequest, CapabilityMatrix, ChainActionKind, ChainActionPlan, ChainAdapter, ChainStep, TransferRequest, Tokens } from "@sik/dtc-kit-core";
import { weakestStatus } from "@sik/dtc-kit-profile-spec/pure";
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { SAC_MATRIX } from "./matrix.ts";

export interface StellarSacConfig {
  /** Only "testnet" and "local" are permitted until gate G-VALUE opens. */
  network: "testnet" | "local";
  assetCode: string;
  issuerAccount: string;
  /** SAC contract id, once deployed (needed for C-address holders). */
  sacContractId?: string;
  /** Profile used to label plans; without one every plan is labelled `unknown` (conservative). */
  profile?: ResolvedProfile;
  /** Passphrase for `local` networks (quickstart). Defaults to the standalone passphrase. */
  localPassphrase?: string;
}

const STANDALONE = "Standalone Network ; February 2017";

/** Profile rows each action rests on (G-DTCC): the plan's trust is the weakest of them. */
const ACTION_ROWS: Record<ChainActionKind, string[]> = {
  "allowlist-add": ["distribution_control.mechanism", "distribution_control.registration-two-step", "token.transfer-only-to-registered-wallets"],
  "allowlist-remove": ["distribution_control.mechanism", "wallet.registration-ofac-screening"],
  restrict: ["authorities.chill-freeze-mechanism", "wallet.control-state-semantics"],
  unrestrict: ["authorities.chill-freeze-mechanism", "wallet.control-state-semantics"],
  mint: ["authorities.dtc-initiated-mint-burn", "token.form"],
  burn: ["authorities.dtc-initiated-mint-burn", "token.form"],
  "force-transfer": ["authorities.dtc-override-root-wallet", "authorities.force-transfer-mechanism", "authorities.root-key-holder"],
};

/**
 * ChainAdapter for a classic asset + SAC (DTC-021).
 *
 * Planning only: methods return unsigned plans and never sign (G-SECRETS). `planForceTransfer` returns ONE
 * atomic plan with steps [clawback(from), payment(issuer -> to)] because a clawback is a burn and a
 * standalone clawback would destroy the holder's tokens if the payment failed. Each plan carries an unsigned
 * envelope built by @stellar/stellar-sdk (placeholder sequence) when every address is a valid G-address.
 */
export class StellarSacAdapter implements ChainAdapter {
  readonly id = "stellar-sac";
  readonly config: StellarSacConfig;

  constructor(config: StellarSacConfig) {
    if ((config.network as string) !== "testnet" && (config.network as string) !== "local") {
      throw new Error(`G-VALUE: network ${String(config.network)} is not allowed; only testnet or local`);
    }
    this.config = config;
  }

  capabilityMatrix(): CapabilityMatrix {
    return SAC_MATRIX;
  }

  asset(): Asset {
    return new Asset(this.config.assetCode, this.config.issuerAccount);
  }

  passphrase(): string {
    return this.config.network === "testnet" ? Networks.TESTNET : (this.config.localPassphrase ?? STANDALONE);
  }

  private plan(action: ChainActionKind, steps: ChainStep[], extra: { preconditions?: string[]; caveats?: string[] } = {}): ChainActionPlan {
    const rows = ACTION_ROWS[action];
    const caveats = [...(extra.caveats ?? [])];
    const plan: ChainActionPlan = {
      adapterId: this.id,
      action,
      atomic: true,
      steps,
      preconditions: [`Issuer ${this.config.issuerAccount} has AUTH_REQUIRED, AUTH_REVOCABLE and AUTH_CLAWBACK_ENABLED set before any holder trustline exists.`, ...(extra.preconditions ?? [])],
      caveats,
      trust: this.config.profile ? weakestStatus(this.config.profile, rows) : "unknown",
      rows,
      network: this.config.network,
    };
    const addresses = steps.flatMap((s) => Object.entries(s.params).filter(([k]) => ["from", "trustor", "destination"].includes(k)).map(([, v]) => String(v)));
    const bad = [this.config.issuerAccount, ...addresses].filter((a) => !StrKey.isValidEd25519PublicKey(a));
    if (bad.length > 0) {
      caveats.push(`No envelope: ${bad.join(", ")} is not a valid Stellar address (G...). Contract (C) holders need the SAC set_authorized call instead (DTC-028).`);
      return plan;
    }
    const tx = new TransactionBuilder(new Account(this.config.issuerAccount, "0"), { fee: "100", networkPassphrase: this.passphrase() });
    for (const op of operationsFromPlan(plan, this.asset())) tx.addOperation(op);
    plan.envelopeXdr = tx.setTimeout(0).build().toXDR();
    return plan;
  }

  private flags(trustor: string, authorized: boolean): ChainStep {
    return { op: "set_trust_line_flags", signer: this.config.issuerAccount, params: { trustor, asset: `${this.config.assetCode}:${this.config.issuerAccount}`, authorized } };
  }

  /** Steps: [set_trust_line_flags(AUTHORIZED)]; the holder's trustline must exist first (two-step registration). */
  planAllowlistAdd(req: AddressRequest): ChainActionPlan {
    return this.plan("allowlist-add", [this.flags(req.address, true)], {
      preconditions: [`Holder ${req.address} has already created a trustline to ${this.config.assetCode} (participant step; row distribution_control.registration-two-step).`],
    });
  }

  /** Steps: [set_trust_line_flags(clear AUTHORIZED)]. */
  planAllowlistRemove(req: AddressRequest): ChainActionPlan {
    return this.plan("allowlist-remove", [this.flags(req.address, false)]);
  }

  /** Chill/lock: classic trustline flags cannot block one direction only; this deauthorises both ways. */
  planRestrict(req: AddressRequest & { inbound: boolean; outbound: boolean }): ChainActionPlan {
    const caveats = req.inbound && req.outbound ? [] : ["Classic authorisation blocks both directions: an outbound-only chill cannot be expressed exactly on a classic asset (capability freeze-address: partial)."];
    return this.plan("restrict", [this.flags(req.address, false)], { caveats });
  }

  planUnrestrict(req: AddressRequest): ChainActionPlan {
    return this.plan("unrestrict", [this.flags(req.address, true)]);
  }

  /** Steps: [payment(issuer -> to)]: an issuer paying its own asset creates supply. */
  planMint(req: AddressRequest & { tokens: Tokens }): ChainActionPlan {
    return this.plan("mint", [{ op: "payment", signer: this.config.issuerAccount, params: { destination: req.address, amount: req.tokens.toString() } }], {
      caveats: ["Classic amounts have 7 decimals; whole tokens are enforced by the registry only (capability whole-token-enforcement: none)."],
    });
  }

  /** Steps: [clawback(from)]: a clawback is a burn. */
  planBurn(req: AddressRequest & { tokens: Tokens }): ChainActionPlan {
    return this.plan("burn", [{ op: "clawback", signer: this.config.issuerAccount, params: { from: req.address, amount: req.tokens.toString() } }]);
  }

  /** Steps: [clawback(from), payment(issuer -> to)] in ONE transaction, signed by the issuer only. */
  planForceTransfer(req: TransferRequest): ChainActionPlan {
    return this.plan(
      "force-transfer",
      [
        { op: "clawback", signer: this.config.issuerAccount, params: { from: req.address, amount: req.tokens.toString() } },
        { op: "payment", signer: this.config.issuerAccount, params: { destination: req.to, amount: req.tokens.toString() } },
      ],
      {
        preconditions: [`Destination ${req.to} has an authorised trustline; otherwise the payment fails and, because both operations share one transaction, so does the clawback.`],
        caveats: ["Whether DTC would accept clawback-plus-payment as its override mechanism is unknown (row authorities.force-transfer-mechanism)."],
      },
    );
  }
}

/** Rebuild stellar-sdk operations from a SAC plan (used for the envelope and by the testnet spike script). */
export function operationsFromPlan(plan: ChainActionPlan, asset: Asset): xdr.Operation[] {
  return plan.steps.map((s) => {
    switch (s.op) {
      case "set_trust_line_flags":
        return Operation.setTrustLineFlags({ trustor: String(s.params["trustor"]), asset, flags: { authorized: s.params["authorized"] === true } });
      case "payment":
        return Operation.payment({ destination: String(s.params["destination"]), asset, amount: String(s.params["amount"]) });
      case "clawback":
        return Operation.clawback({ from: String(s.params["from"]), asset, amount: String(s.params["amount"]) });
      default:
        throw new Error(`unknown SAC step ${s.op}`);
    }
  });
}
