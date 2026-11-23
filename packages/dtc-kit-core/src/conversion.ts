// SPDX-License-Identifier: Apache-2.0
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { InvalidTransition } from "./errors.ts";
import { isFractional } from "./transfer-precheck.ts";
import { trustLabel } from "./trust.ts";
import type { CoreEffect, Cusip, IsoInstant, LedgerId, ParticipantId, Reduction, Tokens, WalletAddress, WalletId } from "./types.ts";
import type { WalletRecord } from "./wallet-registration.ts";

/** Profile row operations.conversion-order-status-taxonomy. */
export const CONVERSION_STATUSES = ["Pending Approval", "Processing", "Completed", "Failed", "Declined"] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

/** to-token: classic book entry becomes a token (DTC mints). to-book-entry: token is burned, classic credited. */
export type ConversionDirection = "to-token" | "to-book-entry";

export interface ConversionOrder {
  id: string;
  participant: ParticipantId;
  wallet: WalletId;
  walletAddress: WalletAddress;
  ledger: LedgerId;
  cusip: Cusip;
  direction: ConversionDirection;
  tokens: Tokens;
  status: ConversionStatus;
  createdAt: IsoInstant;
  /** Who submitted (maker/checker). */
  maker?: string;
  /** Set when status is Declined or Failed. A stable code, not free text. */
  reasonCode?: string;
}

export type ConversionEvent =
  | { type: "approve"; checker: string }
  | { type: "decline"; reasonCode: string }
  | { type: "onchain-confirmed" }
  | { type: "onchain-reverted"; detail: string }
  | { type: "outside-processing-hours" };

const ROWS = {
  taxonomy: "operations.conversion-order-status-taxonomy",
  mintBurn: "authorities.dtc-initiated-mint-burn",
  backing: "token.one-to-one-backing",
  whole: "token.whole-tokens-only",
  walletTaxonomy: "wallet.registration-status-taxonomy",
  hours: "operations.transfer-and-processing-hours",
  /** Not a profile row on purpose: DTCC's out-of-hours behaviour is not recorded, so results label `unknown`. */
  outOfHoursHold: "operations.out-of-hours-hold",
} as const;

export interface SubmitConversionInput {
  id: string;
  participant: ParticipantId;
  wallet: WalletRecord;
  cusip: Cusip;
  direction: ConversionDirection;
  /** Quantity as the caller typed it: "1.5" is declined, never rounded. */
  rawQuantity: string;
  makerChecker: boolean;
  maker?: string;
  /** Token balance of the wallet, needed for to-book-entry. */
  availableTokens?: Tokens;
  createdAt: IsoInstant;
}

const classicMove = (o: ConversionOrder, shares: bigint): CoreEffect => ({ kind: "classic-position", participant: o.participant, cusip: o.cusip, shares });

/** The classic-side movement made when an order enters Processing (to-token debits book-entry shares). */
function enterProcessingEffects(o: ConversionOrder): CoreEffect[] {
  return o.direction === "to-token" ? [classicMove(o, -o.tokens)] : [];
}

/**
 * Submit-time checks and the first state (SPEC 2.3): Declined with WALLET_FAILED_COMPLIANCE,
 * WALLET_NOT_COMPLETED, INVALID_QUANTITY, FRACTIONAL_QUANTITY or INSUFFICIENT_TOKENS; otherwise Pending
 * Approval (maker/checker) or Processing. DTC initiates the mint/burn; a participant has no issue operation.
 */
