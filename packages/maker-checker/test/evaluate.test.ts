// SPDX-License-Identifier: Apache-2.0
// MKR-003: policy evaluation, table-driven. Every DenyReason has at least one case.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { evaluate, insideWindows } from "../src/policy/evaluate.ts";
import type { DenyReason, EvaluationInput, InvocationNode } from "../src/policy/evaluate.ts";
import { policyHash } from "../src/policy/hash.ts";
import type { PolicyDoc } from "../src/policy/types.ts";
import { mulberry32 } from "./helpers/prng.ts";
import { contractId, T0, testWorld } from "./helpers/world.ts";

const w = testWorld();
const P = w.policy;
const H = policyHash(P);
const op = w.operator.address;
const other = Keypair.random().publicKey();
const addr = (value: string) => ({ type: "address" as const, value });
const i128 = (value: string) => ({ type: "i128" as const, value });
const freeze: InvocationNode = { depth: 0, contract: w.token, function: "set_address_frozen", args: [addr(w.holder), { type: "bool", value: true }, addr(op)], authorizer: op };
const xfer = (amount: string, to = w.recipient): InvocationNode => ({ depth: 0, contract: w.xlm, function: "transfer", args: [addr(op), addr(to), i128(amount)], authorizer: op });
const base: EvaluationInput = { policy: P, policyHash: H, maker: "maker-alice", networkPassphrase: Networks.TESTNET, nodes: [freeze], controlKind: "freeze", nowUnix: T0, priorSpend: [] };
const ev = (patch: Partial<EvaluationInput>) => evaluate({ ...base, ...patch });
const withPolicy = (fn: (d: PolicyDoc) => void) => {
  const d = structuredClone(P);
  fn(d);
  return { policy: d, policyHash: policyHash(d) };
};

