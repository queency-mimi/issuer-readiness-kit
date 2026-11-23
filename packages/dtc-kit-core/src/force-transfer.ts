// SPDX-License-Identifier: Apache-2.0
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import type { ChainActionPlan, ChainAdapter } from "./chain-adapter.ts";
import { InvalidTransition } from "./errors.ts";
import { parseIsoDate, zonedParts } from "./time.ts";
import { precheckTransfer } from "./transfer-precheck.ts";
import type { PrecheckReason } from "./transfer-precheck.ts";
import { trustLabel } from "./trust.ts";
import type { Cusip, IsoInstant, LedgerId, Reduction, Tokens, TrustLabel, WalletAddress } from "./types.ts";
import type { WalletRecord } from "./wallet-registration.ts";

/** Profile row authorities.force-transfer-reasons. */
export type ForceTransferReason = "lost" | "stolen" | "erroneous";

export const FORCE_TRANSFER_STATES = ["Requested", "Planned", "Submitted", "Confirmed", "Failed"] as const;
export type ForceTransferState = (typeof FORCE_TRANSFER_STATES)[number];

export interface ForceTransfer {
  id: string;
  ledger: LedgerId;
  cusip: Cusip;
  from: WalletAddress;
  to: WalletAddress;
  tokens: Tokens;
  reason: ForceTransferReason;
  state: ForceTransferState;
  requestedAt: IsoInstant;
  /** Filled when planned. */
  plan?: ChainActionPlan;
  txRef?: string;
  failure?: string;
}

export type ForceTransferEvent =
  | { type: "plan"; adapter: ChainAdapter }
  | { type: "submitted"; txRef: string }
  | { type: "confirmed" }
  | { type: "failed"; detail: string };

const ROWS = {
  override: "authorities.dtc-override-root-wallet",
  reasons: "authorities.force-transfer-reasons",
  quarterly: "compliance.quarterly-sec-report-counts",
} as const;

export interface ForceTransferRequest {
  id: string;
  from: WalletRecord;
  /** Destination's registry record; undefined when the address is not registered. */
  to: WalletRecord | undefined;
  /** Destination address, needed when `to` is undefined (for the refusal message). */
  toAddress?: WalletAddress;
  cusip: Cusip;
  tokens: Tokens;
  reason: ForceTransferReason;
  requestedAt: IsoInstant;
}

export type ForceTransferRequestResult =
  | { ok: true; transfer: ForceTransfer; trust: TrustLabel }
  | { ok: false; code: PrecheckReason | "INVALID_REASON" | "INVALID_QUANTITY"; trust: TrustLabel };

/**
 * DTC override request (SPEC 2.4): no holder signature is part of it (row authorities.dtc-override-root-wallet).
 * The destination must be a Registered Wallet able to receive: the same pre-check decides, but only its
 * destination reasons apply (the override ignores restrictions on the source).
 */
export function requestForceTransfer(req: ForceTransferRequest, profile: ResolvedProfile): ForceTransferRequestResult {
  const reasons = profile.rows.get(ROWS.reasons)?.value as { reasons?: string[] } | null | undefined;
  if (!reasons?.reasons?.includes(req.reason)) return { ok: false, code: "INVALID_REASON", trust: trustLabel(profile, [ROWS.reasons]) };
  if (req.tokens <= 0n) return { ok: false, code: "INVALID_QUANTITY", trust: trustLabel(profile, [ROWS.override]) };
  const check = precheckTransfer({ from: { ...req.from, status: "Completed" }, to: req.to, tokens: req.tokens, at: req.requestedAt }, profile);
  const destReason = check.reasons.find((r) => r.startsWith("DEST_"));
  if (destReason) return { ok: false, code: destReason, trust: check.trust };
  const transfer: ForceTransfer = {
    id: req.id,
    ledger: req.from.ledger,
    cusip: req.cusip,
    from: req.from.address,
    to: req.to?.address ?? req.toAddress ?? "",
    tokens: req.tokens,
    reason: req.reason,
    state: "Requested",
    requestedAt: req.requestedAt,
  };
  return { ok: true, transfer, trust: trustLabel(profile, [ROWS.override, ROWS.reasons]) };
}

/**
 * Requested -> Planned -> Submitted -> Confirmed | Failed (DTC-008). `plan` asks the adapter for its
 * ChainActionPlan; `confirmed` emits the token movement and one root-wallet use for the quarterly report.
 */
export function reduceForceTransfer(transfer: ForceTransfer, event: ForceTransferEvent, profile: ResolvedProfile): Reduction<ForceTransfer> {
  const s = transfer.state;
  const illegal = (): never => {
    throw new InvalidTransition(s, event.type);
  };
  const trust = trustLabel(profile, [ROWS.override, ROWS.reasons]);
  switch (event.type) {
    case "plan": {
      if (s !== "Requested") return illegal();
      const plan = event.adapter.planForceTransfer({ ledger: transfer.ledger, address: transfer.from, to: transfer.to, tokens: transfer.tokens, cusip: transfer.cusip });
      return { next: { ...transfer, state: "Planned", plan }, effects: [], trust };
    }
    case "submitted": {
      if (s !== "Planned") return illegal();
      return { next: { ...transfer, state: "Submitted", txRef: event.txRef }, effects: [], trust };
    }
    case "confirmed": {
      if (s !== "Submitted") return illegal();
      return {
        next: { ...transfer, state: "Confirmed" },
        effects: [
          { kind: "force-transfer", ledger: transfer.ledger, from: transfer.from, to: transfer.to, tokens: transfer.tokens, cusip: transfer.cusip },
          { kind: "root-wallet-use", ledger: transfer.ledger, reason: transfer.reason, transferId: transfer.id },
        ],
        trust: trustLabel(profile, [ROWS.override, ROWS.reasons, ROWS.quarterly]),
      };
    }
    case "failed": {
      if (s === "Confirmed" || s === "Failed") return illegal();
      return { next: { ...transfer, state: "Failed", failure: event.detail }, effects: [], trust };
    }
  }
}

/** One line of the quarterly "root wallet uses" report. */
export interface RootWalletUse {
  at: IsoInstant;
  ledger: LedgerId;
  reason: ForceTransferReason | "corporate-action";
  transferId: string;
}

/** Calendar date of an instant in New York (DTC's reporting calendar is ET; an assumption, labelled in SPEC). */
function nyDate(at: IsoInstant): string {
  const p = zonedParts(Date.parse(at), "America/New_York");
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Count uses in the quarter starting `quarterStart` (YYYY-01-01, -04-01, -07-01 or -10-01, ET calendar),
 * by reason plus `total`. Corporate-action uses are counted too: the report separates them by reason.
 */
export function summariseRootWalletUses(uses: readonly RootWalletUse[], quarterStart: string): Record<string, number> {
  const q = parseIsoDate(quarterStart);
  if (q.day !== 1 || ![1, 4, 7, 10].includes(q.month)) throw new Error(`${quarterStart} is not a quarter start`);
  const end = q.month === 10 ? `${q.year + 1}-01-01` : `${q.year}-${String(q.month + 3).padStart(2, "0")}-01`;
  const out: Record<string, number> = { total: 0 };
  for (const u of uses) {
    const d = nyDate(u.at);
    if (d < quarterStart || d >= end) continue;
    out["total"] = (out["total"] ?? 0) + 1;
    out[u.reason] = (out[u.reason] ?? 0) + 1;
  }
  return out;
}
