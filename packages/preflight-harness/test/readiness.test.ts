// SPDX-License-Identifier: Apache-2.0
// PFH-026: DTC registered-wallet readiness evaluator on synthetic snapshots built per scenario by a helper.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDtcReadiness, DTC_REASON_ROWS } from "../src/dtc/readiness.ts";
import { DTC_SCENARIOS, DTC_STELLAR_DISCLAIMER } from "../src/dtc/scenarios.ts";
import { assembleVerdict } from "../src/adapters/map-common.ts";
import type { AccountState, CaseInput, ReceiveVerdict, StateSnapshot, TrustlineState } from "../src/types.ts";

const I = "GASVYHCTBQCHUOQ5WBQ3JQO4PHQ7KLHMEPONISQK5WADDBERVRE3DTOQ";
const D = "GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P";
const C = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const M = "MASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU6AAAAAAAAABQHEYJK";

const flags = (f: Partial<AccountState["flags"]> = {}) => ({ authRequired: false, authRevocable: false, authImmutable: false, clawbackEnabled: false, ...f });
const line = (o: Partial<TrustlineState> = {}): TrustlineState => ({ asset: { code: "TEST", issuer: I }, balance: "0", limit: "10000000000", buyingLiabilities: "0", sellingLiabilities: "0", authorized: true, authorizedToMaintainLiabilities: false, clawbackEnabled: true, ...o });
const acct = (o: Partial<AccountState> = {}): AccountState => ({ balance: "100000000", subentryCount: 0, numSponsoring: 0, numSponsored: 0, flags: flags(), data: {}, trustlines: [], ...o });

/** Snapshot helper: a controlled issuer (AUTH_REQUIRED, REVOCABLE, CLAWBACK) and a wallet; parts overridable. */
function world(o: { issuer?: Partial<AccountState["flags"]>; wallet?: AccountState | null } = {}): StateSnapshot {
  return {
    schema: "sik.state-snapshot/1", network: "testnet", ledger: 10, capturedAt: "2026-11-08T00:00:00Z",
    accounts: { [I]: acct({ flags: flags(o.issuer ?? { authRequired: true, authRevocable: true, clawbackEnabled: true }) }), [D]: o.wallet === undefined ? acct({ subentryCount: 1, trustlines: [line()] }) : o.wallet },
    contracts: {}, sacBalances: {}, simulations: [], networkParams: { baseReserveStroops: "5000000", baseFeeStroops: "100" },
  };
}
const input = (o: Partial<CaseInput> = {}): CaseInput => ({ network: "testnet", destination: D, asset: { kind: "classic", code: "TEST", issuer: I }, amount: "10", sender: I, ...o });
const verdict = (blocking: boolean): ReceiveVerdict => assembleVerdict({ adapterId: "stellagate-core", adapterVersion: "1", caseId: "x", entries: blocking ? [{ code: "TRUSTLINE_MISSING", severity: "blocking", party: "unspecified", libraryCode: "no_trustline" }] : [], unmapped: [], libraryStatus: "ok", raw: null });
const rowsOf = (id: string) => DTC_SCENARIOS.find((s) => s.id === id)!.requirementRefs.map((r) => r.rowId);
const evalFor = (id: string, i: CaseInput, s: StateSnapshot, receive: ReceiveVerdict[] = [verdict(false)]) => evaluateDtcReadiness(i, s, receive, { rows: rowsOf(id) });

test("readiness: controlled asset, authorised trustline -> ready; output carries the disclaimer", () => {
  const r = evalFor("dtc.ready-classic-wallet", input(), world());
  assert.equal(r.readiness, "ready");
  assert.deepEqual(r.dtcReasons, []);
  assert.equal(r.disclaimer, DTC_STELLAR_DISCLAIMER);
});

test("readiness: each not-ready scenario produces its reason", () => {
  const cases: [string, CaseInput, StateSnapshot, string][] = [
    ["dtc.trustline-pending-authorisation", input(), world({ wallet: acct({ subentryCount: 1, trustlines: [line({ authorized: false })] }) }), "DTC_TRUSTLINE_NOT_AUTHORIZED"],
    ["dtc.no-trustline", input(), world({ wallet: acct() }), "DTC_TRUSTLINE_NOT_CREATED"],
    ["dtc.typed-address-does-not-exist", input(), world({ wallet: null }), "DTC_WALLET_UNFUNDED"],
    ["dtc.wallet-control-state-active", input(), world({ wallet: acct({ subentryCount: 1, trustlines: [line({ authorized: false, authorizedToMaintainLiabilities: true })] }) }), "DTC_WALLET_CONTROL_STATE_ACTIVE"],
    ["dtc.asset-without-auth-required", input(), world({ issuer: { clawbackEnabled: true, authRevocable: true } }), "DTC_ASSET_NOT_DISTRIBUTION_CONTROLLED"],
    ["dtc.asset-without-clawback", input(), world({ issuer: { authRequired: true, authRevocable: true } }), "DTC_ASSET_NO_CLAWBACK"],
    ["dtc.fractional-amount", input({ amount: "10.5" }), world(), "DTC_AMOUNT_NOT_WHOLE_TOKENS"],
    ["dtc.reserve-short", input(), world({ wallet: acct({ balance: "10000000" }) }), "DTC_RESERVE_SHORT"],
  ];
  for (const [id, i, s, reason] of cases) {
    const r = evalFor(id, i, s);
    assert.equal(r.readiness, "not-ready", id);
    assert.ok(r.dtcReasons.includes(reason as never), `${id}: ${r.dtcReasons.join(",")}`);
  }
});

test("readiness: C and M wallets -> unknown (the decisive rows are unknown)", () => {
  assert.equal(evalFor("dtc.contract-address-wallet", input({ destination: C }), world()).readiness, "unknown");
  const m = evalFor("dtc.muxed-subledger-wallet", input({ destination: M }), world());
  assert.equal(m.readiness, "unknown");
  assert.deepEqual(m.dtcReasons, ["DTC_WALLET_KIND_NOT_ESTABLISHED"]);
});

test("readiness: a blocking receive verdict makes any scenario not-ready; reasons outside the scenario's rows are ignored", () => {
  assert.equal(evalFor("dtc.ready-classic-wallet", input(), world(), [verdict(true)]).readiness, "not-ready");
  // Missing clawback is irrelevant to the two-step registration scenario's rows.
  const r = evalFor("dtc.trustline-pending-authorisation", input(), world({ issuer: { authRequired: true } }));
  assert.equal(r.readiness, "ready");
  assert.deepEqual(r.dtcReasons, []);
  // Without a row filter, every reason the snapshot supports is returned.
  assert.ok(evaluateDtcReadiness(input(), world({ issuer: {} }), []).dtcReasons.includes("DTC_ASSET_NO_CLAWBACK"));
});

test("readiness: every DTC reason rests on profile rows referenced by some scenario", () => {
  const referenced = new Set(DTC_SCENARIOS.flatMap((s) => s.requirementRefs.map((r) => r.rowId)));
  for (const [reason, rows] of Object.entries(DTC_REASON_ROWS)) assert.ok(rows.some((r) => referenced.has(r)), reason);
});
