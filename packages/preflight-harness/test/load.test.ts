// SPDX-License-Identifier: Apache-2.0
// PFH-003: fixture loader. Negative fixtures are written to a temp dir at test time (a seed-shaped string may not
// exist anywhere in the repository, pnpm lint rejects it).
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadAllCases, loadCaseDir } from "../src/fixtures/load.ts";
import { PfhError } from "../src/errors.ts";
import { run } from "../src/cli.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const synthetic = join(root, "../../fixtures/preflight-harness/synthetic");

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "pfh-load-"));
  cpSync(join(synthetic, "synthetic.ready"), join(dir, "synthetic.ready"), { recursive: true });
  return dir;
}
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof PfhError ? e.code : `not-a-PfhError: ${String(e)}`;
  }
  return undefined;
};

test("load: both synthetic fixtures load with state and provenance", () => {
  const all = loadAllCases(synthetic);
  assert.deepEqual(all.map((c) => c.testCase.caseId).sort(), ["synthetic.ready", "synthetic.trustline-missing"]);
  for (const c of all) {
    assert.ok(c.state, `${c.testCase.caseId} has state`);
    assert.equal(c.stateProvenance?.source.kind, "synthetic");
    assert.equal(c.truth, undefined);
  }
});

test("load: missing provenance beside state.json fails with PFH_E_FIXTURE_PROVENANCE_MISSING", () => {
  const dir = scratch();
  rmSync(join(dir, "synthetic.ready/state.provenance.json"));
  assert.equal(code(() => loadCaseDir(join(dir, "synthetic.ready"))), "PFH_E_FIXTURE_PROVENANCE_MISSING");
});

test("load: a seed-shaped string anywhere fails with PFH_E_FIXTURE_SECRET", () => {
  const dir = scratch();
  const p = join(dir, "synthetic.ready/state.json");
  const seedShaped = "S" + "B" + "C".repeat(54);
  writeFileSync(p, readFileSync(p, "utf8").replace('"testnet"', `"testnet", "note": "${seedShaped}"`));
  assert.equal(code(() => loadCaseDir(join(dir, "synthetic.ready"))), "PFH_E_FIXTURE_SECRET");
});

test("load: wrong schema version fails with PFH_E_FIXTURE_INVALID", () => {
  const dir = scratch();
  const p = join(dir, "synthetic.ready/case.json");
  writeFileSync(p, readFileSync(p, "utf8").replace("sik.case/1", "sik.case/2"));
  assert.equal(code(() => loadCaseDir(join(dir, "synthetic.ready"))), "PFH_E_FIXTURE_INVALID");
});

test("load: case id that differs from its directory name fails with PFH_E_FIXTURE_INVALID", () => {
  const dir = scratch();
  cpSync(join(dir, "synthetic.ready"), join(dir, "synthetic.renamed"), { recursive: true });
  assert.equal(code(() => loadCaseDir(join(dir, "synthetic.renamed"))), "PFH_E_FIXTURE_INVALID");
});

test("load: truth.json without truth.provenance.json fails; with it, truth is returned", () => {
  const dir = scratch();
  const caseDir = join(dir, "synthetic.ready");
  writeFileSync(join(caseDir, "truth.json"), JSON.stringify({ kind: "none", note: "test" }));
  assert.equal(code(() => loadCaseDir(caseDir)), "PFH_E_FIXTURE_PROVENANCE_MISSING");
  const prov = JSON.parse(readFileSync(join(caseDir, "state.provenance.json"), "utf8"));
  writeFileSync(join(caseDir, "truth.provenance.json"), JSON.stringify({ ...prov, fixture: "truth.json" }));
  assert.deepEqual(loadCaseDir(caseDir).truth, { kind: "none", note: "test" });
});

test("cli: fixtures validate exits 0 on the synthetic root and 1 on a broken one", async () => {
  assert.equal(await run(["fixtures", "validate", "--root", synthetic]), 0);
  const dir = scratch();
  rmSync(join(dir, "synthetic.ready/state.provenance.json"));
  assert.equal(await run(["fixtures", "validate", "--root", dir]), 1);
});
