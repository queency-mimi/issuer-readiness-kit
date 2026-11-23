// SPDX-License-Identifier: Apache-2.0
// Runs every implemented scenario of the pack through the runner (DTC-019, DTC-030 part).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { SandboxLedgerAdapter } from "@sik/dtc-kit-sandbox";
import { DTC_KIT_PACK, runPack } from "../src/index.ts";
import type { RecordedTestnetRun, RunReport } from "../src/index.ts";
import { RECORDED_TESTNET_RUN, makeAdapter } from "../src/bin.ts";

const profile = resolveProfile(loadBundledProfile("dtc-stellar"));
const testnetRun = JSON.parse(readFileSync(RECORDED_TESTNET_RUN, "utf8")) as RecordedTestnetRun;
const byId = (r: RunReport) => Object.fromEntries(r.results.map((x) => [x.id, x]));
const fails = (r: RunReport) => r.results.filter((x) => x.outcome === "fail").map((x) => `${x.id}: ${(x.detail ?? []).join("; ")}`);

describe("implemented scenarios", () => {
  it("target sandbox, in-memory adapter: every implemented non-@testnet non-@slow scenario passes", async () => {
    const report = await runPack({ pack: DTC_KIT_PACK, profile, adapter: new SandboxLedgerAdapter(), target: "sandbox" });
    assert.deepEqual(fails(report), []);
    const r = byId(report);
    const ran = DTC_KIT_PACK.scenarios.filter((s) => s.status === "implemented" && s.id !== "SC-000" && !s.tags.includes("@testnet") && !s.tags.includes("@slow"));
    for (const s of ran) assert.equal(r[s.id]?.outcome, "pass", s.id);
    assert.equal(r["SC-019"]?.skipReason, "excluded-tag:@testnet");
    assert.equal(r["SC-035"]?.skipReason, "excluded-tag:@slow");
    assert.equal(r["SC-020"]?.skipReason, "excluded-tag:@testnet");
  });

  it("target testnet-recorded, SAC adapter: SC-019 observed, SC-029 and SC-031 pass from the recorded run", async () => {
    const report = await runPack({ pack: DTC_KIT_PACK, profile, adapter: makeAdapter("stellar-sac", profile), target: "testnet-recorded", testnetRun });
    assert.deepEqual(fails(report), []);
    const r = byId(report);
    assert.equal(r["SC-019"]?.outcome, "observed");
    assert.equal(r["SC-019"]?.trust, "unknown");
    assert.ok(r["SC-019"]?.evidence?.every((e) => e.kind === "testnet-recorded" && e.ledger && e.hash));
    assert.equal(r["SC-029"]?.outcome, "pass");
    assert.equal(r["SC-031"]?.outcome, "pass");
    assert.equal(r["SC-020"]?.skipReason, "not-implemented:DTC-026");
    assert.equal(r["SC-013"]?.skipReason, "not-implemented:DTC-030");
    assert.ok(r["SC-006"]?.evidence?.some((e) => e.kind === "testnet-recorded"));
  });

  it("SC-035 (@slow) runs within its measured budget when included", async () => {
    const report = await runPack({ pack: DTC_KIT_PACK, profile, adapter: new SandboxLedgerAdapter(), target: "sandbox", include: ["@slow"], exclude: [] });
    const r = byId(report)["SC-035"];
    assert.equal(r?.outcome, "pass", (r?.detail ?? []).join("; "));
  });
});
