// SPDX-License-Identifier: Apache-2.0
// Drill-down facts for the web report, read from captured testnet fixtures (no network).
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadAllCases } from "../src/fixtures/load.ts";
import { caseFacts } from "../src/report/facts.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const loaded = loadAllCases(join(root, "../../fixtures/preflight-harness/cases")).filter((l) => l.state);
const get = (id: string) => {
  const l = loaded.find((x) => x.testCase.caseId === id);
  assert.ok(l, `fixture ${id} present`);
  return caseFacts(l.testCase, l.state!, l.truth, l.stateProvenance);
};

test("facts: line-full shows the destination's TEST trustline with balance at the limit and the Horizon result", () => {
  const f = get("classic.line-full");
  assert.equal(f.network, "testnet");
  const dest = f.accounts.find((a) => a.role === "destination");
  assert.equal(dest?.status, "funded");
  assert.equal(dest?.trustline?.status, "present");
  assert.ok(dest?.trustline?.limit !== undefined && dest.trustline.balance !== undefined);
  assert.ok(BigInt(dest.trustline.limit!) - BigInt(dest.trustline.balance!) < 10n * 10_000_000n, "room is below the 10-unit amount");
  assert.deepEqual(f.groundTruth && f.groundTruth.kind === "horizon-result" ? f.groundTruth.operationResult : null, "op_line_full");
  assert.equal(f.provenance?.readsAreAtomic, false);
});

test("facts: trustline-missing reports the trustline as absent, not as zero", () => {
  const dest = get("classic.trustline-missing").accounts.find((a) => a.role === "destination");
  assert.equal(dest?.trustline?.status, "absent");
  assert.equal(dest?.trustline?.balance, undefined);
});

test("facts: unfunded destination is 'missing' (read and absent), never a zero balance", () => {
  const dest = get("classic.unfunded-credit-asset").accounts.find((a) => a.role === "destination");
  assert.equal(dest?.status, "missing");
  assert.equal(dest?.balanceStroops, undefined);
});

test("facts: SAC case carries its recorded simulation with the contract error code and the first error line only", () => {
  const f = get("sac.c-address-needs-auth");
  assert.equal(f.simulations.length, 1);
  assert.equal(f.simulations[0]?.ok, false);
  assert.equal(f.simulations[0]?.contractErrorCode, 11);
  assert.doesNotMatch(f.simulations[0]?.error ?? "", /\n/);
  assert.ok(f.contracts.some((c) => c.kind === "sac" && c.exists));
});

test("facts: every captured case yields facts at its own ledger", () => {
  for (const l of loaded) {
    const f = caseFacts(l.testCase, l.state!, l.truth, l.stateProvenance);
    assert.equal(f.ledger, l.state!.ledger);
    assert.ok(f.ledger > 0);
  }
});
