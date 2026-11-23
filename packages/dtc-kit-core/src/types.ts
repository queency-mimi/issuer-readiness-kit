// SPDX-License-Identifier: Apache-2.0
import type { RowStatus } from "@sik/dtc-kit-profile-spec/pure";

/** Participant number as DTC assigns it (sandbox uses obviously fake numbers). */
export type ParticipantId = string;
/** Network identifier, e.g. "stellar", "canton", "besu". */
export type LedgerId = string;
/** Opaque, ledger-specific address string. DTC does not validate it (profile row wallet.address-not-validated-by-dtc). */
export type WalletAddress = string;
/** Sandbox/DTC internal wallet record id. */
export type WalletId = string;
/** CUSIP of the underlying security. */
export type Cusip = string;
/** ISO date, YYYY-MM-DD, interpreted in America/New_York unless stated. */
export type IsoDate = string;
/** ISO-8601 instant with offset. */
export type IsoInstant = string;
/** Whole tokens. One token = one share (profile row token.one-to-one-backing). Never fractional. */
export type Tokens = bigint;
/** Currency in minor units (USD cents). */
export type MinorUnits = bigint;

/**
 * Every output that depends on profile rows carries this label (gate G-DTCC).
 * `status` is the weakest status among `rows`.
 */
export interface TrustLabel {
  status: RowStatus;
  rows: string[];
  profile: string;
  profileVersion: string;
  /** Echo of the profile disclaimer(s). Must be shown to humans. */
  disclaimer: string;
}

/** A pure reducer returns the next state plus effects for the caller to perform. */
export interface Reduction<S> {
  next: S;
  effects: CoreEffect[];
  trust: TrustLabel;
}

/** Commands a reducer asks its host (sandbox, adapter, participant system) to perform. */
export type CoreEffect =
  | { kind: "allowlist-add"; ledger: LedgerId; address: WalletAddress }
  | { kind: "allowlist-remove"; ledger: LedgerId; address: WalletAddress }
  | { kind: "restrict"; ledger: LedgerId; address: WalletAddress; inbound: boolean; outbound: boolean }
  | { kind: "unrestrict"; ledger: LedgerId; address: WalletAddress }
  | { kind: "mint"; ledger: LedgerId; to: WalletAddress; tokens: Tokens; cusip: Cusip }
  | { kind: "burn"; ledger: LedgerId; from: WalletAddress; tokens: Tokens; cusip: Cusip }
  | { kind: "force-transfer"; ledger: LedgerId; from: WalletAddress; to: WalletAddress; tokens: Tokens; cusip: Cusip }
  | { kind: "credit-classic"; participant: ParticipantId; amount: MinorUnits; currency: "USD"; ref: string }
  /** Book-entry (classic) share position change at DTC; negative debits. Conversions move shares between forms. */
  | { kind: "classic-position"; participant: ParticipantId; cusip: Cusip; shares: bigint }
  /** One use of DTC's override ("root wallet") to record for the quarterly report (row compliance.quarterly-sec-report-counts). */
  | { kind: "root-wallet-use"; ledger: LedgerId; reason: string; transferId: string }
  | { kind: "audit"; message: string; data?: Record<string, string> };
