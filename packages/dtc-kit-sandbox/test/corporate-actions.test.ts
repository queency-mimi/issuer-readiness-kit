// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAKE_CUSIP } from "../src/index.ts";
import { sandbox } from "./helpers.ts";

type J = Record<string, unknown>;

async function fiveWalletsTwoParticipants() {
  const s = sandbox();
  const { call } = s;
  const reg = async (sa: string, address: string, kind: string, clientId?: string) =>
    ((await call(sa, "POST", "/v1/wallets", { ledger: "sandbox-ledger", address, kind, ...(clientId ? { clientId } : {}) })).body as J)["id"] as string;
  const wallets = [
    ["sa-birch-1", await reg("sa-birch-1", "B1", "client", "C-BIRCH-001"), "50"],
    ["sa-birch-1", await reg("sa-birch-1", "B2", "client", "C-BIRCH-002"), "30"],
    ["sa-birch-1", await reg("sa-birch-1", "B3", "client", "C-BIRCH-003"), "20"],
    ["sa-alder-1", await reg("sa-alder-1", "A1", "internal"), "70"],
    ["sa-alder-1", await reg("sa-alder-1", "A2", "internal"), "5"],
  ] as const;
  await call("sim-1", "POST", "/v1/sim/advance", { seconds: 60 });
  for (const [sa, w, n] of wallets) {
    const o = await call(sa, "POST", "/v1/conversion-orders", { wallet: w, cusip: FAKE_CUSIP, direction: "to-token", tokens: n });
    assert.equal(o.status, 202, JSON.stringify(o.body));
  }
  await call("sim-1", "POST", "/v1/sim/advance", { seconds: 900 });
  return s;
}

describe("corporate actions (DTC-015)", () => {
  it("an interest event pays exactly one consolidated credit per participant", async () => {
    const { call } = await fiveWalletsTwoParticipants();
    const ca = await call("dtc-ops-1", "POST", "/v1/corporate-actions", {
      cusip: FAKE_CUSIP, kind: "interest", recordDate: "2027-01-15", payDate: "2027-01-19", rate: { numerator: "125", denominator: "1" },
    });
    assert.equal(ca.status, 202);
    const id = (ca.body as J)["id"] as string;
    assert.equal((await call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/capture`)).status, 409, "too early: before 20:00 ET on the record date");
    await call("sim-1", "POST", "/v1/sim/advance", { to: "2027-01-16T02:00:00Z" });
    const cap = await call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/capture`);
    assert.equal(cap.status, 200);
    assert.equal((cap.body as J)["capturedAt"], "2027-01-15T20:00:00-05:00");
    const pay = await call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/pay`);
    const credits = (pay.body as { credits: { participant: string; amount: string }[] }).credits;
    assert.deepEqual(credits, [
      { participant: "SBX-9001", amount: "9375" },
      { participant: "SBX-9002", amount: "12500" },
    ]);
    const act = (await call("sa-birch-1", "GET", "/v1/accounts/SBX-9002/activity")).body as { activity: { type: string }[] };
    assert.equal(act.activity.filter((a) => a.type === "Cash Credit").length, 1);
    const tokens = ((await call("sa-birch-1", "GET", "/v1/accounts/SBX-9002/balances")).body as { digital: { tokens: string }[] }).digital;
    assert.deepEqual(tokens.map((t) => t.tokens), ["50", "30", "20"], "interest leaves tokens in place");
  });

  it("a participant reads its own captured positions for reconciliation", async () => {
    const { call } = await fiveWalletsTwoParticipants();
    const ca = await call("dtc-ops-1", "POST", "/v1/corporate-actions", { cusip: FAKE_CUSIP, kind: "interest", recordDate: "2027-01-15", payDate: "2027-01-19", rate: { numerator: "1", denominator: "3" } });
    const id = (ca.body as J)["id"] as string;
    await call("sim-1", "POST", "/v1/sim/advance", { to: "2027-01-16T02:00:00Z" });
    await call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/capture`);
    await call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/pay`);
    const view = (await call("sa-birch-1", "GET", `/v1/corporate-actions/${id}`)).body as { positions: { address: string; tokens: string }[]; credit: string; trust: { status: string } };
    assert.deepEqual(view.positions.map((p) => p.tokens), ["50", "30", "20"]);
    assert.equal(view.credit, "33", "100 tokens x 1/3 cent rounded half-up per participant");
    assert.equal(view.trust.status, "inferred");
  });

  it("maturity burns the tokens and pays principal", async () => {
    const { call } = await fiveWalletsTwoParticipants();
    const ca = await call("dtc-ops-1", "POST", "/v1/corporate-actions", { cusip: FAKE_CUSIP, kind: "maturity", recordDate: "2027-01-19", payDate: "2027-01-19", rate: { numerator: "10000", denominator: "1" } });
    const id = (ca.body as J)["id"] as string;
    await call("sim-1", "POST", "/v1/sim/advance", { to: "2027-01-19T15:00:00Z" });
    const cap = await call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/capture`);
    assert.equal((cap.body as J)["capturedAt"], "2027-01-18T20:00:00-05:00");
    await call("dtc-ops-1", "POST", `/v1/corporate-actions/${id}/pay`);
    const tokens = ((await call("sa-birch-1", "GET", "/v1/accounts/SBX-9002/balances")).body as { digital: { tokens: string }[] }).digital;
    assert.deepEqual(tokens.map((t) => t.tokens), ["0", "0", "0"]);
  });
});
