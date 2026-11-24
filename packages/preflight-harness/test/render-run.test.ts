// SPDX-License-Identifier: Apache-2.0
// PFH-007 renderers and PFH-008 `pfh run` / `pfh report` over the synthetic fixtures (offline, fetch blocked).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderJson, renderMarkdown } from "../src/report/render.ts";
import { runHarness } from "../src/run.ts";
import { run } from "../src/cli.ts";
import { schemaErrors } from "../src/fixtures/validate.ts";
import type { DiffReport } from "../src/report/diff.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const synthetic = join(root, "../../fixtures/preflight-harness/synthetic");
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error("network access during replay");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
const FIXED = "2026-11-08T00:00:00Z";

test("runHarness: synthetic fixtures through the two npm adapters; verdicts are schema-valid", async () => {
  const { verdicts, report } = await runHarness({ fixturesRoot: synthetic, adapters: ["stellagate-core", "stellar-check"], generatedAt: FIXED });
  assert.equal(verdicts.length, 4);
  for (const v of verdicts) assert.equal(schemaErrors("receive-verdict", v), null, JSON.stringify(v));
  assert.equal(report.rows.length, 2);
  assert.equal(report.summary.cases, 0, "synthetic cases never count in the headline");
  assert.equal(report.summary.synthetic, 2);
  assert.deepEqual(report.notEvaluated, [], "a synthetic-only run lists no uncaptured catalogue cases");
});

test("runHarness: an unavailable adapter yields error verdicts and the run continues", async () => {
  const saved = process.env["PFH_ALLOW_COMPETITOR_CODE"];
  delete process.env["PFH_ALLOW_COMPETITOR_CODE"];
  try {
    const { verdicts, report } = await runHarness({ fixturesRoot: synthetic, generatedAt: FIXED });
    assert.equal(verdicts.filter((v) => v.adapterId === "stellar-preflight" && v.error?.kind === "adapter_unavailable").length, 2);
    assert.equal(report.notRun[0]?.adapterId, "stellar-preflight");
  } finally {
    if (saved !== undefined) process.env["PFH_ALLOW_COMPETITOR_CODE"] = saved;
  }
});

test("renderers: markdown has every section, no emoji, one timestamp; JSON is stable and parses", async () => {
  const { report } = await runHarness({ fixturesRoot: synthetic, adapters: ["stellagate-core", "stellar-check"], generatedAt: FIXED });
  const md = renderMarkdown(report);
  for (const h of ["# preflight-harness differential report", "## Matrix", "## Findings", "## Per-case appendix", "## Not evaluated"]) assert.ok(md.includes(h), h);
  assert.doesNotMatch(md, /\p{Extended_Pictographic}/u);
  assert.equal((md.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? []).length, 1);
  const json = renderJson(report);
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(report)));
  const reordered = JSON.parse(json) as DiffReport;
  const reversed = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as DiffReport;
  assert.equal(renderJson(reversed), json, "key order does not depend on construction order");
});

test("renderers: golden markdown for the synthetic run", async () => {
  const saved = process.env["PFH_ALLOW_COMPETITOR_CODE"];
  delete process.env["PFH_ALLOW_COMPETITOR_CODE"];
  const { report } = await runHarness({ fixturesRoot: synthetic, adapters: ["stellagate-core", "stellar-check"], generatedAt: FIXED }).finally(() => {
    if (saved !== undefined) process.env["PFH_ALLOW_COMPETITOR_CODE"] = saved;
  });
  const golden = join(root, "test/golden/report.md");
  const md = renderMarkdown(report);
  if (process.env["UPDATE_GOLDEN"] === "1") writeFileSync(golden, md);
  assert.equal(md, readFileSync(golden, "utf8"));
});

test("cli: run writes verdicts/report files, report --check passes, --fail-on-findings exits 1 only with findings", async () => {
  const out = mkdtempSync(join(tmpdir(), "pfh-run-"));
  const code = await run(["run", "--fixtures", synthetic, "--adapters", "stellagate-core,stellar-check", "--out", out]);
  assert.equal(code, 0);
  for (const f of ["verdicts.json", "report.json", "report.md"]) assert.ok(existsSync(join(out, f)), f);
  assert.equal(await run(["report", "--in", join(out, "verdicts.json"), "--fixtures", synthetic, "--check", join(out, "report.json")]), 0);
  const tampered = JSON.parse(readFileSync(join(out, "report.json"), "utf8")) as DiffReport;
  tampered.summary.split = 99;
  writeFileSync(join(out, "report.json"), JSON.stringify(tampered));
  assert.equal(await run(["report", "--in", join(out, "verdicts.json"), "--fixtures", synthetic, "--check", join(out, "report.json")]), 1);
  // synthetic.ready and synthetic.trustline-missing: both libraries agree, so no findings.
  assert.equal(await run(["run", "--fixtures", synthetic, "--adapters", "stellagate-core,stellar-check", "--out", out, "--fail-on-findings"]), 0);
  assert.equal(await run(["run", "--adapters", "nope"]), 2);
});
