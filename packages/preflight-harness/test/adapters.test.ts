// SPDX-License-Identifier: Apache-2.0
// PFH-010/011/012: replay snapshots through each library offline. `fetch` is replaced by a function that throws,
// so any network access fails the test. The Stellar-Preflight adapter itself only executes the third-party clone
// when the user opted in (PFH_ALLOW_COMPETITOR_CODE=1); its Chain feeder is tested here without the clone.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { loadAllCases } from "../src/fixtures/load.ts";
import { createAdapter } from "../src/adapters/registry.ts";
import { horizonFetch, horizonAccountJson } from "../src/adapters/feed-horizon.ts";
import { snapshotChain } from "../src/adapters/feed-preflight.ts";
import { canonicalCall } from "../src/adapters/canonical.ts";
import type { CaseFile, StateSnapshot } from "../src/types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const synthetic = new Map(loadAllCases(root + "../../fixtures/preflight-harness/synthetic").map((c) => [c.testCase.caseId, c]));
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error("network access during replay");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ready = synthetic.get("synthetic.ready")!;
const missing = synthetic.get("synthetic.trustline-missing")!;

test("horizon feeder: account JSON has Horizon's shape and decimal amounts; unknown account is a 404, unrecorded is a 503", async () => {
  const dest = ready.testCase.input.destination;
  const json = horizonAccountJson(ready.state!, dest) as { balances: { asset_type: string; balance: string; limit?: string; is_authorized?: boolean }[]; account_id: string };
  assert.equal(json.account_id, dest);
  // Horizon lists trustlines first and the native balance last.
  assert.deepEqual(json.balances.map((b) => b.asset_type), ["credit_alphanum4", "native"]);
  assert.equal(json.balances[1]!.balance, "10.0000000");
  assert.equal(json.balances[0]!.limit, "1000.0000000");
  const f = horizonFetch({ ...ready.state!, accounts: { ...ready.state!.accounts, ["G" + "A".repeat(55)]: null } });
  assert.equal((await f("https://h.invalid/accounts/" + "G" + "A".repeat(55))).status, 404);
  assert.equal((await f("https://h.invalid/accounts/" + "G" + "B".repeat(55))).status, 503);
  assert.equal((await f("https://h.invalid/")).status, 200);
});

