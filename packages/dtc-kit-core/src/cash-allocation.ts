// SPDX-License-Identifier: Apache-2.0
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { InvalidTransition } from "./errors.ts";
import { trustLabel } from "./trust.ts";
import type { Cusip, IsoDate, MinorUnits, ParticipantId, Reduction } from "./types.ts";

/**
 * Corporate-action cash allocation, seen from the participant. DTC computes entitlements from its
 * 20:00 ET capture and credits ONE consolidated cash payment to the participant's classic account
 * (row corporate_actions.cash-credit-consolidated-classic). The participant then allocates it to client
 * sub-ledgers. Allocation maths lives in packages/dtc-kit-reconciliation; this is only the lifecycle.
 */
export const CASH_ALLOCATION_STATES = [
  "Announced",
  "CaptureTaken",
  "CreditExpected",
  "CreditReceived",
  "Allocated",
  "Reconciled",
  "Disputed",
] as const;
export type CashAllocationState = (typeof CASH_ALLOCATION_STATES)[number];

export interface CashAllocationCase {
  id: string;
  participant: ParticipantId;
  cusip: Cusip;
  eventKind: "interest" | "maturity";
  recordDate: IsoDate;
  payDate: IsoDate;
  state: CashAllocationState;
  expectedCredit?: MinorUnits;
  receivedCredit?: MinorUnits;
  /** Stable code when Disputed, e.g. CREDIT_MISMATCH, POSITION_MISMATCH. */
  disputeCode?: string;
}

export type CashAllocationEvent =
  | { type: "capture-taken"; captureRef: string }
  | { type: "credit-expected"; amount: MinorUnits }
  | { type: "credit-received"; amount: MinorUnits }
  | { type: "allocated"; planRef: string }
  /** For maturity cases `tokensBurned` must be true (the tokens are burned at maturity). */
  | { type: "reconciled"; tokensBurned?: boolean }
  | { type: "dispute"; code: string };

const ROWS = { credit: "corporate_actions.cash-credit-consolidated-classic", scope: "corporate_actions.phase1-scope" } as const;

const NEXT: Partial<Record<CashAllocationState, { event: CashAllocationEvent["type"]; to: CashAllocationState }>> = {
  Announced: { event: "capture-taken", to: "CaptureTaken" },
  CaptureTaken: { event: "credit-expected", to: "CreditExpected" },
  CreditExpected: { event: "credit-received", to: "CreditReceived" },
  CreditReceived: { event: "allocated", to: "Allocated" },
  Allocated: { event: "reconciled", to: "Reconciled" },
};

/**
 * Participant-side lifecycle of one corporate-action cash credit (SPEC 2.6, DTC-010):
 * Announced -> CaptureTaken -> CreditExpected -> CreditReceived -> Allocated -> Reconciled.
 * A received credit different from the expected one goes straight to Disputed CREDIT_MISMATCH (never
 * allocated silently). `dispute` is legal from any non-terminal state after Announced. A maturity case
 * needs `tokensBurned` to reconcile and records a `tokens-burned` audit.
 */
export function reduceCashAllocation(c: CashAllocationCase, event: CashAllocationEvent, profile: ResolvedProfile): Reduction<CashAllocationCase> {
  const trust = trustLabel(profile, [ROWS.credit, ROWS.scope]);
  const illegal = (detail?: string): never => {
    throw new InvalidTransition(c.state, event.type, detail);
  };
  if (event.type === "dispute") {
    if (c.state === "Announced" || c.state === "Reconciled" || c.state === "Disputed") return illegal();
    return { next: { ...c, state: "Disputed", disputeCode: event.code }, effects: [{ kind: "audit", message: "disputed", data: { case: c.id, code: event.code } }], trust };
  }
  const step = NEXT[c.state];
  if (!step || step.event !== event.type) return illegal();
  switch (event.type) {
    case "capture-taken":
      return { next: { ...c, state: "CaptureTaken" }, effects: [], trust };
    case "credit-expected":
      return { next: { ...c, state: "CreditExpected", expectedCredit: event.amount }, effects: [], trust };
    case "credit-received": {
      if (c.expectedCredit !== undefined && c.expectedCredit !== event.amount) {
        return {
          next: { ...c, state: "Disputed", receivedCredit: event.amount, disputeCode: "CREDIT_MISMATCH" },
          effects: [{ kind: "audit", message: "disputed", data: { case: c.id, code: "CREDIT_MISMATCH", expected: c.expectedCredit.toString(), actual: event.amount.toString() } }],
          trust,
        };
      }
      return { next: { ...c, state: "CreditReceived", receivedCredit: event.amount }, effects: [], trust };
    }
    case "allocated":
      return { next: { ...c, state: "Allocated" }, effects: [{ kind: "audit", message: "allocated", data: { case: c.id, plan: event.planRef } }], trust };
    case "reconciled": {
      if (c.eventKind === "maturity" && event.tokensBurned !== true) return illegal("maturity needs tokens burned");
      const effects = c.eventKind === "maturity" ? [{ kind: "audit" as const, message: "tokens-burned", data: { case: c.id } }] : [];
      return { next: { ...c, state: "Reconciled" }, effects, trust };
    }
  }
  return illegal();
}
