// SPDX-License-Identifier: Apache-2.0
import { Account, Address, Networks, Operation, StrKey, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";
import type { AddressRequest, CapabilityMatrix, ChainActionKind, ChainActionPlan, ChainAdapter, ChainStep, TransferRequest, Tokens } from "@sik/dtc-kit-core";
import { weakestStatus } from "@sik/dtc-kit-profile-spec/pure";
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { SEP57_MATRIX } from "./matrix.ts";

export interface StellarSep57Config {
  /** Only "testnet" and "local" are permitted until gate G-VALUE opens. */
  network: "testnet" | "local";
  tokenContractId: string;
  /** Address holding the `operator` role. The adapter never holds its key. */
  operator: string;
  profile?: ResolvedProfile;
  localPassphrase?: string;
}

const ACTION_ROWS: Record<ChainActionKind, string[]> = {
  "allowlist-add": ["distribution_control.mechanism", "token.transfer-only-to-registered-wallets", "token.form"],
  "allowlist-remove": ["distribution_control.mechanism", "token.form"],
  restrict: ["authorities.chill-freeze-mechanism", "wallet.control-state-semantics", "token.form"],
  unrestrict: ["authorities.chill-freeze-mechanism", "wallet.control-state-semantics", "token.form"],
  mint: ["authorities.dtc-initiated-mint-burn", "token.form"],
  burn: ["authorities.dtc-initiated-mint-burn", "token.form"],
  "force-transfer": ["authorities.dtc-override-root-wallet", "authorities.force-transfer-mechanism", "authorities.root-key-holder", "token.form"],
};

type Arg = { kind: "address"; v: string } | { kind: "i128"; v: bigint } | { kind: "bool"; v: boolean };

/**
 * ChainAdapter for a SEP-57 (T-REX style) token (DTC-025). Each plan is a single contract invocation signed
 * by the operator, so `atomic` is true by construction. Function names and argument order follow the SEP
 * text (sep-0057.md Draft v0.4.0, read 2026-10-31): forced_transfer(from, to, amount, operator),
 * mint(to, amount, operator), burn(user_address, amount, operator), set_address_frozen(user_address,
 * freeze, operator). Plans only: never signs (G-SECRETS); NOT yet run on testnet (DTC-026).
 */
export class StellarSep57Adapter implements ChainAdapter {
  readonly id = "stellar-sep57";
  readonly config: StellarSep57Config;

  constructor(config: StellarSep57Config) {
    if ((config.network as string) !== "testnet" && (config.network as string) !== "local") {
      throw new Error(`G-VALUE: network ${String(config.network)} is not allowed; only testnet or local`);
    }
    this.config = config;
  }

  capabilityMatrix(): CapabilityMatrix {
    return SEP57_MATRIX;
  }

  private plan(action: ChainActionKind, fn: string | undefined, args: { name: string; arg: Arg }[], extra: { caveats?: string[]; op?: string } = {}): ChainActionPlan {
    const rows = ACTION_ROWS[action];
    const step: ChainStep = {
      op: extra.op ?? fn ?? action,
      signer: this.config.operator,
      params: { contract: this.config.tokenContractId, ...Object.fromEntries(args.map((a) => [a.name, a.arg.v])) },
    };
    const caveats = ["SEP-57 behaviour in combination (freeze x forced_transfer x pause) is not specified by the SEP; not yet observed on testnet (DTC-024, DTC-026).", ...(extra.caveats ?? [])];
    const plan: ChainActionPlan = {
      adapterId: this.id,
      action,
      atomic: true,
      steps: [step],
      preconditions: [`${this.config.operator} holds the operator role on ${this.config.tokenContractId}.`],
      caveats,
      trust: this.config.profile ? weakestStatus(this.config.profile, rows) : "unknown",
      rows,
      network: this.config.network,
    };
    if (!fn) return plan;
    const addresses = [this.config.operator, this.config.tokenContractId, ...args.filter((a) => a.arg.kind === "address").map((a) => String(a.arg.v))];
    const bad = addresses.filter((a) => !StrKey.isValidEd25519PublicKey(a) && !StrKey.isValidContract(a));
    if (bad.length > 0 || !StrKey.isValidEd25519PublicKey(this.config.operator)) {
      caveats.push(`No envelope: ${bad.join(", ") || this.config.operator} is not a valid Stellar address.`);
      return plan;
    }
    const scArgs: xdr.ScVal[] = args.map(({ arg }) =>
      arg.kind === "address" ? new Address(arg.v).toScVal() : arg.kind === "i128" ? nativeToScVal(arg.v, { type: "i128" }) : nativeToScVal(arg.v, { type: "bool" }),
    );
    const passphrase = this.config.network === "testnet" ? Networks.TESTNET : (this.config.localPassphrase ?? "Standalone Network ; February 2017");
    const tx = new TransactionBuilder(new Account(this.config.operator, "0"), { fee: "100", networkPassphrase: passphrase })
      .addOperation(Operation.invokeContractFunction({ contract: this.config.tokenContractId, function: fn, args: scArgs }))
      .setTimeout(0)
      .build();
    plan.envelopeXdr = tx.toXDR();
    return plan;
  }

  private op = (v: string): { name: string; arg: Arg } => ({ name: "operator", arg: { kind: "address", v } });

  /** Identity registration is wired through the token's identity verifier; SEP-57 does not standardise it. */
  planAllowlistAdd(req: AddressRequest): ChainActionPlan {
    return this.plan("allowlist-add", undefined, [{ name: "account", arg: { kind: "address", v: req.address } }], {
      op: "identity-registry:register",
      caveats: ["The call depends on the identity registry / verifier the token is wired to (set_identity_verifier); SEP-57 does not name it, so no envelope is built."],
    });
  }

  planAllowlistRemove(req: AddressRequest): ChainActionPlan {
    return this.plan("allowlist-remove", undefined, [{ name: "account", arg: { kind: "address", v: req.address } }], {
      op: "identity-registry:remove",
      caveats: ["Identity-registry dependent, as for allowlist-add."],
    });
  }

  /** set_address_frozen(user, true, operator). Inbound-only/outbound-only is not expressible [U]. */
  planRestrict(req: AddressRequest & { inbound: boolean; outbound: boolean }): ChainActionPlan {
    const caveats = req.inbound && req.outbound ? [] : ["Whether a frozen address can still receive (inbound) is not stated in SEP-57; an outbound-only chill may not be exact."];
    return this.plan("restrict", "set_address_frozen", [{ name: "user_address", arg: { kind: "address", v: req.address } }, { name: "freeze", arg: { kind: "bool", v: true } }, this.op(this.config.operator)], { caveats });
  }

  planUnrestrict(req: AddressRequest): ChainActionPlan {
    return this.plan("unrestrict", "set_address_frozen", [{ name: "user_address", arg: { kind: "address", v: req.address } }, { name: "freeze", arg: { kind: "bool", v: false } }, this.op(this.config.operator)]);
  }

  planMint(req: AddressRequest & { tokens: Tokens }): ChainActionPlan {
    return this.plan("mint", "mint", [{ name: "to", arg: { kind: "address", v: req.address } }, { name: "amount", arg: { kind: "i128", v: req.tokens } }, this.op(this.config.operator)], {
      caveats: ["Amount is in base units; with decimals = 0 one unit is one share (DTC-022, not yet observed)."],
    });
  }

  planBurn(req: AddressRequest & { tokens: Tokens }): ChainActionPlan {
    return this.plan("burn", "burn", [{ name: "user_address", arg: { kind: "address", v: req.address } }, { name: "amount", arg: { kind: "i128", v: req.tokens } }, this.op(this.config.operator)]);
  }

  /** forced_transfer(from, to, amount, operator): one call, no holder signature. */
  planForceTransfer(req: TransferRequest): ChainActionPlan {
    return this.plan(
      "force-transfer",
      "forced_transfer",
      [{ name: "from", arg: { kind: "address", v: req.address } }, { name: "to", arg: { kind: "address", v: req.to } }, { name: "amount", arg: { kind: "i128", v: req.tokens } }, this.op(this.config.operator)],
    );
  }
}
