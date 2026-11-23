// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffProfiles, loadBundledProfile } from "../src/index.ts";
import type { RequirementsProfile } from "../src/index.ts";

const stellar = (): RequirementsProfile => structuredClone(loadBundledProfile("dtc-stellar"));

describe("diffProfiles (DTC-031)", () => {
  it("is empty for identical profiles", () => {
    assert.deepEqual(diffProfiles(stellar(), stellar()), []);
  });

  it("reports an unknown -> published transition with before and after status", () => {
    const before = stellar();
    const after = stellar();
    const row = after.rows.find((r) => r.id === "token.form");
    assert.ok(row);
    row.status = "published";
    row.value = { form: "sep-57" };
    const changes = diffProfiles(before, after);
    assert.deepEqual(
      changes.filter((c) => c.id === "token.form").map((c) => [c.kind, c.before, c.after]),
      [
        ["status-changed", "unknown", "published"],
        ["value-changed", null, { form: "sep-57" }],
      ],
    );
  });

  it("reports added and removed rows and source changes", () => {
    const before = stellar();
    const after = stellar();
    const removed = after.rows.shift();
    assert.ok(removed);
    after.rows.push({ ...removed, id: "token.new-row" });
    const src = after.rows.find((r) => r.id === "token.interface");
    assert.ok(src);
    src.sources = [];
    const kinds = diffProfiles(before, after).map((c) => `${c.kind}:${c.id}`);
    assert.ok(kinds.includes(`removed:${removed.id}`));
    assert.ok(kinds.includes("added:token.new-row"));
    assert.ok(kinds.includes("source-changed:token.interface"));
  });
});
