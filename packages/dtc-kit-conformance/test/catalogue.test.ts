// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { DTC_KIT_PACK, catalogueProblems, schemaProblems } from "../src/index.ts";

const profile = resolveProfile(loadBundledProfile(DTC_KIT_PACK.profile));
const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("scenario catalogue", () => {
  it("validates against scenario-pack.schema.json", () => {
    assert.deepEqual(schemaProblems(DTC_KIT_PACK), []);
  });

  it("every required row exists and every trust tag equals the weakest required row", () => {
    assert.deepEqual(catalogueProblems(DTC_KIT_PACK, profile), []);
  });

  it("has about thirty-six scenarios and every trust and run tag is used", () => {
    const n = DTC_KIT_PACK.scenarios.length;
    assert.ok(n >= 30 && n <= 40, `scenario count ${n}`);
    for (const tag of ["@published", "@inferred", "@unknown", "@stellar-sac", "@stellar-sep57", "@testnet", "@slow"] as const) {
      assert.ok(DTC_KIT_PACK.scenarios.some((s) => s.tags.includes(tag)), `no scenario tagged ${tag}`);
    }
  });

  it("scenario ids are SC-000..SC-NNN without gaps", () => {
    const ids = DTC_KIT_PACK.scenarios.map((s) => s.id);
    assert.deepEqual(ids, ids.map((_, i) => `SC-${String(i).padStart(3, "0")}`));
  });

  it("implemented scenarios point at an existing test file", () => {
    for (const s of DTC_KIT_PACK.scenarios.filter((x) => x.status === "implemented")) {
      assert.ok(s.testFile && existsSync(join(repoRoot, s.testFile)), `${s.id} testFile`);
    }
  });

  it("the exported pack JSON is up to date (run `pnpm export-pack`)", () => {
    const file = join(import.meta.dirname, "..", "packs", `${DTC_KIT_PACK.packId}.pack.json`);
    assert.ok(existsSync(file), "packs file missing: run pnpm export-pack");
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete onDisk["$schema"];
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(DTC_KIT_PACK)));
  });
});
