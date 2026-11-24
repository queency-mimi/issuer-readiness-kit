// SPDX-License-Identifier: Apache-2.0
// MKR-001: RFC 8785 subset canonicaliser, policyHash, and agreement with an independent reference.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalize, canonicalBytes } from "../src/canonical.ts";
import { MkrError } from "../src/errors.ts";
import { sha256Hex } from "../src/hash.ts";
import { policyHash } from "../src/policy/hash.ts";
import { parsePolicyDoc } from "../src/policy/parse.ts";
import { mulberry32, seedFromEnv, pick } from "./helpers/prng.ts";

const root = new URL("..", import.meta.url).pathname;

// [input, expected canonical text]. (a) RFC 8785 3.2.2/3.2.3 examples restricted to the subset; (b) edge cases.
const VECTORS: [unknown, string][] = [
  [{}, "{}"],
  [[], "[]"],
  [true, "true"],
  [false, "false"],
  [0, "0"],
  [-0, "0"],
  [-1, "-1"],
  [9007199254740991, "9007199254740991"],
  [-9007199254740991, "-9007199254740991"],
  ["", '""'],
  ["a", '"a"'],
  [{ b: 1, a: 2 }, '{"a":2,"b":1}'],
  [{ a: { d: 1, c: 2 }, b: [3, { f: 1, e: 2 }] }, '{"a":{"c":2,"d":1},"b":[3,{"e":2,"f":1}]}'],
  [[3, 1, 2], "[3,1,2]"],
  // RFC 8785 3.2.3 sorting example (keys by UTF-16 code units), values made subset-safe.
  [{ "€": "Euro Sign", "\r": "Carriage Return", "דּ": "Hebrew Letter Dalet With Dagesh", "1": "One", "😀": "Emoji: Grinning Face", "\u0080": "Control", "ö": "Latin Small Letter O With Diaeresis" },
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}'],
  // RFC 8785 3.2.2.2 string escaping: only " \ and C0 controls.
  ["\u0000", '"\\u0000"'],
  ["\u0001\u001f", '"\\u0001\\u001f"'],
  ["\b\f\n\r\t", '"\\b\\f\\n\\r\\t"'],
  ['"', '"\\""'],
  ["\\", '"\\\\"'],
  ["/", '"/"'],
  ["\u007f", '"\u007f"'],
  ["  ", '"  "'],
  ["é", '"é"'],
  ["𝄞", '"𝄞"'],
  ["\u000b", '"\\u000b"'],
  ["\u001e", '"\\u001e"'],
  [{ "": 1 }, '{"":1}'],
  [{ a: "", b: [] }, '{"a":"","b":[]}'],
  [[[[]]], "[[[]]]"],
  [[{}, {}], "[{},{}]"],
  [{ z: true, y: false }, '{"y":false,"z":true}'],
  [{ aa: 1, a: 2, b: 3 }, '{"a":2,"aa":1,"b":3}'],
  [{ B: 1, a: 2 }, '{"B":1,"a":2}'],
  [{ "": 1, "𐀀": 2 }, '{"𐀀":2,"":1}'],
  [{ amount: "170141183460469231731687303715884105727" }, '{"amount":"170141183460469231731687303715884105727"}'],
  [Object.assign(Object.create(null), { b: 1, a: 1 }), '{"a":1,"b":1}'],
  [{ "\u0000k": 1 }, '{"\\u0000k":1}'],
  [[true, false, 0, ""], '[true,false,0,""]'],
  [{ nested: { deeper: { deepest: [1, 2, { x: "y" }] } } }, '{"nested":{"deeper":{"deepest":[1,2,{"x":"y"}]}}}'],
  [{ "é": 1, e: 2, f: 3 }, '{"e":2,"f":3,"é":1}'],
];

test(`canonicalize: ${VECTORS.length} vectors (RFC 8785 examples within the subset and edge cases)`, () => {
  assert.ok(VECTORS.length >= 40);
  for (const [input, expected] of VECTORS) assert.equal(canonicalize(input), expected, JSON.stringify(expected));
});

test("canonicalize rejects every unsupported value with MKR_E_CANON_UNSUPPORTED_VALUE", () => {
  const bad: unknown[] = [1.5, 2 ** 53, -(2 ** 53), NaN, Infinity, -Infinity, undefined, null, 10n, Symbol("s"), () => 1, "\ud800", "a\udc00b", { a: undefined }, { a: null }, new Date(0), new Map(), [1, , 2], { [Symbol("k")]: 1 }, { "\ud800": 1 }];
  bad.forEach((b, i) => {
    assert.throws(() => canonicalize(b), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_CANON_UNSUPPORTED_VALUE", `bad value #${i}`);
  });
});

test("canonicalBytes is the UTF-8 of canonicalize", () => {
  assert.deepEqual(canonicalBytes({ "é": "€" }), new TextEncoder().encode('{"é":"€"}'));
});

function python(file: string): string | undefined {
  const r = spawnSync("python3", ["-I", root + "scripts/jcs_reference.py", file], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : undefined;
}

test("example policy: canonical bytes equal the independent Python reference, hash recorded in the fixture", (t) => {
  const f = root + "../../fixtures/maker-checker/policies/example-treasury.policy.json";
  const r = parsePolicyDoc(readFileSync(f, "utf8"));
  assert.ok("doc" in r);
  const ref = python(f);
  if (ref === undefined) return t.skip("python3 not available");
  assert.equal(canonicalize(r.doc), ref);
  const h = policyHash(r.doc);
  assert.equal(h, sha256Hex(ref));
  assert.equal(readFileSync(root + "../../fixtures/maker-checker/policies/example-treasury.policy.hash", "utf8").trim(), h);
});

test("differential: 300 generated documents canonicalise identically in TS and the Python reference", (t) => {
  const seed = seedFromEnv(20261108);
  const r = mulberry32(seed);
  const chars = ["a", "b", "Z", "é", "€", " ", "😀", "דּ", "\u0001", "\n", '"', "\\", "/", "\u007f", " ", "0"];
  const str = () => Array.from({ length: Math.floor(r() * 6) }, () => pick(r, chars)).join("");
  const val = (d: number): unknown => {
    const k = Math.floor(r() * (d > 3 ? 4 : 6));
    if (k === 0) return str();
    if (k === 1) return Math.floor((r() - 0.5) * 2 ** 40);
    if (k === 2) return r() < 0.5;
    if (k === 3) return pick(r, [0, -1, 9007199254740991, -9007199254740991]);
    if (k === 4) return Array.from({ length: Math.floor(r() * 4) }, () => val(d + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(r() * 4) }, () => [str(), val(d + 1)]));
  };
  const docs = Array.from({ length: 300 }, () => val(0));
  const dir = mkdtempSync(join(tmpdir(), "mkr-jcs-"));
  const file = join(dir, "docs.json");
  writeFileSync(file, JSON.stringify(docs));
  const ref = python(file);
  if (ref === undefined) return t.skip("python3 not available");
  assert.equal(canonicalize(docs), ref, `seed ${seed}`);
});
