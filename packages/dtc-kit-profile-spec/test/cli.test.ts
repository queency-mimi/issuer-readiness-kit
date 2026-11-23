// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PROFILES_DIR } from "../src/index.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

describe("profiles CLI (DTC-001)", () => {
  it("check exits 0 and prints counts matching the files", () => {
    const r = run("check");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dtc-generic\s+28 rows: 25 published, 3 inferred, 0 unknown/);
    assert.match(r.stdout, /dtc-stellar\s+18 rows: 0 published, 6 inferred, 12 unknown/);
  });

  it("check --json returns counts per profile", () => {
    const r = run("check", "--json");
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout) as { profiles: { profileId: string; rows: number; published: number }[] };
    assert.deepEqual(out.profiles.map((p) => [p.profileId, p.rows, p.published]), [["dtc-generic", 28, 25], ["dtc-stellar", 18, 0]]);
  });

  it("check exits 1 on a broken profile and names the violated rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "dtc-prof-"));
    const p = JSON.parse(readFileSync(join(PROFILES_DIR, "dtc-generic.json"), "utf8")) as { rows: { status: string; value: unknown }[] };
    const first = p.rows[0];
    assert.ok(first);
    first.status = "unknown"; // value stays non-null: violates the unknown => value null rule
    writeFileSync(join(dir, "dtc-generic.json"), JSON.stringify(p));
    const r = run("check", "--dir", dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /dtc-generic/);
    assert.match(r.stderr, /rows\/0/);
  });

  it("table prints one line per resolved row with status and source count", () => {
    const r = run("table", "dtc-stellar");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /unknown\s+none\s+0\s+token\.form/);
    assert.equal(r.stdout.trim().split("\n").filter((l) => /^(published|inferred|unknown)\s/.test(l)).length, 46);
  });
});