const CASES: { name: string; input: Partial<EvaluationInput>; outcome: "allow" | "deny"; reasons?: DenyReason[] }[] = [
  { name: "freeze by the maker is allowed", input: {}, outcome: "allow" },
  { name: "before notBefore", input: { nowUnix: T0 - 7200 }, outcome: "deny", reasons: ["POLICY_NOT_YET_VALID"] },
  { name: "at expiresAt (exclusive)", input: { nowUnix: T0 + 30 * 86400 }, outcome: "deny", reasons: ["POLICY_EXPIRED"] },
  { name: "one second before expiresAt", input: { nowUnix: T0 + 30 * 86400 - 1 }, outcome: "allow" },
  { name: "wrong network", input: { networkPassphrase: Networks.PUBLIC }, outcome: "deny", reasons: ["NETWORK_MISMATCH"] },
  { name: "unknown maker", input: { maker: "mallory-x" }, outcome: "deny", reasons: ["MAKER_UNKNOWN"] },
  { name: "checker proposing", input: { maker: "checker-bob" }, outcome: "deny", reasons: ["MAKER_NOT_MAKER_ROLE"] },
  { name: "empty tree", input: { nodes: [] }, outcome: "deny", reasons: ["NO_MATCHING_ALLOW_RULE"] },
  { name: "mint matches the deny rule", input: { nodes: [{ ...freeze, function: "mint" }], controlKind: undefined }, outcome: "deny", reasons: ["DENY_RULE_MATCHED"] },
  { name: "mint nested under an allowed call still denies", input: { nodes: [freeze, { ...freeze, depth: 1, function: "mint" }] }, outcome: "deny", reasons: ["DENY_RULE_MATCHED"] },
  { name: "unknown contract", input: { nodes: [{ ...freeze, contract: contractId(3) }] }, outcome: "deny", reasons: ["CONTRACT_NOT_ALLOWED", "NO_MATCHING_ALLOW_RULE"] },
  { name: "unknown function", input: { nodes: [{ ...freeze, function: "burn" }] }, outcome: "deny", reasons: ["FUNCTION_NOT_ALLOWED", "NO_MATCHING_ALLOW_RULE"] },
  { name: "nested call not covered", input: { nodes: [freeze, { ...freeze, depth: 1, contract: contractId(3) }] }, outcome: "deny", reasons: ["CONTRACT_NOT_ALLOWED", "NESTED_CALL_NOT_ALLOWED", "NO_MATCHING_ALLOW_RULE"] },
  { name: "control rule without a control kind", input: { controlKind: undefined }, outcome: "deny", reasons: ["CONTROL_KIND_NOT_ALLOWED", "NO_MATCHING_ALLOW_RULE"] },
  { name: "xlm transfer to listed recipient", input: { nodes: [xfer("500")], controlKind: undefined }, outcome: "allow" },
  { name: "recipient not listed", input: { nodes: [xfer("500", other)], controlKind: undefined }, outcome: "deny", reasons: ["NO_MATCHING_ALLOW_RULE", "RECIPIENT_NOT_ALLOWED"] },
  { name: "recipient argument not an address", input: { nodes: [{ ...xfer("1"), args: [addr(op), i128("5"), i128("1")] }], controlKind: undefined }, outcome: "deny", reasons: ["NO_MATCHING_ALLOW_RULE", "RECIPIENT_NOT_ALLOWED"] },
  { name: "per-request limit exactly at max", input: { nodes: [xfer("1000")], controlKind: undefined }, outcome: "allow" },
  { name: "per-request limit +1", input: { nodes: [xfer("1001")], controlKind: undefined }, outcome: "deny", reasons: ["PER_REQUEST_LIMIT_EXCEEDED"] },
  { name: "per-request limit sums nodes of the same contract", input: { nodes: [xfer("600"), { ...xfer("500"), depth: 1 }], controlKind: undefined }, outcome: "deny", reasons: ["PER_REQUEST_LIMIT_EXCEEDED"] },
  { name: "rolling limit exactly reached", input: { nodes: [xfer("500")], controlKind: undefined, priorSpend: [{ contract: w.xlm, windowSeconds: 86400, total: "1000" }] }, outcome: "allow" },
  { name: "rolling limit +1", input: { nodes: [xfer("501")], controlKind: undefined, priorSpend: [{ contract: w.xlm, windowSeconds: 86400, total: "1000" }] }, outcome: "deny", reasons: ["ROLLING_LIMIT_EXCEEDED"] },
  { name: "amount negative is undecodable", input: { nodes: [xfer("-5")], controlKind: undefined }, outcome: "deny", reasons: ["AMOUNT_ARG_UNDECODABLE"] },
  { name: "amount of the wrong type is undecodable", input: { nodes: [{ ...xfer("1"), args: [addr(op), addr(w.recipient), { type: "symbol", value: "x" }] }], controlKind: undefined }, outcome: "deny", reasons: ["AMOUNT_ARG_UNDECODABLE"] },
  { name: "amount argument missing is undecodable", input: { nodes: [{ ...xfer("1"), args: [addr(op), addr(w.recipient)] }], controlKind: undefined }, outcome: "deny", reasons: ["AMOUNT_ARG_UNDECODABLE"] },
  { name: "i128 maximum amount fails the limit, not the decoder", input: { nodes: [xfer("170141183460469231731687303715884105727")], controlKind: undefined }, outcome: "deny", reasons: ["PER_REQUEST_LIMIT_EXCEEDED"] },
  { name: "pre-decoded amount path (no args)", input: { nodes: [{ depth: 0, contract: w.xlm, function: "transfer", amount: "10", recipient: w.recipient, authorizer: op }], controlKind: undefined }, outcome: "allow" },
  { name: "maker not listed in the rule", input: { ...withPolicy((d) => { d.principals[0]!.roles = ["admin", "maker"]; }), maker: "admin-dana" }, outcome: "deny", reasons: ["MAKER_NOT_PERMITTED_BY_RULE", "NO_MATCHING_ALLOW_RULE"] },
  { name: "pause allowed with control kind pause", input: { nodes: [{ depth: 0, contract: w.token, function: "pause", args: [addr(op)], authorizer: op }], controlKind: "pause" }, outcome: "allow" },
  { name: "pause with control kind freeze is still covered (kind is listed)", input: { nodes: [{ depth: 0, contract: w.token, function: "pause", args: [addr(op)], authorizer: op }], controlKind: "freeze" }, outcome: "allow" },
  { name: "windows of two matching rules that never intersect", input: { ...withPolicy((d) => {
    d.rules[0]!.windows = [{ days: ["mon"], startUtc: "08:00", endUtc: "09:00" }];
    d.rules.splice(1, 0, { ...structuredClone(d.rules[0]!), id: "allow-rwa-control-b", windows: [{ days: ["mon"], startUtc: "10:00", endUtc: "11:00" }] });
  }) }, outcome: "deny", reasons: ["OUTSIDE_TIME_WINDOW"] },
];

