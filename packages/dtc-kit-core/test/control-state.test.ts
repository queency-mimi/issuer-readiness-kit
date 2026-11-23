// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WALLET_STATUSES, isChilled, restrictionFor } from "../src/index.ts";
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec";
import { profile } from "./helpers.ts";

const expected = {
  Processing: [true, false, "published"],
  Completed: [false, false, "published"],
  "Failed Compliance": [true, false, "published"],
  Failed: [true, false, "published"],
  "Delivery Order Chill": [false, true, "inferred"],
  "Global Lock": [true, true, "inferred"],
  "Compliance Lock": [true, true, "inferred"],
} as const;

describe("restrictionFor (DTC-003)", () => {
  for (const status of WALLET_STATUSES) {
    it(`${status}`, () => {
      const r = restrictionFor(status, profile);
      const [inbound, outbound, trust] = expected[status];
      assert.equal(r.blocksInbound, inbound, "inbound");
      assert.equal(r.blocksOutbound, outbound, "outbound");
      assert.equal(r.trust.status, trust);
    });
  }

  it("reads the effect from the profile row, not from code", () => {
    const rows = new Map(profile.rows);
    const row = rows.get("wallet.control-state-semantics");
    assert.ok(row);
    rows.set(row.id, { ...row, value: { "Delivery Order Chill": { blocksOutbound: true, blocksInbound: true } } });
    const changed: ResolvedProfile = { ...profile, rows };
    const r = restrictionFor("Delivery Order Chill", changed);
    assert.equal(r.blocksInbound, true);
    // a control state missing from the row is treated conservatively and labelled unknown
    const gl = restrictionFor("Global Lock", changed);
    assert.deepEqual([gl.blocksInbound, gl.blocksOutbound, gl.trust.status], [true, true, "unknown"]);
  });
});

describe("isChilled (DTC-003)", () => {
  const windows = [{ eventId: "CA-1", from: "2027-01-14T20:00:00-05:00", until: "2027-01-15T09:00:00-05:00" }];
  it("inside a window", () => assert.equal(isChilled(windows, "2027-01-15T02:00:00Z"), true));
  it("start is inclusive, end exclusive", () => {
    assert.equal(isChilled(windows, "2027-01-15T01:00:00Z"), true);
    assert.equal(isChilled(windows, "2027-01-15T14:00:00Z"), false);
  });
  it("outside every window", () => assert.equal(isChilled(windows, "2027-01-10T00:00:00Z"), false));
});
