// SPDX-License-Identifier: Apache-2.0
// MKR-002: fail-closed parser and validator.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { parsePolicyDoc, validatePolicyDoc } from "../src/policy/parse.ts";
import { testWorld } from "./helpers/world.ts";

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;
const root = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(root + p, "utf8");
const example = read("../../fixtures/maker-checker/policies/example-treasury.policy.json");
const codes = (text: string) => {
  const r = parsePolicyDoc(text);
  return "violations" in r ? r.violations.map((v) => v.code) : [];
};
const mutate = (fn: (d: Record<string, any>) => void) => {
  const d = JSON.parse(example);
  fn(d);
  return JSON.stringify(d);
};

test("the example policy parses with zero violations", () => {
  const r = parsePolicyDoc(example);
  assert.ok("doc" in r, JSON.stringify(r));
});

test("every invalid fixture produces its expected code (EXPECT.json)", () => {
  const expect = JSON.parse(read("../../fixtures/maker-checker/policies/invalid/EXPECT.json")).expect as Record<string, string>;
  assert.equal(Object.keys(expect).length, 20);
  for (const [file, code] of Object.entries(expect)) assert.ok(codes(read("../../fixtures/maker-checker/policies/invalid/" + file)).includes(code), `${file} -> ${code}`);
});

test("three independent faults are all reported", () => {
  const c = codes(mutate((d) => {
    d.extra = 1;
    d.validity.expiresAt = "2026-01-01T00:00:00Z";
    d.principals[0].address = "GABC";
  }));
  assert.ok(c.includes("PD_UNKNOWN_FIELD") && c.includes("PD_VALIDITY_ORDER") && c.includes("PD_BAD_VALUE"), c.join());
});

test("tokenizer: null, floats, unsafe integers, syntax errors, deep nesting", () => {
  assert.ok(codes(mutate((d) => (d.supersedes = null))).includes("PD_BAD_TYPE"));
  assert.ok(codes(example.replace('"requestTtlSeconds": 86400', '"requestTtlSeconds": 86400.5')).includes("PD_BAD_TYPE"));
  assert.ok(codes(example.replace('"requestTtlSeconds": 86400', '"requestTtlSeconds": 1e3')).includes("PD_BAD_TYPE"));
  assert.ok(codes(example.replace('"requestTtlSeconds": 86400', '"requestTtlSeconds": 9007199254740993')).includes("PD_BAD_VALUE"));
  assert.deepEqual(codes(example + "x"), ["PD_SYNTAX"]);
  assert.deepEqual(codes("{"), ["PD_SYNTAX"]);
  assert.deepEqual(codes("[".repeat(100) + "]".repeat(100)), ["PD_SYNTAX"]);
});

test("a __proto__ key is data (rejected as unknown), never a prototype change", () => {
  const c = codes(example.replace('"version": 1,', '"version": 1, "__proto__": {"x": 1},'));
  assert.ok(c.includes("PD_UNKNOWN_FIELD"));
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test("semantic codes not covered by fixtures: dead rule, unknown principal, impossible dates, i128 overflow, duplicate rule id", () => {
  assert.ok(codes(mutate((d) => (d.rules[1].approval.checkers = { min: 1, from: ["maker-alice"] }))).includes("PD_ROLE_MISSING"));
  assert.ok(codes(mutate((d) => (d.rules[0].makers = ["nobody-zed"]))).includes("PD_UNKNOWN_PRINCIPAL"));
  assert.ok(codes(mutate((d) => (d.validity.notBefore = "2026-02-30T00:00:00Z"))).includes("PD_BAD_VALUE"));
  assert.ok(codes(mutate((d) => (d.rules[1].limits.perRequest[0].max = "170141183460469231731687303715884105728"))).includes("PD_BAD_VALUE"));
  assert.ok(codes(mutate((d) => (d.rules[2].id = d.rules[1].id))).includes("PD_DUPLICATE_ID"));
  // Dead rule: the only maker is also the only checker, so S1 leaves nobody to approve.
  const w = testWorld();
  const doc = structuredClone(w.policy) as any;
  doc.principals[3].roles = ["checker", "maker"];
  doc.rules[1].approval.checkers = { min: 1, from: ["maker-alice"] };
  assert.ok(validatePolicyDoc(doc).some((v) => v.code === "PD_DEAD_RULE"));
});

test("a document that passes the parser also passes the JSON Schema", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const v = ajv.compile(JSON.parse(read("../../schemas/maker-checker/policy-doc.schema.json")));
  for (const text of [example, JSON.stringify(testWorld().policy)]) {
    const r = parsePolicyDoc(text);
    assert.ok("doc" in r);
    assert.ok(v(r.doc), JSON.stringify(v.errors));
  }
});
