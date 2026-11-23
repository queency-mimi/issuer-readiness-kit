// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { SandboxLedgerAdapter } from "@sik/dtc-kit-sandbox";
import { DTC_KIT_PACK, exitCodeFor, runPack, toJunitXml } from "../src/index.ts";
import type { ScenarioPack } from "../src/index.ts";

const profile = resolveProfile(loadBundledProfile("dtc-stellar"));
const adapter = new SandboxLedgerAdapter();
const fixedClock = () => {
  let t = 0;
  return { iso: () => "2026-11-08T00:00:00.000Z", ms: () => (t += 1) };
};

describe("runPack (DTC-018)", () => {
  it("every line carries trust and the report starts from the disclaimer", async () => {
    const r = await runPack({ pack: DTC_KIT_PACK, profile, adapter, target: "sandbox", clock: fixedClock() });
    assert.match(r.disclaimer, /not DTC-certified/);
    assert.equal(r.results.length, DTC_KIT_PACK.scenarios.length);
    for (const x of r.results) assert.ok(["published", "inferred", "unknown"].includes(x.trust), x.id);
    assert.equal(r.summary.total, r.summary.pass + r.summary.fail + r.summary.skipped + r.summary.observed);
    assert.equal(exitCodeFor(r), 0);
  });

  it("an unknown required row with onUnknown skip gives SKIPPED(unknown-field:<row>), never pass/fail", async () => {
    const pack: ScenarioPack = { ...DTC_KIT_PACK, scenarios: [{ ...DTC_KIT_PACK.scenarios[1]!, requiresRows: ["token.form"], tags: ["@unknown"] }] };
    const r = await runPack({ pack, profile, adapter, target: "sandbox" });
    assert.deepEqual([r.results[0]?.outcome, r.results[0]?.skipReason, r.results[0]?.trust], ["skipped", "unknown-field:token.form", "unknown"]);
  });

  it("catalogue-only scenarios report not-implemented with their ticket", async () => {
    const r = await runPack({ pack: DTC_KIT_PACK, profile, adapter, target: "sandbox", exclude: [] });
    assert.equal(r.results.find((x) => x.id === "SC-030")?.skipReason, "not-implemented:DTC-028");
  });

  it("include filters by tag", async () => {
    const r = await runPack({ pack: DTC_KIT_PACK, profile, adapter, target: "sandbox", include: ["@inferred"] });
    for (const x of r.results) if (!x.tags.includes("@inferred")) assert.equal(x.skipReason, "not-selected", x.id);
  });

  it("a failing implementation makes the exit code 1; JUnit marks it a failure, skipped as skipped", async () => {
    const pack: ScenarioPack = { ...DTC_KIT_PACK, scenarios: [DTC_KIT_PACK.scenarios[2]!, DTC_KIT_PACK.scenarios[30]!] };
    const strict = resolveProfile(loadBundledProfile("dtc-stellar"));
    const r = await runPack({ pack, profile: strict, adapter, target: "sandbox", exclude: [] });
    r.results[0] = { ...r.results[0]!, outcome: "fail", detail: ["planted <failure>"] };
    assert.equal(exitCodeFor(r), 1);
    const x = toJunitXml({ ...r, summary: { ...r.summary, fail: 1 } });
    assert.match(x, /<failure message="planted &lt;failure&gt;"\/>/);
    assert.match(x, /<skipped message="not-implemented:DTC-028"\/>/);
    assert.match(x, /not DTC-certified/);
  });

  it("CLI: exit 0 on the sandbox, 2 on a usage error, JSON report written", () => {
    const bin = join(import.meta.dirname, "..", "src", "bin.ts");
    const ok = spawnSync(process.execPath, [bin, "run", "--target", "sandbox"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout.split("\n")[0] ?? "", /not DTC-certified/);
    assert.match(ok.stdout, /PASS +SC-015 \[inferred\]/);
    const bad = spawnSync(process.execPath, [bin, "run", "--target", "mainnet"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
  });
});
