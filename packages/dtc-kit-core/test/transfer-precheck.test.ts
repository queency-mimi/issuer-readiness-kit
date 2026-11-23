// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRECHECK_REASONS, precheckTransfer } from "../src/index.ts";
import type { TransferIntent } from "../src/index.ts";
import { profile, wallet } from "./helpers.ts";

// 2027-01-13 is a Wednesday; 15:00Z = 10:00 ET (inside 02:00-18:00). 2027-01-16 is a Saturday.
const WEDNESDAY_10_ET = "2027-01-13T15:00:00Z";
const SATURDAY_10_ET = "2027-01-16T15:00:00Z";
const WEDNESDAY_19_ET = "2027-01-14T00:00:00Z";

const intent = (over: Partial<TransferIntent> = {}): TransferIntent => ({
  from: wallet("Completed"),
  to: wallet("Completed", { id: "W-2", address: "SBX-ADDR-2" }),
  tokens: 5n,
  rawQuantity: "5",
  at: WEDNESDAY_10_ET,
  ...over,
});
const OPTS = { dtcLedgers: ["sandbox-ledger", "sandbox-ledger-b"] };

describe("precheckTransfer (DTC-005)", () => {
  it("allows a whole-token transfer between two Completed wallets; label is the weakest consulted row", () => {
    const r = precheckTransfer(intent(), profile, OPTS);
    assert.deepEqual(r, { ...r, allowed: true, reasons: [] });
    assert.equal(r.trust.status, "inferred", "the chill/lock reading (inferred) was consulted");
    assert.ok(r.trust.rows.includes("wallet.control-state-semantics"));
  });

  it("DEST_NOT_REGISTERED", () => {
    const r = precheckTransfer(intent({ to: undefined }), profile, OPTS);
    assert.deepEqual(r.reasons, ["DEST_NOT_REGISTERED"]);
    assert.equal(r.trust.status, "published");
  });
  it("DEST_FAILED_COMPLIANCE", () => {
    assert.deepEqual(precheckTransfer(intent({ to: wallet("Failed Compliance") }), profile, OPTS).reasons, ["DEST_FAILED_COMPLIANCE"]);
  });
  it("DEST_STATUS_NOT_COMPLETED for Processing and Failed", () => {
    assert.deepEqual(precheckTransfer(intent({ to: wallet("Processing") }), profile, OPTS).reasons, ["DEST_STATUS_NOT_COMPLETED"]);
    assert.deepEqual(precheckTransfer(intent({ to: wallet("Failed") }), profile, OPTS).reasons, ["DEST_STATUS_NOT_COMPLETED"]);
  });
  it("SOURCE_RESTRICTED under a chill, labelled inferred", () => {
    const r = precheckTransfer(intent({ from: wallet("Delivery Order Chill") }), profile, OPTS);
    assert.deepEqual(r.reasons, ["SOURCE_RESTRICTED"]);
    assert.equal(r.trust.status, "inferred");
  });
  it("DEST_RESTRICTED under a global lock (a chill does not block inbound)", () => {
    assert.deepEqual(precheckTransfer(intent({ to: wallet("Global Lock") }), profile, OPTS).reasons, ["DEST_RESTRICTED"]);
    assert.deepEqual(precheckTransfer(intent({ to: wallet("Delivery Order Chill") }), profile, OPTS).reasons, []);
  });
  it("FRACTIONAL_QUANTITY from the raw text; 1.0 is not fractional", () => {
    assert.deepEqual(precheckTransfer(intent({ tokens: 1n, rawQuantity: "1.5" }), profile, OPTS).reasons, ["FRACTIONAL_QUANTITY"]);
    assert.deepEqual(precheckTransfer(intent({ tokens: 1n, rawQuantity: "1.0" }), profile, OPTS).reasons, []);
  });
  it("CROSS_NETWORK_OUTSIDE_HOURS on Saturday and after 18:00 ET, not on Wednesday 10:00 ET", () => {
    const cross = { toLedger: "sandbox-ledger-b" };
    assert.deepEqual(precheckTransfer(intent({ ...cross, at: SATURDAY_10_ET }), profile, OPTS).reasons, ["CROSS_NETWORK_OUTSIDE_HOURS"]);
    assert.deepEqual(precheckTransfer(intent({ ...cross, at: WEDNESDAY_19_ET }), profile, OPTS).reasons, ["CROSS_NETWORK_OUTSIDE_HOURS"]);
    assert.deepEqual(precheckTransfer(intent({ ...cross }), profile, OPTS).reasons, []);
    assert.deepEqual(precheckTransfer(intent({ at: SATURDAY_10_ET }), profile, OPTS).reasons, [], "same-network runs 24x7");
  });
  it("CROSS_NETWORK_NO_BRIDGE when the destination ledger is not a DTC ledger", () => {
    assert.deepEqual(precheckTransfer(intent({ toLedger: "some-bridge" }), profile, OPTS).reasons, ["CROSS_NETWORK_NO_BRIDGE"]);
  });

  it("returns every applicable reason in specification order, labelled by the fired rows", () => {
    const r = precheckTransfer(
      intent({ from: wallet("Global Lock"), to: wallet("Failed Compliance"), rawQuantity: "2.5", toLedger: "elsewhere", at: SATURDAY_10_ET }),
      profile,
      OPTS,
    );
    assert.deepEqual(r.reasons, ["DEST_FAILED_COMPLIANCE", "SOURCE_RESTRICTED", "FRACTIONAL_QUANTITY", "CROSS_NETWORK_OUTSIDE_HOURS", "CROSS_NETWORK_NO_BRIDGE"]);
    assert.equal(r.allowed, false);
    assert.equal(r.trust.status, "inferred");
  });

  it("every reason code is covered by the table", () => {
    assert.equal(Object.keys(PRECHECK_REASONS).length, 8);
  });
});
