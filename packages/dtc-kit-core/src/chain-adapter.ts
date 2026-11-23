// SPDX-License-Identifier: Apache-2.0
import type { RowStatus, SourceTag } from "@sik/dtc-kit-profile-spec/pure";
import type { Cusip, LedgerId, Tokens, WalletAddress } from "./types.ts";

/**
 * Capabilities the DTC model needs from a chain. The set is chain-neutral on purpose:
 * a Canton or EVM adapter would fill the same matrix (docs/ARCHITECTURE.md principle 2).
 */
export const CAPABILITIES = [
  "allowlist-registered-wallets",
  "deny-unregistered-transfer",
  "freeze-address",
  "freeze-partial-balance",
  "global-pause",
  "admin-burn",
  "admin-mint",
  "force-transfer",
  "whole-token-enforcement",
  "transfer-events",
  "admin-events-distinguishable",
  "wallet-recovery",
  "contract-address-holder",
  "muxed-attribution",
  "custody-vendor-signing",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * native: one primitive does it. composed: several primitives in one transaction or a documented sequence.
 * partial: some cases only. none: not possible. unknown: not established (a spike ticket exists).
 */
export type SupportLevel = "native" | "composed" | "partial" | "none" | "unknown";

export interface CapabilityEntry {
  capability: Capability;
  support: SupportLevel;
  /** The primitive(s) used, in the chain's own vocabulary. */
  mechanism: string;
  caveats: string[];
  /** Trust tag for the support claim itself (P/S/V/I/E/U). */
  evidence: SourceTag;
  /** Profile row ids whose resolution would change this entry. */
  profileRows: string[];
  /** Ticket that will confirm or refute an `unknown`/`I`-tagged entry. */
  verifyTicket?: string;
}

export type CapabilityMatrix = Record<Capability, CapabilityEntry>;

/** One operation inside a planned chain action. */
export interface ChainStep {
  /** Chain-native operation name, e.g. "clawback", "payment", "set_trust_line_flags", "forced_transfer". */
  op: string;
  /** Account or role whose signature the step needs. */
  signer: string;
  params: Record<string, string | bigint | boolean>;
}

export type ChainActionKind =
  | "allowlist-add"
  | "allowlist-remove"
  | "restrict"
  | "unrestrict"
  | "mint"
  | "burn"
  | "force-transfer";

/**
 * Unsigned description of what the adapter would submit. Adapters PLAN; they never sign or hold keys
 * (G-SECRETS). `atomic` is true when all steps share one transaction: a force transfer on a classic
 * asset needs this, otherwise a clawback can succeed and leave the payment undone.
 */
export interface ChainActionPlan {
  adapterId: string;
  action: ChainActionKind;
  atomic: boolean;
  steps: ChainStep[];
  preconditions: string[];
  caveats: string[];
  /** Weakest profile status the plan depends on. */
  trust: RowStatus;
  rows: string[];
  /**
   * Optional unsigned transaction envelope (base64 XDR) proving the plan is well-formed. Built with a
   * placeholder sequence number: it is NOT submittable as is and carries no signature.
   */
  envelopeXdr?: string;
  /** Network the envelope was built for (never mainnet). */
  network?: "testnet" | "local";
}

export interface AddressRequest {
  ledger: LedgerId;
  address: WalletAddress;
  cusip: Cusip;
}

export interface TransferRequest extends AddressRequest {
  to: WalletAddress;
  tokens: Tokens;
}

/**
 * The port adapters implement. Core and the sandbox depend on this interface only.
 * Read methods that need a network (balances, events) are out of the MVP (event decoders: ticket DTC-027).
 */
export interface ChainAdapter {
  readonly id: string;
  /** Static, reviewable matrix. Must be total over `CAPABILITIES`. */
  capabilityMatrix(): CapabilityMatrix;
  planAllowlistAdd(req: AddressRequest): ChainActionPlan;
  planAllowlistRemove(req: AddressRequest): ChainActionPlan;
  planRestrict(req: AddressRequest & { inbound: boolean; outbound: boolean }): ChainActionPlan;
  planUnrestrict(req: AddressRequest): ChainActionPlan;
  planMint(req: AddressRequest & { tokens: Tokens }): ChainActionPlan;
  planBurn(req: AddressRequest & { tokens: Tokens }): ChainActionPlan;
  planForceTransfer(req: TransferRequest): ChainActionPlan;
}
