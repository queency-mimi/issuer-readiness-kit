// SPDX-License-Identifier: Apache-2.0
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { CONTROL_ROW, REGISTERED_ONLY_ROW, TAXONOMY_ROW, isControlState, restrictionFor } from "./control-state.ts";
import { parseHhMm, zonedParts } from "./time.ts";
import { rowValue, trustLabel } from "./trust.ts";
import type { IsoInstant, LedgerId, Tokens, TrustLabel } from "./types.ts";
import type { WalletRecord } from "./wallet-registration.ts";

const HOURS_ROW = "operations.transfer-and-processing-hours";
const WHOLE_ROW = "token.whole-tokens-only";

/**
 * Reason codes with the profile rows they depend on, in SPEC 2.2 order. Rows are data: if DTCC publishes a
 * different rule the row changes, the code does not. `rows` decides the trust label of any result using the code.
 */
export const PRECHECK_REASONS = {
  DEST_NOT_REGISTERED: { rows: [REGISTERED_ONLY_ROW] },
  DEST_FAILED_COMPLIANCE: { rows: [TAXONOMY_ROW] },
  DEST_STATUS_NOT_COMPLETED: { rows: [TAXONOMY_ROW] },
  SOURCE_RESTRICTED: { rows: [CONTROL_ROW] },
  DEST_RESTRICTED: { rows: [CONTROL_ROW] },
  FRACTIONAL_QUANTITY: { rows: [WHOLE_ROW] },
  CROSS_NETWORK_OUTSIDE_HOURS: { rows: [HOURS_ROW] },
  CROSS_NETWORK_NO_BRIDGE: { rows: [HOURS_ROW] },
} as const satisfies Record<string, { rows: readonly string[] }>;
export type PrecheckReason = keyof typeof PRECHECK_REASONS;

export interface TransferIntent {
  from: WalletRecord;
  /** `undefined` means the destination address is not in the registry at all. */
  to: WalletRecord | undefined;
  /** Destination ledger when it differs from the source ledger (cross-network burn/mint). */
  toLedger?: LedgerId;
  /** Whole tokens. A non-integer is unrepresentable, so fractional input arrives via `rawQuantity`. */
  tokens: Tokens;
  /** Original text from the caller, to detect "1.5" before it is coerced. */
  rawQuantity?: string;
  at: IsoInstant;
}

export interface PrecheckOptions {
  /** Ledgers DTC operates a burn/mint pair between. Without it CROSS_NETWORK_NO_BRIDGE is not evaluated. */
  dtcLedgers?: readonly LedgerId[];
}

export interface PrecheckResult {
  allowed: boolean;
  reasons: PrecheckReason[];
  trust: TrustLabel;
}

/** True when a decimal string has a non-zero fractional part ("1.5" yes, "1.0" and "2" no). */
export function isFractional(raw: string): boolean {
  const m = /^\s*\d*\.(\d+)\s*$/.exec(raw);
  return m !== null && /[1-9]/.test(m[1] ?? "");
}

interface Window {
  timezone: string;
  days: string[];
  start: string;
  end: string;
}

/** Inside the processing window of row operations.transfer-and-processing-hours? Unknown row -> false. */
export function insideProcessingWindow(at: IsoInstant, profile: ResolvedProfile): boolean {
  const w = rowValue<{ processingWindow?: Window }>(profile, HOURS_ROW)?.processingWindow;
  if (!w) return false;
  const p = zonedParts(Date.parse(at), w.timezone);
  if (!w.days.includes(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  const s = parseHhMm(w.start);
  const e = parseHhMm(w.end);
  return minutes >= s.hour * 60 + s.minute && minutes < e.hour * 60 + e.minute;
}

/**
 * Chain-neutral transfer pre-check: would DTC's rules (as modelled in the profile) let this transfer happen?
 * Returns EVERY reason that applies, in SPEC 2.2 order; `trust` is the weakest status over the rows of the
 * reasons that fired, or over every row consulted when the transfer is allowed. (DTC-005)
 */
export function precheckTransfer(intent: TransferIntent, profile: ResolvedProfile, opts: PrecheckOptions = {}): PrecheckResult {
  const reasons: PrecheckReason[] = [];
  const consulted = new Set<string>([REGISTERED_ONLY_ROW, TAXONOMY_ROW, CONTROL_ROW]);
  const { from, to } = intent;
  if (!to) {
    reasons.push("DEST_NOT_REGISTERED");
  } else if (to.status === "Failed Compliance") {
    reasons.push("DEST_FAILED_COMPLIANCE");
  } else if (to.status === "Processing" || to.status === "Failed") {
    reasons.push("DEST_STATUS_NOT_COMPLETED");
  }
  if (restrictionFor(from.status, profile).blocksOutbound) reasons.push("SOURCE_RESTRICTED");
  if (to && isControlState(to.status) && restrictionFor(to.status, profile).blocksInbound) reasons.push("DEST_RESTRICTED");
  if (intent.rawQuantity !== undefined) {
    consulted.add(WHOLE_ROW);
    if (isFractional(intent.rawQuantity)) reasons.push("FRACTIONAL_QUANTITY");
  }
  if (intent.toLedger !== undefined && intent.toLedger !== from.ledger) {
    consulted.add(HOURS_ROW);
    if (!insideProcessingWindow(intent.at, profile)) reasons.push("CROSS_NETWORK_OUTSIDE_HOURS");
    if (opts.dtcLedgers && !opts.dtcLedgers.includes(intent.toLedger)) reasons.push("CROSS_NETWORK_NO_BRIDGE");
  }
  const rows = reasons.length > 0 ? reasons.flatMap((r) => [...PRECHECK_REASONS[r].rows]) : [...consulted];
  return { allowed: reasons.length === 0, reasons, trust: trustLabel(profile, rows) };
}
