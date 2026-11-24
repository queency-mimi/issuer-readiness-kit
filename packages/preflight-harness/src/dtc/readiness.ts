// SPDX-License-Identifier: Apache-2.0
// DTC registered-wallet readiness evaluator (SPEC 9.3, PFH-026). The harness's own checks over a snapshot, plus
// the libraries' receive verdicts. Every DTC reason names the dtc-kit profile rows it rests on (DTC_REASON_ROWS);
// a scenario passes its rows and only reasons resting on those rows count (G-DTCC: nothing here asserts a DTCC
// requirement; rows keep their published/inferred/unknown status in every output).
import { MuxedAccount } from "@stellar/stellar-sdk";
import type { CaseInput, ReceiveVerdict, StateSnapshot } from "../types.ts";
import { DTC_STELLAR_DISCLAIMER } from "./scenarios.ts";
import type { DtcReasonCode } from "./scenarios.ts";
import { decimalToStroops } from "../adapters/canonical.ts";

export interface ReadinessResult {
  readiness: "ready" | "not-ready" | "unknown";
  /** Reasons from the harness's own asset/wallet checks (not from a competitor library). */
  dtcReasons: DtcReasonCode[];
  /** Receive verdicts from the libraries that were run, for the same input. */
  receive: ReceiveVerdict[];
  /** Every output carries this (dtc-kit profile disclaimer rule). */
  disclaimer: string;
}

/** dtc-kit profile rows (dtc-generic / dtc-stellar, version 2026-10-31) each reason rests on. */
export const DTC_REASON_ROWS: Record<DtcReasonCode, string[]> = {
  DTC_WALLET_UNFUNDED: ["wallet.address-not-validated-by-dtc"],
  DTC_TRUSTLINE_NOT_CREATED: ["distribution_control.registration-two-step"],
  DTC_TRUSTLINE_NOT_AUTHORIZED: ["distribution_control.registration-two-step"],
  DTC_WALLET_CONTROL_STATE_ACTIVE: ["wallet.control-state-semantics", "authorities.chill-freeze-mechanism"],
  DTC_ASSET_NOT_DISTRIBUTION_CONTROLLED: ["token.transfer-only-to-registered-wallets", "distribution_control.mechanism"],
  DTC_ASSET_NO_CLAWBACK: ["authorities.dtc-override-root-wallet", "authorities.force-transfer-mechanism"],
  DTC_AMOUNT_NOT_WHOLE_TOKENS: ["token.whole-tokens-only", "token.whole-token-enforcement-stellar"],
  DTC_WALLET_KIND_NOT_ESTABLISHED: ["wallet.contract-address-registrable", "wallet.stellar-address-binding"],
  DTC_RESERVE_SHORT: ["network.fee-payer"],
  DTC_IDENTITY_NOT_VERIFIED: ["token.form"],
};

/** All reasons a snapshot supports for an input, before any row filter. */
export function dtcReasonsFor(input: CaseInput, state: StateSnapshot): DtcReasonCode[] {
  const reasons: DtcReasonCode[] = [];
  const dest = input.destination;
  let wallet: string | null = null;
  if (dest.startsWith("C")) reasons.push("DTC_WALLET_KIND_NOT_ESTABLISHED");
  else if (dest.startsWith("M")) {
    reasons.push("DTC_WALLET_KIND_NOT_ESTABLISHED");
    try {
      wallet = MuxedAccount.fromAddress(dest, "0").baseAccount().accountId();
    } catch {
      wallet = null;
    }
  } else wallet = dest;

  const asset = input.asset;
  if (asset.kind === "classic") {
    const issuer = state.accounts[asset.issuer];
    if (issuer) {
      if (!issuer.flags.authRequired) reasons.push("DTC_ASSET_NOT_DISTRIBUTION_CONTROLLED");
      if (!issuer.flags.clawbackEnabled) reasons.push("DTC_ASSET_NO_CLAWBACK");
    }
    const units = decimalToStroops(input.amount);
    if (units !== null && units % 10_000_000n !== 0n) reasons.push("DTC_AMOUNT_NOT_WHOLE_TOKENS");
  }

  if (wallet && wallet in state.accounts) {
    const acct = state.accounts[wallet];
    if (acct === null || acct === undefined) reasons.push("DTC_WALLET_UNFUNDED");
    else if (asset.kind === "classic" && wallet !== asset.issuer) {
      const line = acct.trustlines.find((t) => t.asset.code === asset.code && t.asset.issuer === asset.issuer);
      if (!line) {
        reasons.push("DTC_TRUSTLINE_NOT_CREATED");
        const reserve = BigInt(state.networkParams?.baseReserveStroops ?? "5000000");
        // A new trustline adds one subentry: minimum balance = (2 + subentries + 1 + sponsoring - sponsored) * base reserve.
        const needed = BigInt(2 + acct.subentryCount + 1 + acct.numSponsoring - acct.numSponsored) * reserve;
        if (BigInt(acct.balance) < needed) reasons.push("DTC_RESERVE_SHORT");
      } else if (!line.authorized) reasons.push(line.authorizedToMaintainLiabilities ? "DTC_WALLET_CONTROL_STATE_ACTIVE" : "DTC_TRUSTLINE_NOT_AUTHORIZED");
    }
  }
  return reasons;
}

/**
 * Evaluate one wallet against the readiness rules over a snapshot plus the receive verdicts. With `rows`, only
 * reasons resting on those profile rows count. Readiness: not-ready when any counted reason (other than the
 * wallet-kind one) or any receive verdict is cannot_receive; else unknown when the wallet kind is not
 * established (its rows are unknown); else ready.
 */
export function evaluateDtcReadiness(input: CaseInput, state: StateSnapshot, receive: ReceiveVerdict[], options: { rows?: string[] } = {}): ReadinessResult {
  const rows = options.rows ? new Set(options.rows) : null;
  const dtcReasons = dtcReasonsFor(input, state).filter((r) => !rows || DTC_REASON_ROWS[r].some((row) => rows.has(row)));
  const counted = receive.filter((v) => !v.error);
  const blocked = counted.some((v) => v.verdict === "cannot_receive") || dtcReasons.some((r) => r !== "DTC_WALLET_KIND_NOT_ESTABLISHED");
  const readiness = blocked ? "not-ready" : dtcReasons.includes("DTC_WALLET_KIND_NOT_ESTABLISHED") ? "unknown" : "ready";
  return { readiness, dtcReasons, receive, disclaimer: DTC_STELLAR_DISCLAIMER };
}
