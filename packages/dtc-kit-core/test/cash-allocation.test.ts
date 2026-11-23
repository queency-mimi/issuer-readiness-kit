// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidTransition, reduceCashAllocation } from "../src/index.ts";
import type { CashAllocationCase, CashAllocationEvent } from "../src/index.ts";
import { profile } from "./helpers.ts";

const start = (kind: "interest" | "maturity" = "interest"): CashAllocationCase => ({
  id: "CA-1",
  participant: "SBX-9002",
  cusip: "SBX000AA0",
  eventKind: kind,
  recordDate: "2027-01-15",
  payDate: "2027-01-18",
  state: "Announced",
});
const run = (c: CashAllocationCase, events: CashAllocationEvent[]) => events.reduce((acc, e) => reduceCashAllocation(acc.next, e, profile), { next: c, effects: [], trust: undefined as never } as ReturnType<typeof reduceCashAllocation>);
const HAPPY: CashAllocationEvent[] = [
  { type: "capture-taken", captureRef: "cap-1" },
  { type: "credit-expected", amount: 1000n },
  { type: "credit-received", amount: 1000n },
  { type: "allocated", planRef: "plan-1" },
];

describe("reduceCashAllocation (DTC-010)", () => {
  it("legal path Announced -> ... -> Reconciled", () => {
    const r = run(start(), [...HAPPY, { type: "reconciled" }]);
    assert.equal(r.next.state, "Reconciled");
    assert.equal(r.next.receivedCredit, 1000n);
  });
  it("skipping a step is illegal", () => {
    assert.throws(() => reduceCashAllocation(start(), { type: "credit-received", amount: 1n }, profile), InvalidTransition);
  });
  it("a received credit that differs from the expected one goes to Disputed CREDIT_MISMATCH, never allocated silently", () => {
    const r = run(start(), [HAPPY[0]!, HAPPY[1]!, { type: "credit-received", amount: 999n }]);
    assert.equal(r.next.state, "Disputed");
    assert.equal(r.next.disputeCode, "CREDIT_MISMATCH");
    assert.throws(() => reduceCashAllocation(r.next, { type: "allocated", planRef: "p" }, profile), InvalidTransition);
  });
  it("dispute is possible from any state after CaptureTaken but not from Announced", () => {
    assert.throws(() => reduceCashAllocation(start(), { type: "dispute", code: "X" }, profile), InvalidTransition);
    for (let n = 1; n <= 4; n++) {
      const r = run(start(), HAPPY.slice(0, n));
      assert.equal(reduceCashAllocation(r.next, { type: "dispute", code: "POSITION_MISMATCH" }, profile).next.state, "Disputed");
    }
  });
  it("a maturity case cannot be Reconciled without the tokens-burned audit", () => {
    const r = run(start("maturity"), HAPPY);
    assert.throws(() => reduceCashAllocation(r.next, { type: "reconciled" }, profile), InvalidTransition);
    const ok = reduceCashAllocation(r.next, { type: "reconciled", tokensBurned: true }, profile);
    assert.equal(ok.next.state, "Reconciled");
    assert.ok(ok.effects.some((e) => e.kind === "audit" && e.message === "tokens-burned"));
  });
  it("labels results with the consolidated-credit row", () => {
    const r = reduceCashAllocation(start(), HAPPY[0]!, profile);
    assert.ok(r.trust.rows.includes("corporate_actions.cash-credit-consolidated-classic"));
  });
});
