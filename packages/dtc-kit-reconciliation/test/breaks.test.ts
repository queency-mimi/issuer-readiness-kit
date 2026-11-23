// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffPositions, expectedCredit, reconcile } from "../src/index.ts";
import type { DtcBalanceRow } from "../src/index.ts";
import { input, trust } from "./helpers.ts";

const dtc: DtcBalanceRow[] = [
  { walletAddress: "W1a", tokens: 30n },
  { walletAddress: "W1b", tokens: 20n },
  { walletAddress: "W2", tokens: 30n },
  { walletAddress: "W3a", tokens: 15n },
  { walletAddress: "W3b", tokens: 5n },
];
const RATE = { numerator: 125n, denominator: 1n };
const clean = { rate: RATE, independentSupply: 100n, snapshotSupply: 100n, captureAt: "2027-01-15T20:00:00-05:00", snapshotAt: "2027-01-16T01:00:00Z", trust };

describe("expectedCredit (DTC-034)", () => {
  it("rounds half-up to a cent", () => {
    assert.equal(expectedCredit(100n, RATE), 12500n);
    assert.equal(expectedCredit(1n, { numerator: 1n, denominator: 2n }), 1n);
    assert.equal(expectedCredit(1n, { numerator: 1n, denominator: 3n }), 0n);
  });
});

describe("reconcile (DTC-034): one fixture per break code, none on the clean fixture", () => {
  it("clean", () => {
    const r = reconcile(input(12500n), dtc, clean);
    assert.deepEqual(r.breaks, []);
    assert.equal(r.clean, true);
    assert.equal(r.plan?.lines.reduce((s, l) => s + l.amount, 0n), 12500n);
  });
  it("SC-028 CREDIT_MISMATCH: DTC credits 1 cent less; nothing is allocated", () => {
    const r = reconcile(input(12499n), dtc, clean);
    assert.deepEqual(r.breaks.map((b) => [b.code, b.expected, b.actual]), [["CREDIT_MISMATCH", "12500", "12499"]]);
    assert.equal(r.clean, false);
    assert.equal(r.plan, undefined);
  });
  it("POSITION_MISMATCH", () => {
    const r = reconcile(input(12500n), dtc.map((d) => (d.walletAddress === "W2" ? { ...d, tokens: 29n } : d)), clean);
    assert.deepEqual(r.breaks.map((b) => [b.code, b.wallet]), [["POSITION_MISMATCH", "W2"]]);
  });
  it("UNMAPPED_WALLET", () => {
    const i = input(12500n, [["W1a", 50n], ["W2", 30n], ["X", 20n]]);
    const r = reconcile(i, [{ walletAddress: "W1a", tokens: 50n }, { walletAddress: "W2", tokens: 30n }, { walletAddress: "X", tokens: 20n }], clean);
    assert.deepEqual(r.breaks.map((b) => [b.code, b.wallet]), [["UNMAPPED_WALLET", "X"]]);
  });
  it("SNAPSHOT_SUPPLY_MISMATCH", () => {
    assert.deepEqual(reconcile(input(12500n), dtc, { ...clean, independentSupply: 101n }).breaks.map((b) => b.code), ["SNAPSHOT_SUPPLY_MISMATCH"]);
  });
  it("CLIENT_ID_UNKNOWN", () => {
    const i = input(12500n);
    i.books = { ...i.books, clients: i.books.clients.filter((c) => c.clientId !== "C-BIRCH-003") };
    assert.deepEqual(reconcile(i, dtc, clean).breaks.map((b) => [b.code, b.subLedger]), [["CLIENT_ID_UNKNOWN", "C-BIRCH-003"]]);
  });
  it("CAPTURE_TIME_MISMATCH", () => {
    assert.deepEqual(reconcile(input(12500n), dtc, { ...clean, snapshotAt: "2027-01-16T01:00:05Z" }).breaks.map((b) => b.code), ["CAPTURE_TIME_MISMATCH"]);
  });
});

describe("diffPositions", () => {
  it("reports missing and differing wallets on either side", () => {
    const d = diffPositions([{ address: "A", tokens: 1n }, { address: "B", tokens: 2n }], [{ walletAddress: "B", tokens: 3n }, { walletAddress: "C", tokens: 4n }]);
    assert.deepEqual(d, [
      { address: "A", ours: 1n, theirs: 0n },
      { address: "B", ours: 2n, theirs: 3n },
      { address: "C", ours: 0n, theirs: 4n },
    ]);
  });
});
