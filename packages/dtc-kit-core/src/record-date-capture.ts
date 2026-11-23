// SPDX-License-Identifier: Apache-2.0
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { addDays, dayOfWeek, parseIsoDate, zonedInstant } from "./time.ts";
import { trustLabel } from "./trust.ts";
import type { Cusip, IsoDate, IsoInstant, LedgerId, Tokens, TrustLabel, WalletAddress } from "./types.ts";

const CAPTURE_ROW = "corporate_actions.position-capture-8pm-et";

interface CaptureRule {
  timezone: string;
  time: string;
  maturityRecordDate?: string;
}

/** The business day before `date`: skips Saturdays, Sundays and the caller's holiday list (none embedded). */
export function previousBusinessDay(date: string, holidays: readonly string[] = []): string {
  let d = addDays(date, -1);
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6 || holidays.includes(d)) d = addDays(d, -1);
  return d;
}

/**
 * The instant DTC captures positions: the row's time (20:00) in the row's zone (America/New_York) on the
 * record date; for `maturity`, `date` is the maturity date and the capture is on the business day before it
 * (holidays supplied by the caller). DST-safe (Intl, no fixed offset). Row
 * corporate_actions.position-capture-8pm-et is `inferred`; the result carries that label. (DTC-009)
 */
export function captureInstant(
  date: IsoDate,
  kind: "interest" | "maturity",
  profile: ResolvedProfile,
  opts: { holidays?: readonly string[] } = {},
): { at: IsoInstant; recordDate: IsoDate; trust: TrustLabel } {
  parseIsoDate(date);
  const row = profile.rows.get(CAPTURE_ROW);
  if (!row || row.status === "unknown" || row.value === null) throw new Error(`row ${CAPTURE_ROW} is unknown: cannot compute a capture instant`);
  const rule = row.value as CaptureRule;
  const recordDate = kind === "maturity" ? previousBusinessDay(date, opts.holidays) : date;
  return { at: zonedInstant(recordDate, rule.time, rule.timezone).iso, recordDate, trust: trustLabel(profile, [CAPTURE_ROW]) };
}

/** One holder line in a capture. */
export interface CapturedPosition {
  address: WalletAddress;
  tokens: Tokens;
}

/**
 * Participant-side capture of token positions at a record date. The `ledgerSeq` and `supplyHash` fields
 * line up with the HoldersSnapshot produced by the holders-at-ledger project (contract table in
 * docs/ARCHITECTURE.md; its SPEC is authoritative, this type is NOT a redefinition of it).
 */
export interface PositionCapture {
  ledger: LedgerId;
  cusip: Cusip;
  recordDate: IsoDate;
  capturedAt: IsoInstant;
  ledgerSeq?: number;
  supplyHash?: string;
  positions: CapturedPosition[];
  trust: TrustLabel;
}

/** Source of balances at a point in time; a HoldersSnapshot reader or a sandbox registry implements it. */
export interface PositionSource {
  positionsAt(ledger: LedgerId, cusip: Cusip, at: IsoInstant): Promise<CapturedPosition[]>;
}

export async function capturePositions(
  source: PositionSource,
  args: { ledger: LedgerId; cusip: Cusip; recordDate: IsoDate; kind: "interest" | "maturity"; holidays?: readonly string[] },
  profile: ResolvedProfile,
): Promise<PositionCapture> {
  const { at, recordDate, trust } = captureInstant(args.recordDate, args.kind, profile, args.holidays ? { holidays: args.holidays } : {});
  const positions = await source.positionsAt(args.ledger, args.cusip, at);
  return { ledger: args.ledger, cusip: args.cusip, recordDate, capturedAt: at, positions, trust };
}
