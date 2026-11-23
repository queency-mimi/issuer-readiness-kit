// SPDX-License-Identifier: Apache-2.0
import type { CapturedPosition, Cusip, IsoDate, IsoInstant, LedgerId, MinorUnits, ParticipantId, Tokens, TrustLabel, WalletAddress } from "@sik/dtc-kit-core";

/** The sub-ledger that receives wallets which are not client wallets. */
export const HOUSE_SUBLEDGER = "HOUSE" as const;

/** The participant's own mapping of wallets to its books. Participant data; the kit never stores it. */
export interface WalletMapping {
  ledger: LedgerId;
  address: WalletAddress;
  kind: "internal" | "client";
  /** Required for kind "client". */
  clientId?: string;
}

export interface ParticipantBooks {
  participant: ParticipantId;
  wallets: WalletMapping[];
  clients: { clientId: string; name?: string }[];
}

/** The single cash payment DTC credits to the participant's classic account for one event. */
export interface ConsolidatedCredit {
  participant: ParticipantId;
  cusip: Cusip;
  eventId: string;
  eventKind: "interest" | "maturity";
  recordDate: IsoDate;
  payDate: IsoDate;
  amount: MinorUnits;
  currency: "USD";
  receivedAt: IsoInstant;
}

/** Rate DTC publishes for the event, as an exact fraction of minor units per token. */
export interface RatePerToken {
  numerator: bigint;
  denominator: bigint;
}

export interface AllocationInput {
  books: ParticipantBooks;
  /** Record-date holders. Produced by a HoldersSnapshot reader (see holders-source.ts) or the sandbox. */
  positions: CapturedPosition[];
  credit: ConsolidatedCredit;
  trust: TrustLabel;
}

export interface AllocationLine {
  /** clientId, or HOUSE_SUBLEDGER. */
  subLedger: string;
  tokens: Tokens;
  amount: MinorUnits;
  wallets: WalletAddress[];
}

export interface AllocationPlan {
  eventId: string;
  credit: MinorUnits;
  totalTokens: Tokens;
  /** Always "largest-remainder": floor shares, then hand out the leftover cents by largest fractional remainder, ties by sub-ledger id ascending. */
  rounding: "largest-remainder";
  lines: AllocationLine[];
  /** Wallets with tokens at capture that are absent from the participant's books. Allocation refuses to proceed while this is non-empty. */
  unmappedWallets: WalletAddress[];
  /** SHA-256 of the canonical JSON of {eventId, credit, lines}; lets two runs be compared byte for byte. */
  checksum: string;
  trust: TrustLabel;
}

export type BreakCode =
  | "CREDIT_MISMATCH"
  | "POSITION_MISMATCH"
  | "UNMAPPED_WALLET"
  | "SNAPSHOT_SUPPLY_MISMATCH"
  | "CLIENT_ID_UNKNOWN"
  | "CAPTURE_TIME_MISMATCH";

export interface ReconBreak {
  code: BreakCode;
  detail: string;
  subLedger?: string;
  wallet?: WalletAddress;
  expected?: string;
  actual?: string;
}

export interface ReconciliationReport {
  eventId: string;
  plan?: AllocationPlan;
  breaks: ReconBreak[];
  /** True only when `breaks` is empty and the plan sums to the credit. */
  clean: boolean;
  trust: TrustLabel;
}
