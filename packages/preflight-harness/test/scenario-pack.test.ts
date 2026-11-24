// SPDX-License-Identifier: Apache-2.0
// PFH-027: the committed golden pack is what the exporter produces now (regenerate: pnpm export-pack), and the
// CLI writes the same pack. Validation against dtc-kit's schema lives in test/smoke.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildScenarioPack } from "../src/export/scenario-pack.ts";
import { DTC_SCENARIOS, DTC_STELLAR_DISCLAIMER } from "../src/dtc/scenarios.ts";
import { run } from "../src/cli.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const goldenPath = join(root, "../../fixtures/preflight-harness/packs/preflight-harness-dtc-wallet-readiness.pack.json");

test("scenario pack: golden file is current (run `pnpm export-pack` after changing scenarios)", () => {
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as { version: string };
  assert.deepEqual(buildScenarioPack(DTC_SCENARIOS, { version: golden.version }), golden);
});

test("scenario pack: CLI export-pack writes the pack with the verbatim disclaimer", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "pfh-pack-")), "x.pack.json");
  assert.equal(await run(["export-pack", "--out", out, "--pack-version", "2026-11-08"]), 0);
  const pack = JSON.parse(readFileSync(out, "utf8")) as { disclaimer: string; scenarios: unknown[] };
  assert.equal(pack.disclaimer, DTC_STELLAR_DISCLAIMER);
  assert.equal(pack.scenarios.length, 12);
});
