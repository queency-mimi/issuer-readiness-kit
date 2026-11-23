// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AllocationRefused, allocateConsolidatedCredit } from "../src/index.ts";
import { input } from "./helpers.ts";

/** Small seeded PRNG (mulberry32) so the property test is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("allocateConsolidatedCredit (DTC-033)", () => {
  it("SC-025: 50/30/20 tokens and 100003 cents -> largest remainder, deterministic", () => {
    const plan = allocateConsolidatedCredit(input(100003n));
    assert.deepEqual(plan.lines.map((l) => [l.subLedger, l.tokens, l.amount]), [
      ["C-BIRCH-001", 50n, 50001n],
      ["C-BIRCH-002", 30n, 30001n],
      ["C-BIRCH-003", 20n, 20001n],
    ]);
    assert.equal(plan.rounding, "largest-remainder");
    assert.deepEqual(plan.lines[0]?.wallets, ["W1a", "W1b"]);
    assert.match(plan.checksum, /^[0-9a-f]{64}$/);
    assert.equal(plan.trust.status, "inferred");
  });

  it("internal wallets go to HOUSE; ties are broken by sub-ledger id ascending", () => {
    const plan = allocateConsolidatedCredit(input(2n, [["H1", 1n], ["W2", 1n], ["W1a", 1n]]));
    // 2 cents over 3 equal holders: each floor 0, remainder equal; the leftover 2 go to the two smallest ids.
    assert.deepEqual(plan.lines.map((l) => [l.subLedger, l.amount]), [["C-BIRCH-001", 1n], ["C-BIRCH-002", 1n], ["HOUSE", 0n]]);
  });

  it("refuses an unmapped wallet instead of guessing", () => {
    assert.throws(() => allocateConsolidatedCredit(input(100n, [["W1a", 1n], ["STRANGER", 1n]])), (e: unknown) => e instanceof AllocationRefused && e.code === "UNMAPPED_WALLET");
  });

  it("refuses a credit with no positions; zero credit and zero positions is an empty plan", () => {
    assert.throws(() => allocateConsolidatedCredit(input(5n, [])), (e: unknown) => e instanceof AllocationRefused && e.code === "CREDIT_WITHOUT_POSITIONS");
    assert.deepEqual(allocateConsolidatedCredit(input(0n, [])).lines, []);
  });

  it("refuses a wallet mapped to a client absent from the books", () => {
    const i = input(10n, [["W1a", 1n]]);
    i.books = { ...i.books, clients: [] };
    assert.throws(() => allocateConsolidatedCredit(i), (e: unknown) => e instanceof AllocationRefused && e.code === "CLIENT_ID_UNKNOWN");
  });

  it("SC-026 property: 10,000 seeded random cases keep every invariant", () => {
    const rand = prng(20261108);
    const ids = ["W1a", "W1b", "W2", "W3a", "W3b", "H1"];
    for (let n = 0; n < 10_000; n++) {
      const positions = ids.filter(() => rand() < 0.8).map((a) => [a, BigInt(Math.floor(rand() * 1_000_000))] as [string, bigint]);
      const total = positions.reduce((s, [, t]) => s + t, 0n);
      const amount = total === 0n ? 0n : BigInt(Math.floor(rand() * 1e12));
      const plan = allocateConsolidatedCredit(input(amount, positions));
      assert.equal(plan.lines.reduce((s, l) => s + l.amount, 0n), amount, `case ${n}: sum`);
      for (const l of plan.lines) {
        assert.ok(l.amount >= 0n, `case ${n}: negative`);
        const diff = l.amount * total - amount * l.tokens;
        assert.ok(diff > -total && diff < total, `case ${n}: ${l.subLedger} more than 1 cent from exact pro rata`);
      }
      if (n % 50 === 0) {
        const shuffled = allocateConsolidatedCredit(input(amount, [...positions].reverse()));
        assert.equal(shuffled.checksum, plan.checksum, `case ${n}: order dependence`);
      }
    }
  });
});