for (const id of ["stellagate-core", "stellar-check"] as const) {
  test(`${id}: replays both synthetic fixtures offline to the expected codes`, async () => {
    const adapter = createAdapter(id);
    const ok = await adapter.replay(ready.testCase, ready.state!);
    assert.equal(ok.verdict, "can_receive", JSON.stringify(ok.reasons));
    assert.equal(ok.error, undefined);
    const no = await adapter.replay(missing.testCase, missing.state!);
    assert.equal(no.verdict, "cannot_receive");
    assert.deepEqual(no.reasons.map((r) => r.code), ["TRUSTLINE_MISSING"]);
    assert.deepEqual([ok.unmapped, no.unmapped], [[], []]);
  });

  test(`${id}: an account missing from the snapshot is a provider failure, never "unfunded"`, async () => {
    const adapter = createAdapter(id);
    const state: StateSnapshot = { ...ready.state!, accounts: { ...ready.state!.accounts } };
    delete state.accounts[ready.testCase.input.destination];
    const v = await adapter.replay(ready.testCase, state);
    assert.ok(!v.reasons.some((r) => r.code === "ACCOUNT_UNFUNDED"), JSON.stringify(v.reasons));
    assert.notEqual(v.verdict, "can_receive");
  });

  test(`${id}: replay is deterministic (same input twice gives identical JSON)`, async () => {
    const adapter = createAdapter(id);
    const a = await adapter.replay(ready.testCase, ready.state!);
    const b = await adapter.replay(ready.testCase, ready.state!);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
}

test("stellagate-core: case network maps to 'public' for mainnet and the memo is passed through", async () => {
  const adapter = createAdapter("stellagate-core");
  const dest = ready.testCase.input.destination;
  const state: StateSnapshot = structuredClone(ready.state!);
  state.accounts[dest]!.data["config.memo_required"] = "MQ==";
  const noMemo = await adapter.replay(ready.testCase, state);
  assert.deepEqual(noMemo.reasons.map((r) => r.code), ["MEMO_REQUIRED"]);
  const withMemo: CaseFile = { ...ready.testCase, input: { ...ready.testCase.input, memo: { type: "text", value: "dep-1" } } };
  assert.deepEqual((await adapter.replay(withMemo, state)).reasons, []);
});

test("preflight Chain feeder: accounts, trustlines, contracts and recorded calls come from the snapshot", async () => {
  const sac = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
  const dest = ready.testCase.input.destination;
  const sender = ready.testCase.input.sender!;
  const issuer = (ready.testCase.input.asset as { issuer: string }).issuer;
  const call = canonicalCall(sac, "transfer", [sender, dest, 100000000n]);
  const state: StateSnapshot = {
    ...ready.state!,
    contracts: { [sac]: { exists: true, kind: "sac", wraps: { kind: "classic", code: "TEST", issuer }, reads: { "name()": `TEST:${issuer}` } }, CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC: { exists: false, kind: null } },
    sacBalances: {},
    simulations: [{ call, source: sender, result: { ok: false, error: "HostError: Error(Contract, #13)", contractErrorCode: 13 } }],
  };
  const chain = snapshotChain(state);
  const acc = await chain.account(dest);
  assert.equal(acc?.balance, 100000000n);
  assert.equal(acc?.memoRequired, false);
  const tl = await chain.trustline(dest, { getCode: () => "TEST", getIssuer: () => issuer });
  assert.equal(tl?.limit, 10000000000n);
  assert.equal(await chain.trustline(dest, { getCode: () => "OTHER", getIssuer: () => issuer }), null);
  assert.deepEqual(await chain.contract(sac), { kind: "sac" });
  assert.equal(await chain.contract("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"), null);
  assert.deepEqual(await chain.call(sac, "name", []), { ok: true, value: `TEST:${issuer}` });
  const args = [nativeToScVal(sender, { type: "address" }), nativeToScVal(dest, { type: "address" }), nativeToScVal(100000000n, { type: "i128" })].map((v) => xdr.ScVal.fromXDR(v.toXDR()));
  const res = await chain.call(sac, "transfer", args, sender);
  assert.deepEqual(res, { ok: false, error: "HostError: Error(Contract, #13)" });
  const unrecorded = await chain.call(sac, "transfer", args.slice(0, 2).concat(nativeToScVal(5n, { type: "i128" })), sender);
  assert.equal(unrecorded.ok, false);
  assert.match((unrecorded as { error: string }).error, /no recorded simulation/);
  await assert.rejects(() => chain.account("G" + "B".repeat(55)), /not recorded/);
  await assert.rejects(() => chain.contract("CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE"), /not recorded/);
});

test("stellar-preflight adapter: without the user's opt-in it reports adapter_unavailable and never imports the clone", async () => {
  const saved = process.env["PFH_ALLOW_COMPETITOR_CODE"];
  delete process.env["PFH_ALLOW_COMPETITOR_CODE"];
  try {
    const adapter = createAdapter("stellar-preflight");
    const info = await adapter.info();
    assert.equal(info.available, false);
    assert.match(info.installHint, /PFH_ALLOW_COMPETITOR_CODE=1|fetch-competitors\.sh/);
    const v = await adapter.replay(ready.testCase, ready.state!);
    assert.equal(v.error?.kind, "adapter_unavailable");
    assert.equal(v.verdict, "unknown");
  } finally {
    if (saved !== undefined) process.env["PFH_ALLOW_COMPETITOR_CODE"] = saved;
  }
});

test("stellar-preflight adapter (opt-in only): replays both synthetic fixtures", { skip: process.env["PFH_ALLOW_COMPETITOR_CODE"] !== "1" ? "set PFH_ALLOW_COMPETITOR_CODE=1 after running scripts/fetch-competitors.sh yourself" : false }, async () => {
  const adapter = createAdapter("stellar-preflight");
  assert.equal((await adapter.replay(ready.testCase, ready.state!)).verdict, "can_receive");
  const no = await adapter.replay(missing.testCase, missing.state!);
  assert.deepEqual(no.reasons.map((r) => r.code), ["TRUSTLINE_MISSING"]);
});
