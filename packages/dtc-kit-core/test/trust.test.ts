// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { label, trustLabel } from "../src/index.ts";

const profile = resolveProfile(loadBundledProfile("dtc-stellar"));

describe("trustLabel (DTC-002)", () => {
  it("an unknown row id yields unknown", () => {
    assert.equal(trustLabel(profile, ["no.such-row"]).status, "unknown");
  });

  it("a mix of published and inferred rows yields inferred", () => {
    const t = trustLabel(profile, ["wallet.registration-status-taxonomy", "wallet.control-state-semantics"]);
    assert.equal(t.status, "inferred");
    assert.deepEqual(t.rows, ["wallet.control-state-semantics", "wallet.registration-status-taxonomy"]);
    assert.equal(t.profile, "dtc-stellar");
    assert.equal(t.profileVersion, profile.version);
  });

  it("the disclaimer says not DTC-certified", () => {
    assert.match(trustLabel(profile, ["token.one-to-one-backing"]).disclaimer, /not DTC-certified/);
  });

  it("label() prefixes non-published output with its status and rows", () => {
    const t = trustLabel(profile, ["wallet.control-state-semantics"]);
    assert.equal(label("chill blocks outbound", t), "[inferred] chill blocks outbound (rows: wallet.control-state-semantics)");
    assert.equal(label("ok", trustLabel(profile, ["token.one-to-one-backing"])), "ok");
  });
});
