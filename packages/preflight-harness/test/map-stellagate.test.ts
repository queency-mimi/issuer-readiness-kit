// SPDX-License-Identifier: Apache-2.0
// PFH-005: stellagate-core Verdict -> ReceiveVerdict. Verdicts come from the installed check() with in-memory
// sources (no network, directory: null).
import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "stellagate-core";
import type { AccountState, ContractSource, Verdict } from "stellagate-core";
import { mapStellagateVerdict } from "../src/adapters/map-stellagate.ts";
import { LIBRARY_INVENTORY } from "../src/taxonomy/library-maps.ts";
import type { CaseFile } from "../src/types.ts";

const ISSUER = "GASVYHCTBQCHUOQ5WBQ3JQO4PHQ7KLHMEPONISQK5WADDBERVRE3DTOQ";
const DEST = "GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P";
const CONTRACT = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

const caseFile = (destination = DEST): CaseFile => ({
  schema: "sik.case/1", caseId: "t.case", title: "t", tags: ["@classic"], captured: true,
  input: { network: "testnet", destination, asset: { kind: "classic", code: "TEST", issuer: ISSUER }, amount: "10" },
  expected: { mustReport: [], verdict: "undetermined", rationale: "test" },
});
const accounts = (map: Record<string, AccountState>) => ({ loadAccount: async (id: string): Promise<AccountState> => map[id] ?? { exists: false } });
const issuer = (authRequired = false): AccountState => ({ exists: true, data: {}, trustlines: [], authRequired });
const holder = (lines: { authorized: boolean; balance?: string }[] = [], data: Record<string, string> = {}): AccountState => ({
  exists: true, data, authRequired: false,
  trustlines: lines.map((l) => ({ code: "TEST", issuer: ISSUER, balance: l.balance ?? "0.0000000", limit: "1000.0000000", buyingLiabilities: "0.0000000", authorized: l.authorized })),
});
const run = (to: string, map: Record<string, AccountState>, contracts: ContractSource | null = null, extra: Record<string, unknown> = {}): Promise<Verdict> =>
  check({ to, asset: `TEST:${ISSUER}`, amount: "10", network: "testnet", accounts: accounts(map), contracts, directory: null, ...extra });

test("stellagate map: ok status -> can_receive", async () => {
  const v = mapStellagateVerdict(await run(DEST, { [DEST]: holder([{ authorized: true }]), [ISSUER]: issuer() }), caseFile());
  assert.equal(v.verdict, "can_receive");
  assert.equal(v.libraryStatus, "ok");
  assert.equal(v.adapterId, "stellagate-core");
});

test("stellagate map: no trustline / not authorised / limit", async () => {
  const codes = async (state: AccountState) => mapStellagateVerdict(await run(DEST, { [DEST]: state }), caseFile()).reasons.map((r) => [r.code, r.severity, r.libraryCode]);
  assert.deepEqual(await codes(holder()), [["TRUSTLINE_MISSING", "blocking", "no_trustline"]]);
  assert.deepEqual(await codes(holder([{ authorized: false }])), [["TRUSTLINE_NOT_AUTHORIZED", "blocking", "trustline_not_authorized"]]);
  assert.deepEqual(await codes(holder([{ authorized: true, balance: "995.0000000" }])), [["TRUSTLINE_LIMIT_EXCEEDED", "blocking", "trustline_limit_exceeded"]]);
});

test("stellagate map: destination_unfunded keeps the library's severity (warn for XLM, block otherwise)", async () => {
  const credit = mapStellagateVerdict(await run(DEST, {}), caseFile());
  assert.deepEqual(credit.reasons.map((r) => [r.code, r.severity]), [["ACCOUNT_UNFUNDED", "blocking"]]);
  const xlm = mapStellagateVerdict(await check({ to: DEST, asset: "native", amount: "5", network: "testnet", accounts: accounts({}), directory: null }), caseFile());
  assert.deepEqual(xlm.reasons.map((r) => [r.code, r.severity]), [["ACCOUNT_UNFUNDED", "warning"]]);
  assert.equal(xlm.verdict, "can_receive_with_warnings");
});

test("stellagate map: memo_required on-chain vs directory split on the message text", async () => {
  const onChain = mapStellagateVerdict(await run(DEST, { [DEST]: holder([{ authorized: true }], { "config.memo_required": "MQ==" }) }), caseFile());
  assert.deepEqual(onChain.reasons.map((r) => [r.code, r.severity]), [["MEMO_REQUIRED", "blocking"]]);
  const directory = { lookup: async () => ({ name: "Exchange", tags: ["memo-required"] }) };
  const viaDir = mapStellagateVerdict(await run(DEST, { [DEST]: holder([{ authorized: true }]) }, null, { directory }), caseFile());
  assert.deepEqual(viaDir.reasons.map((r) => r.code), ["MEMO_REQUIRED_DIRECTORY"]);
});

test("stellagate map: sac_balance_not_authorized splits frozen balance vs needs-approval", async () => {
  const sacSource = (balance: { amount: bigint; authorized: boolean } | null): ContractSource => ({ contractExists: async () => true, sacBalance: async () => balance });
  const frozen = mapStellagateVerdict(await run(CONTRACT, { [ISSUER]: issuer(true) }, sacSource({ amount: 5n, authorized: false })), caseFile(CONTRACT));
  assert.deepEqual(frozen.reasons.map((r) => r.code), ["DESTINATION_IS_CONTRACT", "SAC_BALANCE_NOT_AUTHORIZED"]);
  const needs = mapStellagateVerdict(await run(CONTRACT, { [ISSUER]: issuer(true) }, sacSource(null)), caseFile(CONTRACT));
  assert.deepEqual(needs.reasons.map((r) => r.code), ["DESTINATION_IS_CONTRACT", "SAC_BALANCE_NEEDS_AUTHORIZATION"]);
});

test("stellagate map: contract_checks_skipped -> CHECK_SKIPPED info; raw is JSON-safe", async () => {
  const v = mapStellagateVerdict(await run(CONTRACT, {}, null), caseFile(CONTRACT));
  assert.deepEqual(v.reasons.map((r) => [r.code, r.severity]), [["DESTINATION_IS_CONTRACT", "info"], ["CHECK_SKIPPED", "info"]]);
  assert.doesNotThrow(() => JSON.stringify(v.raw));
});

test("stellagate map: every inventory code maps; unknown codes are listed in unmapped", () => {
  for (const code of LIBRARY_INVENTORY["stellagate-core"].codes) {
    const v = mapStellagateVerdict({ status: "block", reasons: [{ code, severity: "block", message: "m" }] }, caseFile());
    assert.deepEqual(v.unmapped, [], code);
    assert.equal(v.reasons.length + v.senderSide.length, 1, code);
  }
  assert.deepEqual(mapStellagateVerdict({ status: "warn", reasons: [{ code: "brand_new", severity: "warn", message: "m" }] }, caseFile()).unmapped, ["brand_new"]);
});