export function submitConversionOrder(input: SubmitConversionInput, profile: ResolvedProfile): Reduction<ConversionOrder> {
  const raw = input.rawQuantity.trim();
  const whole = /^\d+$/.test(raw) ? BigInt(raw) : /^\d+\.0+$/.test(raw) ? BigInt(raw.split(".")[0] ?? "0") : undefined;
  const base: ConversionOrder = {
    id: input.id,
    participant: input.participant,
    wallet: input.wallet.id,
    walletAddress: input.wallet.address,
    ledger: input.wallet.ledger,
    cusip: input.cusip,
    direction: input.direction,
    tokens: whole ?? 0n,
    status: "Processing",
    createdAt: input.createdAt,
    ...(input.maker !== undefined ? { maker: input.maker } : {}),
  };
  const decline = (reasonCode: string, rows: string[]): Reduction<ConversionOrder> => ({
    next: { ...base, status: "Declined", reasonCode },
    effects: [{ kind: "audit", message: "conversion-declined", data: { order: base.id, reasonCode } }],
    trust: trustLabel(profile, [ROWS.taxonomy, ...rows]),
  });
  if (input.wallet.status === "Failed Compliance") return decline("WALLET_FAILED_COMPLIANCE", [ROWS.walletTaxonomy]);
  if (input.wallet.status !== "Completed") return decline("WALLET_NOT_COMPLETED", [ROWS.walletTaxonomy]);
  if (isFractional(raw)) return decline("FRACTIONAL_QUANTITY", [ROWS.whole]);
  if (whole === undefined || whole <= 0n) return decline("INVALID_QUANTITY", [ROWS.whole]);
  if (input.direction === "to-book-entry" && (input.availableTokens ?? 0n) < whole) return decline("INSUFFICIENT_TOKENS", [ROWS.mintBurn]);
  if (input.makerChecker) {
    return { next: { ...base, status: "Pending Approval" }, effects: [], trust: trustLabel(profile, [ROWS.taxonomy]) };
  }
  return { next: base, effects: enterProcessingEffects(base), trust: trustLabel(profile, [ROWS.taxonomy, ROWS.mintBurn, ROWS.backing]) };
}

/**
 * Conversion order machine after submission (SPEC 2.3, DTC-007). Completed to-token emits exactly
 * [mint, audit]; to-book-entry emits [burn, classic-position(+n), audit]; an on-chain revert ends in Failed
 * and reverses the classic movement made on entering Processing (row authorities.dtc-initiated-mint-burn);
 * outside processing hours the order is held with an audit, labelled unknown (DTCC's behaviour not recorded).
 */
export function reduceConversion(order: ConversionOrder, event: ConversionEvent, profile: ResolvedProfile): Reduction<ConversionOrder> {
  const s = order.status;
  const illegal = (detail?: string): never => {
    throw new InvalidTransition(s, event.type, detail);
  };
  switch (event.type) {
    case "approve": {
      if (s !== "Pending Approval") return illegal();
      if (order.maker !== undefined && event.checker === order.maker) return illegal("checker must differ from maker");
      const next: ConversionOrder = { ...order, status: "Processing" };
      return { next, effects: enterProcessingEffects(next), trust: trustLabel(profile, [ROWS.taxonomy]) };
    }
    case "decline": {
      if (s !== "Pending Approval" && s !== "Processing") return illegal();
      const effects = s === "Processing" ? enterProcessingEffects(order).map((e) => (e.kind === "classic-position" ? { ...e, shares: -e.shares } : e)) : [];
      return { next: { ...order, status: "Declined", reasonCode: event.reasonCode }, effects, trust: trustLabel(profile, [ROWS.taxonomy]) };
    }
    case "onchain-confirmed": {
      if (s !== "Processing") return illegal();
      const effects: CoreEffect[] =
        order.direction === "to-token"
          ? [{ kind: "mint", ledger: order.ledger, to: order.walletAddress, tokens: order.tokens, cusip: order.cusip }]
          : [
              { kind: "burn", ledger: order.ledger, from: order.walletAddress, tokens: order.tokens, cusip: order.cusip },
              classicMove(order, order.tokens),
            ];
      effects.push({ kind: "audit", message: "conversion-completed", data: { order: order.id, direction: order.direction, tokens: order.tokens.toString() } });
      return { next: { ...order, status: "Completed" }, effects, trust: trustLabel(profile, [ROWS.taxonomy, ROWS.mintBurn, ROWS.backing]) };
    }
    case "onchain-reverted": {
      if (s !== "Processing") return illegal();
      const reversal = enterProcessingEffects(order).map((e) => (e.kind === "classic-position" ? { ...e, shares: -e.shares } : e));
      return {
        next: { ...order, status: "Failed", reasonCode: "ONCHAIN_REVERTED" },
        effects: [...reversal, { kind: "audit", message: "conversion-reverted", data: { order: order.id, detail: event.detail } }],
        trust: trustLabel(profile, [ROWS.taxonomy, ROWS.mintBurn]),
      };
    }
    case "outside-processing-hours": {
      if (s !== "Pending Approval" && s !== "Processing") return illegal();
      return {
        next: order,
        effects: [{ kind: "audit", message: "conversion-held-outside-processing-hours", data: { order: order.id } }],
        trust: trustLabel(profile, [ROWS.hours, ROWS.outOfHoursHold]),
      };
    }
  }
}
