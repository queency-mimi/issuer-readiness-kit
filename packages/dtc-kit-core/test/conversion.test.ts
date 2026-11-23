// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONVERSION_STATUSES, InvalidTransition, reduceConversion, submitConversionOrder } from "../src/index.ts";
import type { ConversionEvent, ConversionOrder, ConversionStatus, CoreEffect, SubmitConversionInput } from "../src/index.ts";
import { profile, wallet } from "./helpers.ts";

const submit = (over: Partial<SubmitConversionInput> = {}): SubmitConversionInput => ({
  id: "ORD-1",
  participant: "SBX-9002",
  wallet: wallet("Completed"),
  cusip: "SBX000AA0",
  direction: "to-token",
  rawQuantity: "100",
  makerChecker: false,
  createdAt: "2027-01-13T15:00:00Z",
  ...over,
});

describe("submitConversionOrder (DTC-007)", () => {
  it("without maker/checker goes to Processing and debits the classic position", () => {
    const r = submitConversionOrder(submit(), profile);
    assert.equal(r.next.status, "Processing");
    assert.equal(r.next.tokens, 100n);
    assert.deepEqual(r.effects[0], { kind: "classic-position", participant: "SBX-9002", cusip: "SBX000AA0", shares: -100n });
  });
  it("with maker/checker goes to Pending Approval and moves nothing yet", () => {
    const r = submitConversionOrder(submit({ makerChecker: true, maker: "alice" }), profile);
    assert.equal(r.next.status, "Pending Approval");
    assert.deepEqual(r.effects, []);
  });
  for (const [label, over, code] of [
    ["Failed Compliance wallet", { wallet: wallet("Failed Compliance") }, "WALLET_FAILED_COMPLIANCE"],
    ["Processing wallet", { wallet: wallet("Processing") }, "WALLET_NOT_COMPLETED"],
    ["fractional quantity", { rawQuantity: "1.5" }, "FRACTIONAL_QUANTITY"],
    ["zero quantity", { rawQuantity: "0" }, "INVALID_QUANTITY"],
    ["non-numeric quantity", { rawQuantity: "ten" }, "INVALID_QUANTITY"],
    ["to-book-entry above the token balance", { direction: "to-book-entry", rawQuantity: "50", availableTokens: 40n }, "INSUFFICIENT_TOKENS"],
  ] as const) {
    it(`declines: ${label} -> ${code}`, () => {
      const r = submitConversionOrder(submit(over as Partial<SubmitConversionInput>), profile);
      assert.equal(r.next.status, "Declined");
      assert.equal(r.next.reasonCode, code);
      assert.deepEqual(r.effects.filter((e) => e.kind !== "audit"), []);
    });
  }
});

const order = (status: ConversionStatus, over: Partial<ConversionOrder> = {}): ConversionOrder => ({
  id: "ORD-1",
  participant: "SBX-9002",
  wallet: "W-1",
  walletAddress: "SBX-ADDR-1",
  ledger: "sandbox-ledger",
  cusip: "SBX000AA0",
  direction: "to-token",
  tokens: 100n,
  status,
  createdAt: "2027-01-13T15:00:00Z",
  maker: "alice",
  ...over,
});

const EVENTS: ConversionEvent[] = [
  { type: "approve", checker: "bob" },
  { type: "decline", reasonCode: "MANUAL" },
  { type: "onchain-confirmed" },
  { type: "onchain-reverted", detail: "x" },
  { type: "outside-processing-hours" },
];
const LEGAL: Partial<Record<ConversionStatus, Partial<Record<ConversionEvent["type"], ConversionStatus>>>> = {
  "Pending Approval": { approve: "Processing", decline: "Declined", "outside-processing-hours": "Pending Approval" },
  Processing: { decline: "Declined", "onchain-confirmed": "Completed", "onchain-reverted": "Failed", "outside-processing-hours": "Processing" },
};

describe("reduceConversion (DTC-007): table", () => {
  for (const status of CONVERSION_STATUSES) {
    for (const e of EVENTS) {
      const to = LEGAL[status]?.[e.type];
      it(`${status} + ${e.type} -> ${to ?? "InvalidTransition"}`, () => {
        if (to === undefined) assert.throws(() => reduceConversion(order(status), e, profile), InvalidTransition);
        else assert.equal(reduceConversion(order(status), e, profile).next.status, to);
      });
    }
  }
});

describe("reduceConversion (DTC-007): effects", () => {
  it("a successful to-token completes with exactly one mint then one audit", () => {
    const r = reduceConversion(order("Processing"), { type: "onchain-confirmed" }, profile);
    assert.deepEqual(r.effects.map((e) => e.kind), ["mint", "audit"]);
  });
  it("a successful to-book-entry burns and credits the classic position", () => {
    const r = reduceConversion(order("Processing", { direction: "to-book-entry", tokens: 40n }), { type: "onchain-confirmed" }, profile);
    assert.deepEqual(r.effects.map((e) => e.kind), ["burn", "classic-position", "audit"]);
  });
  it("the checker must differ from the maker", () => {
    assert.throws(() => reduceConversion(order("Pending Approval"), { type: "approve", checker: "alice" }, profile), InvalidTransition);
  });
  it("a revert leaves no net change when all effects are replayed against an in-memory ledger", () => {
    const ledger = { classic: 1000n, supply: 0n };
    const apply = (effects: CoreEffect[]) => {
      for (const e of effects) {
        if (e.kind === "classic-position") ledger.classic += e.shares;
        if (e.kind === "mint") ledger.supply += e.tokens;
        if (e.kind === "burn") ledger.supply -= e.tokens;
      }
    };
    const s = submitConversionOrder(submit(), profile);
    apply(s.effects);
    assert.equal(ledger.classic, 900n);
    const f = reduceConversion({ ...s.next, walletAddress: "SBX-ADDR-1", ledger: "sandbox-ledger" }, { type: "onchain-reverted", detail: "trustline deauthorised" }, profile);
    apply(f.effects);
    assert.equal(f.next.status, "Failed");
    assert.deepEqual(ledger, { classic: 1000n, supply: 0n });
  });
  it("outside processing hours the order is held, with an audit, and labelled unknown (DTCC's behaviour is not recorded)", () => {
    const r = reduceConversion(order("Processing"), { type: "outside-processing-hours" }, profile);
    assert.deepEqual(r.effects.map((e) => e.kind), ["audit"]);
    assert.equal(r.trust.status, "unknown");
  });
});
