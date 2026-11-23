// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidTransition, reduceForceTransfer, requestForceTransfer, summariseRootWalletUses } from "../src/index.ts";
import type { ChainAdapter, ChainActionPlan, RootWalletUse } from "../src/index.ts";
import { profile, wallet } from "./helpers.ts";

const plan: ChainActionPlan = { adapterId: "test", action: "force-transfer", atomic: true, steps: [], preconditions: [], caveats: [], trust: "unknown", rows: [] };
const adapter = { id: "test", planForceTransfer: () => plan } as unknown as ChainAdapter;

const req = (over = {}) => ({
  id: "FT-1",
  from: wallet("Completed"),
  to: wallet("Completed", { id: "W-2", address: "SBX-ADDR-2" }) as ReturnType<typeof wallet> | undefined,
  cusip: "SBX000AA0",
  tokens: 10n,
  reason: "erroneous" as const,
  requestedAt: "2027-01-13T15:00:00Z",
  ...over,
});

describe("force transfer (DTC-008)", () => {
  it("is refused to an unregistered destination", () => {
    const r = requestForceTransfer(req({ to: undefined }), profile);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "DEST_NOT_REGISTERED");
  });
  it("is refused to a destination in Failed Compliance", () => {
    const r = requestForceTransfer(req({ to: wallet("Failed Compliance") }), profile);
    assert.equal(!r.ok && r.code, "DEST_FAILED_COMPLIANCE");
  });
  it("ignores a chill on the source (DTC override) and needs no holder signature", () => {
    const r = requestForceTransfer(req({ from: wallet("Delivery Order Chill") }), profile);
    assert.ok(r.ok);
    assert.equal(r.transfer.state, "Requested");
  });
  it("walks Requested -> Planned -> Submitted -> Confirmed and emits the transfer and a root-wallet use", () => {
    const r = requestForceTransfer(req(), profile);
    assert.ok(r.ok);
    const planned = reduceForceTransfer(r.transfer, { type: "plan", adapter }, profile);
    assert.equal(planned.next.state, "Planned");
    assert.equal(planned.next.plan, plan);
    const submitted = reduceForceTransfer(planned.next, { type: "submitted", txRef: "tx-1" }, profile);
    const confirmed = reduceForceTransfer(submitted.next, { type: "confirmed" }, profile);
    assert.equal(confirmed.next.state, "Confirmed");
    assert.deepEqual(confirmed.effects.map((e) => e.kind), ["force-transfer", "root-wallet-use"]);
    assert.equal(confirmed.trust.status, "published");
  });
  it("a failure before confirmation ends in Failed; confirmed is terminal", () => {
    const r = requestForceTransfer(req(), profile);
    assert.ok(r.ok);
    assert.equal(reduceForceTransfer(r.transfer, { type: "failed", detail: "x" }, profile).next.state, "Failed");
    assert.throws(() => reduceForceTransfer(r.transfer, { type: "confirmed" }, profile), InvalidTransition);
  });
});

describe("summariseRootWalletUses (DTC-008)", () => {
  const uses: RootWalletUse[] = [
    { at: "2027-01-05T15:00:00Z", ledger: "l", reason: "erroneous", transferId: "FT-1" },
    { at: "2027-02-05T15:00:00Z", ledger: "l", reason: "stolen", transferId: "FT-2" },
    { at: "2027-03-31T23:30:00-04:00", ledger: "l", reason: "erroneous", transferId: "FT-3" },
    { at: "2027-04-01T15:00:00Z", ledger: "l", reason: "lost", transferId: "FT-4" },
  ];
  it("three uses in Q1 and one in Q2 summarise by reason", () => {
    assert.deepEqual(summariseRootWalletUses(uses, "2027-01-01"), { total: 3, erroneous: 2, stolen: 1 });
    assert.deepEqual(summariseRootWalletUses(uses, "2027-04-01"), { total: 1, lost: 1 });
  });
  it("rejects a quarterStart that is not a quarter start", () => {
    assert.throws(() => summariseRootWalletUses(uses, "2027-02-01"));
  });
});
