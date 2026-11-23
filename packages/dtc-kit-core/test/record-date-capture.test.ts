// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureInstant, capturePositions } from "../src/index.ts";
import { profile } from "./helpers.ts";

describe("captureInstant (DTC-009)", () => {
  for (const [date, expected] of [
    ["2027-03-14", "2027-03-14T20:00:00-04:00"], // DST starts that morning
    ["2027-03-13", "2027-03-13T20:00:00-05:00"],
    ["2027-11-07", "2027-11-07T20:00:00-05:00"], // DST ends that morning
    ["2027-11-06", "2027-11-06T20:00:00-04:00"],
    ["2027-07-15", "2027-07-15T20:00:00-04:00"],
    ["2027-01-15", "2027-01-15T20:00:00-05:00"],
  ] as const) {
    it(`interest record date ${date} -> ${expected}`, () => {
      const r = captureInstant(date, "interest", profile);
      assert.equal(r.at, expected);
      assert.equal(new Date(r.at).toISOString(), new Date(expected).toISOString());
    });
  }
  it("is labelled inferred while the capture row is inferred", () => {
    assert.equal(captureInstant("2027-01-15", "interest", profile).trust.status, "inferred");
  });
  it("maturity: the business day before maturity, skipping weekends and caller-supplied holidays", () => {
    assert.equal(captureInstant("2027-01-18", "maturity", profile).at, "2027-01-15T20:00:00-05:00"); // Monday -> Friday
    assert.equal(captureInstant("2027-01-19", "maturity", profile, { holidays: ["2027-01-18"] }).at, "2027-01-15T20:00:00-05:00");
    assert.equal(captureInstant("2027-01-20", "maturity", profile).at, "2027-01-19T20:00:00-05:00");
  });
  it("rejects a malformed date", () => {
    assert.throws(() => captureInstant("2027-1-5", "interest", profile));
  });
});

describe("capturePositions (DTC-009)", () => {
  it("asks the source for positions at the capture instant", async () => {
    let asked = "";
    const source = {
      positionsAt: async (_l: string, _c: string, at: string) => {
        asked = at;
        return [{ address: "A", tokens: 5n }];
      },
    };
    const cap = await capturePositions(source, { ledger: "sandbox-ledger", cusip: "SBX000AA0", recordDate: "2027-01-15", kind: "interest" }, profile);
    assert.equal(asked, "2027-01-15T20:00:00-05:00");
    assert.equal(cap.capturedAt, asked);
    assert.deepEqual(cap.positions, [{ address: "A", tokens: 5n }]);
    assert.equal(cap.trust.status, "inferred");
  });
});