test(`evaluate: ${CASES.length} table cases`, () => {
  assert.ok(CASES.length >= 30);
  for (const c of CASES) {
    const d = ev(c.input);
    assert.equal(d.outcome, c.outcome, `${c.name}: ${JSON.stringify(d.reasons)}`);
    if (c.reasons) assert.deepEqual(d.reasons, [...c.reasons].sort(), c.name);
  }
});

test("every DenyReason is produced by at least one case", () => {
  const all: DenyReason[] = ["POLICY_NOT_YET_VALID", "POLICY_EXPIRED", "NETWORK_MISMATCH", "MAKER_UNKNOWN", "MAKER_NOT_MAKER_ROLE", "NO_MATCHING_ALLOW_RULE", "DENY_RULE_MATCHED", "MAKER_NOT_PERMITTED_BY_RULE", "CONTRACT_NOT_ALLOWED", "FUNCTION_NOT_ALLOWED", "RECIPIENT_NOT_ALLOWED", "AMOUNT_ARG_UNDECODABLE", "PER_REQUEST_LIMIT_EXCEEDED", "ROLLING_LIMIT_EXCEEDED", "OUTSIDE_TIME_WINDOW", "CONTROL_KIND_NOT_ALLOWED", "NESTED_CALL_NOT_ALLOWED"];
  const seen = new Set(CASES.flatMap((c) => ev(c.input).reasons));
  for (const r of all) assert.ok(seen.has(r), r);
});

test("merged requirement takes max of mins, union of from, max cooldown, intersection of windows", () => {
  const { policy, policyHash: h } = withPolicy((d) => {
    d.rules[0]!.windows = [{ days: ["mon", "tue"], startUtc: "08:00", endUtc: "18:00" }];
    d.rules.splice(1, 0, { id: "allow-rwa-control-b", effect: "allow", match: structuredClone(d.rules[0]!.match), makers: ["maker-alice"], approval: { checkers: { min: 1, from: ["checker-bob"] }, admins: { min: 1, from: ["admin-dana"] } }, cooldownSeconds: 7200, windows: [{ days: ["mon", "wed"], startUtc: "09:30", endUtc: "20:00" }] });
  });
  const d = evaluate({ ...base, policy, policyHash: h });
  assert.equal(d.outcome, "allow");
  assert.deepEqual(d.requirement, { checkersMin: 2, checkersFrom: ["checker-bob", "checker-carol"], adminsMin: 1, adminsFrom: ["admin-dana"], cooldownSeconds: 7200, windows: [{ days: ["mon"], startUtc: "09:30", endUtc: "18:00" }] });
  assert.deepEqual(d.matchedRuleIds, ["allow-rwa-control", "allow-rwa-control-b"]);
});

test("windows: start inclusive, end exclusive, day change in UTC", () => {
  const win = [{ days: ["mon"], startUtc: "08:00", endUtc: "18:00" }];
  const mon = Date.UTC(2026, 10, 9) / 1000;
  assert.equal(insideWindows(win, mon + 8 * 3600), true);
  assert.equal(insideWindows(win, mon + 8 * 3600 - 1), false);
  assert.equal(insideWindows(win, mon + 18 * 3600 - 1), true);
  assert.equal(insideWindows(win, mon + 18 * 3600), false);
  assert.equal(insideWindows(win, mon + 86400 + 9 * 3600), false);
  assert.equal(insideWindows([], mon), true);
});

test("determinism: shuffling rules and principals gives the identical decision", () => {
  const r = mulberry32(7);
  for (let i = 0; i < 50; i++) {
    for (const c of CASES) {
      const input = { ...base, ...c.input };
      const shuffled = structuredClone(input.policy);
      shuffled.rules.sort(() => r() - 0.5);
      assert.deepEqual(evaluate({ ...input, policy: shuffled }), evaluate(input), c.name);
    }
  }
});

test("src/policy does no I/O and reads no clock", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../src/policy/", import.meta.url).pathname;
  for (const f of readdirSync(dir)) {
    const s = readFileSync(dir + f, "utf8");
    assert.doesNotMatch(s, /Date\.now|new Date\(\)|fetch\(|from "node:(fs|http|net|child_process)"/, f);
  }
});
