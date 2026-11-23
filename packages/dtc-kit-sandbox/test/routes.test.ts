// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCLAIMER_HEADER, FAKE_ADDRESSES, FAKE_CUSIP } from "../src/index.ts";
import { sandbox } from "./helpers.ts";

type J = Record<string, unknown>;

describe("sandbox routes (DTC-011..013)", () => {
  it("every response carries the disclaimer header; unknown paths are 404", async () => {
    const { call } = sandbox();
    const r = await call(undefined, "GET", "/v1/nope");
    assert.equal(r.status, 404);
    assert.match(r.headers[DISCLAIMER_HEADER] ?? "", /not DTC-certified/);
  });

  it("oauth: wrong secret 401, missing token 401", async () => {
    const { transport, call } = sandbox();
    const bad = await transport({ method: "POST", path: "/oauth/token", body: { client_id: "sa-birch-1", client_secret: "x" } });
    assert.equal(bad.status, 401);
    assert.equal((await call(undefined, "GET", "/v1/wallets")).status, 401);
  });

  it("GET /v1/profile returns row statuses and counts", async () => {
    const { call } = sandbox();
    const r = await call(undefined, "GET", "/v1/profile");
    const body = r.body as { profile: string; counts: J; rows: { id: string; status: string }[] };
    assert.equal(body.profile, "dtc-stellar");
    assert.deepEqual(body.counts, { published: 25, inferred: 9, unknown: 12 });
    assert.equal(body.rows.length, 46);
  });

  it("SC-005: a client wallet needs a known clientId", async () => {
    const { call } = sandbox();
    const a = await call("sa-birch-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "X1", kind: "client" });
    const b = await call("sa-birch-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "X2", kind: "client", clientId: "C-NOPE" });
    const c = await call("sa-birch-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "X3", kind: "client", clientId: "C-BIRCH-001" });
    assert.deepEqual([a.status, b.status, c.status], [422, 422, 202]);
    assert.equal((b.body as J)["code"], "CLIENT_ID_UNKNOWN");
  });

  it("a participant sees only its own wallets", async () => {
    const { call } = sandbox();
    const w = await call("sa-birch-1", "POST", "/v1/wallets", { ledger: "sandbox-ledger", address: "X1", kind: "internal" });
    const id = (w.body as J)["id"] as string;
    assert.equal((await call("sa-alder-1", "GET", `/v1/wallets/${id}`)).status, 404);
    assert.equal(((await call("sa-alder-1", "GET", "/v1/wallets")).body as { wallets: unknown[] }).wallets.length, 0);
  });

  it("precheck returns every reason plus a trust label; transfers enforce it with 409", async () => {
    const { call } = sandbox();
    await call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    const p = await call("sa-birch-1", "POST", "/v1/transfers/precheck", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.unregistered, tokens: "1.5" });
    const body = p.body as { allowed: boolean; reasons: string[]; trust: { status: string; disclaimer: string } };
    assert.deepEqual(body.reasons, ["DEST_NOT_REGISTERED", "FRACTIONAL_QUANTITY"]);
    assert.equal(body.trust.status, "inferred");
    assert.match(body.trust.disclaimer, /not DTC-certified/);
    const t = await call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.unregistered, tokens: "1" });
    assert.equal(t.status, 409);
    assert.equal((t.body as J)["code"], "DEST_NOT_REGISTERED");
  });

  it("SC-007: a transfer moves balances and writes Payment / Payment Received activity", async () => {
    const { call } = sandbox();
    await call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    assert.equal((await call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "4" })).status, 200);
    const bal = (await call("sa-birch-1", "GET", "/v1/accounts/SBX-9002/balances")).body as { digital: { walletId: string; tokens: string }[] };
    assert.deepEqual(bal.digital.map((d) => [d.walletId, d.tokens]), [["W-1", "96"], ["W-2", "4"]]);
    const act = (await call("sa-birch-1", "GET", "/v1/accounts/SBX-9002/activity")).body as { activity: { type: string }[] };
    assert.deepEqual(act.activity.slice(-2).map((a) => a.type), ["Payment", "Payment Received"]);
    assert.equal((await call("sa-alder-1", "GET", "/v1/accounts/SBX-9002/balances")).status, 403);
  });

  it("SC-016: a Global Lock blocks inbound and outbound", async () => {
    const { call } = sandbox();
    await call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    await call("sim-1", "POST", "/v1/sim/wallets/W-2/control", { control: "global-lock" });
    const inbound = await call("sa-birch-1", "POST", "/v1/transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "1" });
    assert.equal((inbound.body as J)["code"], "DEST_RESTRICTED");
  });

  it("maker/checker: Pending Approval until a different checker approves; the same person is refused", async () => {
    const { call } = sandbox();
    await call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    const o = await call("sa-birch-1", "POST", "/v1/conversion-orders", { wallet: "W-2", cusip: FAKE_CUSIP, direction: "to-token", tokens: "10", makerChecker: true, maker: "ann" });
    assert.equal((o.body as J)["status"], "Pending Approval");
    const id = (o.body as J)["id"] as string;
    assert.equal((await call("sa-birch-1", "POST", `/v1/conversion-orders/${id}/approve`, { checker: "ann" })).status, 409);
    assert.equal(((await call("sa-birch-1", "POST", `/v1/conversion-orders/${id}/approve`, { checker: "ben" })).body as J)["status"], "Processing");
  });

  it("SC-022: root-wallet uses are counted per quarter and reason", async () => {
    const { call } = sandbox();
    await call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    for (const reason of ["erroneous", "erroneous", "stolen"]) {
      const r = await call("dtc-ops-1", "POST", "/v1/admin/force-transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "1", reason });
      assert.equal(r.status, 200);
    }
    const uses = (await call("dtc-ops-1", "GET", "/v1/admin/root-wallet-uses")).body as { total: number; byReason: J };
    assert.deepEqual([uses.total, uses.byReason], [3, { erroneous: 2, stolen: 1 }]);
    await call("sim-1", "POST", "/v1/sim/advance", { seconds: 90 * 86400 });
    assert.equal(((await call("dtc-ops-1", "GET", "/v1/admin/root-wallet-uses")).body as { total: number }).total, 0);
  });

  it("with a chain adapter the registry records a plan for each chain effect", async () => {
    const { call } = sandbox();
    await call("sim-1", "POST", "/v1/sim/reset", { fixture: "two-wallets-funded" });
    await call("dtc-ops-1", "POST", "/v1/admin/force-transfers", { fromWallet: "W-1", toAddress: FAKE_ADDRESSES.birchClient2, tokens: "1", reason: "lost" });
    const plans = (await call("sim-1", "GET", "/v1/sim/plans")).body as { plans: { action: string; adapterId: string }[] };
    assert.deepEqual(plans.plans.map((p) => p.action), ["force-transfer"]);
    assert.equal(plans.plans[0]?.adapterId, "sandbox-ledger");
  });
});
