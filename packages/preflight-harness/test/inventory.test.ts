// SPDX-License-Identifier: Apache-2.0
// PFH-001: the recorded inventories cover every code the installed libraries (and the clone, read as text) can emit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkInventory, extractCodes } from "../src/taxonomy/inventory-check.ts";
import { LIBRARY_INVENTORY } from "../src/taxonomy/library-maps.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("inventory: installed npm libraries emit only inventoried codes", () => {
  const result = checkInventory(LIBRARY_INVENTORY, root);
  const gate = result.find((r) => r.adapterId === "stellagate-core")!;
  const check = result.find((r) => r.adapterId === "stellar-check")!;
  assert.deepEqual(gate.missingFromInventory, []);
  assert.deepEqual(check.missingFromInventory, []);
  assert.equal(check.found!.length, 18);
  // stellagate-core: the inventory was read at git HEAD 5cdd7cd, newer than the 0.1.1 tarball.
  assert.deepEqual(gate.notInInstalled, ["account_unavailable", "memo_invalid"]);
});

test("inventory: removing a code from a copy of the inventory makes the check fail", () => {
  const copy = structuredClone(LIBRARY_INVENTORY);
  copy["stellar-check"].codes = copy["stellar-check"].codes.filter((c) => c !== "MEMO_REQUIRED");
  const r = checkInventory(copy, root).find((x) => x.adapterId === "stellar-check")!;
  assert.deepEqual(r.missingFromInventory, ["MEMO_REQUIRED"]);
});

test("inventory: stellar-preflight is read as text when cloned, skipped otherwise", () => {
  const r = checkInventory(LIBRARY_INVENTORY, root).find((x) => x.adapterId === "stellar-preflight")!;
  if (r.skipped) assert.match(r.skipped, /not fetched/);
  else {
    assert.equal(r.found!.length, 32);
    assert.deepEqual(r.missingFromInventory, []);
  }
});

test("inventory: extractCodes reads object keys, union members and code literals", () => {
  assert.deepEqual(extractCodes("object-keys", "export const codes = {\n  FOO_1: {\n  },\n  BAR: { severity: 'x' },\n};"), ["BAR", "FOO_1"]);
  assert.deepEqual(extractCodes("union:DiagnosticCode", "export type DiagnosticCode = 'A' | 'B_C';\nexport type X = 'Z';"), ["A", "B_C"]);
  assert.deepEqual(extractCodes("code-literals", 'push({ code: "x_y", a }); { code: "z" }; code: b.asset_code'), ["x_y", "z"]);
});

test("cli script: scripts/check-inventory.ts exits 0 today", () => {
  const out = execFileSync(process.execPath, [root + "scripts/check-inventory.ts"], { encoding: "utf8" });
  assert.match(out, /stellagate-core: ok/);
  assert.match(out, /stellar-check: ok/);
});
