// SPDX-License-Identifier: Apache-2.0
import type { CapturedPosition, MinorUnits, TrustLabel } from "@sik/dtc-kit-core";
import { AllocationRefused, allocateConsolidatedCredit } from "./allocate.ts";
import type { AllocationInput, AllocationPlan, RatePerToken, ReconBreak, ReconciliationReport } from "./types.ts";

/** Expected credit for a token count at a published rate, rounded half-up to a minor unit. */
export function expectedCredit(tokens: bigint, rate: RatePerToken): MinorUnits {
  if (rate.denominator <= 0n) throw new Error("rate denominator must be positive");
  return (2n * tokens * rate.numerator + rate.denominator) / (2n * rate.denominator);
}

/** One row of DTC's Balance export, as far as the help pages describe it (columns not recorded in the notes). */
export interface DtcBalanceRow {
  walletAddress: string;
  tokens: bigint;
}

export interface PositionDiff {
  address: string;
  ours: bigint;
  theirs: bigint;
}

/** Wallets whose token count differs between our capture and DTC's export (missing counts as 0), sorted by address. */
export function diffPositions(ours: readonly CapturedPosition[], theirs: readonly DtcBalanceRow[]): PositionDiff[] {
  const a = new Map<string, bigint>();
  const b = new Map<string, bigint>();
  for (const p of ours) a.set(p.address, (a.get(p.address) ?? 0n) + p.tokens);
  for (const r of theirs) b.set(r.walletAddress, (b.get(r.walletAddress) ?? 0n) + r.tokens);
  return [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .map((address) => ({ address, ours: a.get(address) ?? 0n, theirs: b.get(address) ?? 0n }))
    .filter((d) => d.ours !== d.theirs);
}

export interface ReconcileOptions {
  /** DTC's published rate for the event; enables CREDIT_MISMATCH. */
  rate?: RatePerToken;
  /** Total supply according to the snapshot, and from an independent read; enables SNAPSHOT_SUPPLY_MISMATCH. */
  snapshotSupply?: bigint;
  independentSupply?: bigint;
  /** DTC's capture instant and the instant the snapshot represents; enables CAPTURE_TIME_MISMATCH. */
  captureAt?: string;
  snapshotAt?: string;
  trust: TrustLabel;
}

/**
 * Compare (a) our record-date positions with DTC's balance export, (b) the credit with the expected credit,
 * (c) snapshot supply with an independent supply read, (d) the snapshot instant with DTC's capture instant;
 * allocate only if every check passes (SPEC 6.2, DTC-034). Produces breaks; never "fixes" them.
 */
export function reconcile(input: AllocationInput, dtcBalances: readonly DtcBalanceRow[], opts: ReconcileOptions): ReconciliationReport {
  const breaks: ReconBreak[] = [];
  const totalTokens = input.positions.reduce((s, p) => s + p.tokens, 0n);
  if (opts.rate) {
    const exp = expectedCredit(totalTokens, opts.rate);
    if (exp !== input.credit.amount) {
      breaks.push({ code: "CREDIT_MISMATCH", detail: `credit ${input.credit.amount} differs from ${totalTokens} tokens x rate`, expected: exp.toString(), actual: input.credit.amount.toString() });
    }
  }
  for (const d of diffPositions(input.positions, dtcBalances)) {
    breaks.push({ code: "POSITION_MISMATCH", detail: `our capture ${d.ours}, DTC export ${d.theirs}`, wallet: d.address, expected: d.theirs.toString(), actual: d.ours.toString() });
  }
  if (opts.snapshotSupply !== undefined && opts.independentSupply !== undefined && opts.snapshotSupply !== opts.independentSupply) {
    breaks.push({ code: "SNAPSHOT_SUPPLY_MISMATCH", detail: "snapshot supply differs from the independent supply read", expected: opts.independentSupply.toString(), actual: opts.snapshotSupply.toString() });
  }
  if (opts.captureAt !== undefined && opts.snapshotAt !== undefined && Date.parse(opts.captureAt) !== Date.parse(opts.snapshotAt)) {
    breaks.push({ code: "CAPTURE_TIME_MISMATCH", detail: "snapshot is not at DTC's capture instant", expected: opts.captureAt, actual: opts.snapshotAt });
  }
  let plan: AllocationPlan | undefined;
  try {
    plan = allocateConsolidatedCredit(input);
  } catch (e) {
    if (!(e instanceof AllocationRefused)) throw e;
    if (e.code === "UNMAPPED_WALLET") breaks.push({ code: "UNMAPPED_WALLET", detail: e.message, wallet: e.subject });
    else if (e.code === "CLIENT_ID_UNKNOWN") breaks.push({ code: "CLIENT_ID_UNKNOWN", detail: e.message, subLedger: e.subject });
    else breaks.push({ code: "CREDIT_MISMATCH", detail: e.message, expected: "0", actual: input.credit.amount.toString() });
  }
  const clean = breaks.length === 0 && plan !== undefined && plan.lines.reduce((s, l) => s + l.amount, 0n) === input.credit.amount;
  return { eventId: input.credit.eventId, ...(clean && plan ? { plan } : {}), breaks, clean, trust: opts.trust };
}
