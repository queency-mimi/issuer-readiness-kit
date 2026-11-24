// SPDX-License-Identifier: Apache-2.0
// PFH-004: stellar-check Report -> ReceiveVerdict. Reports are produced by the installed library's assessPayment
// on hand-built observations (no network).
import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPayment } from "stellar-check";
import type { Report } from "stellar-check";
import { mapStellarCheckReport } from "../src/adapters/map-stellar-check.ts";
import { LIBRARY_INVENTORY } from "../src/taxonomy/library-maps.ts";
import type { CaseFile } from "../src/types.ts";

const ISSUER = "GASVYHCTBQCHUOQ5WBQ3JQO4PHQ7KLHMEPONISQK5WADDBERVRE3DTOQ";
const DEST = "GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P";
const SRC = "GASVYHCTBQCHUOQ5WCTVFHTFPHQ7KLHMEPONISQK5WAHOITOGVE3CLX5";
const PASS = "Test SDF Network ; September 2015";
const at = "2026-11-08T00:00:00.000Z";
const ok = <T>(value: T) => ({ ok: true as const, value, observedAt: at, ledger: 100 });

const native = (balance = "100.0000000") => ({ asset_type: "native", balance, buying_liabilities: "0.0000000", selling_liabilities: "0.0000000" });
const credit = (o: Partial<{ balance: string; limit: string; is_authorized: boolean; buying: string }> = {}) => ({
  asset_type: "credit_alphanum4", asset_code: "TEST", asset_issuer: ISSUER, balance: o.balance ?? "0.0000000", limit: o.limit ?? "1000.0000000",
  buying_liabilities: o.buying ?? "0.0000000", selling_liabilities: "0.0000000", is_authorized: o.is_authorized ?? true,
});
const acct = (id: string, balances: unknown[]) => ({ account_id: id, sequence: "1", subentry_count: balances.length - 1, num_sponsoring: 0, num_sponsored: 0, last_modified_ledger: 90, balances, data: {} });

const caseFile = (asset: CaseFile["input"]["asset"] = { kind: "classic", code: "TEST", issuer: ISSUER }): CaseFile => ({
  schema: "sik.case/1", caseId: "t.case", title: "t", tags: ["@classic"], captured: true,
  input: { network: "testnet", destination: DEST, asset, amount: "10", sender: SRC },
  expected: { mustReport: [], verdict: "undetermined", rationale: "test" },
});
const intent = (asset: unknown = { type: "credit", code: "TEST", issuer: ISSUER }, extra: Record<string, unknown> = {}) => ({ networkPassphrase: PASS, source: SRC, destination: DEST, asset, amount: "10", feeBudget: "0.0000100", ...extra });
const network = ok({ networkPassphrase: PASS, baseReserve: "0.5000000", baseFee: "0.0000100", ledger: 100 });
const report = (dest: unknown, src: unknown = acct(SRC, [native(), credit({ balance: "500.0000000" })]), memo: "required" | "present" | "not_required" = "not_required", i: unknown = intent()): Report =>
  assessPayment(i, { network, source: ok(src), destination: ok(dest), memo: ok({ result: memo }) }) as Report;

test("stellar-check map: clean report -> can_receive, status recorded, timestamps stripped from raw", () => {
  const rep = report(acct(DEST, [native(), credit()]));
  const v = mapStellarCheckReport({ ...rep, observation: { ...rep.observation, startedAt: at, finishedAt: at } }, caseFile());
  assert.equal(v.verdict, "can_receive");
  assert.equal(v.libraryStatus, "no_known_issues");
  assert.deepEqual(v.reasons, []);
  assert.equal(v.adapterId, "stellar-check");
  assert.doesNotMatch(JSON.stringify(v.raw), /observedAt|startedAt|finishedAt/);
});

test("stellar-check map: destination trustline missing / not authorised / capacity / account missing", () => {
  const codes = (dest: unknown) => mapStellarCheckReport(report(dest), caseFile()).reasons.map((r) => [r.code, r.severity, r.libraryCode]);
  assert.deepEqual(codes(acct(DEST, [native()])), [["TRUSTLINE_MISSING", "blocking", "DESTINATION_TRUSTLINE_MISSING"]]);
  assert.deepEqual(codes(acct(DEST, [native(), credit({ is_authorized: false })])), [["TRUSTLINE_NOT_AUTHORIZED", "blocking", "DESTINATION_NOT_AUTHORIZED"]]);
  assert.deepEqual(codes(acct(DEST, [native(), credit({ balance: "995.0000000" })])), [["TRUSTLINE_LIMIT_EXCEEDED", "blocking", "DESTINATION_CAPACITY_EXCEEDED"]]);
  assert.deepEqual(codes(null), [["ACCOUNT_UNFUNDED", "blocking", "DESTINATION_ACCOUNT_MISSING"]]);
  assert.equal(mapStellarCheckReport(report(null), caseFile()).verdict, "cannot_receive");
});

test("stellar-check map: native capacity maps to NATIVE_BALANCE_CAP, not the trustline code", () => {
  const huge = acct(DEST, [native("922337203685.4775800")]);
  const rep = report(huge, acct(SRC, [native("1000.0000000")]), "not_required", intent({ type: "native" }));
  const v = mapStellarCheckReport(rep, caseFile({ kind: "native" }));
  assert.deepEqual(v.reasons.map((r) => r.code), ["NATIVE_BALANCE_CAP"]);
});

test("stellar-check map: sender diagnostics go to senderSide and never change the class", () => {
  const rep = report(acct(DEST, [native(), credit()]), acct(SRC, [native(), credit({ balance: "1.0000000" })]));
  const v = mapStellarCheckReport(rep, caseFile());
  assert.equal(v.libraryStatus, "issues_found");
  assert.deepEqual(v.senderSide.map((r) => r.code), ["SENDER_INSUFFICIENT_ASSET"]);
  assert.equal(v.verdict, "can_receive");
});

test("stellar-check map: MEMO_REQUIRED (library party sender) is a receive-scope blocking reason", () => {
  const v = mapStellarCheckReport(report(acct(DEST, [native(), credit()]), undefined, "required"), caseFile());
  assert.deepEqual(v.reasons.map((r) => [r.code, r.severity, r.party]), [["MEMO_REQUIRED", "blocking", "sender"]]);
  assert.equal(v.verdict, "cannot_receive");
});

test("stellar-check map: UNSUPPORTED_PAYMENT and incomplete coverage -> unknown with CHECK_SKIPPED info", () => {
  const rep = assessPayment(intent(undefined, { destination: "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA" }), { network, source: ok(null), destination: ok(null), memo: ok({ result: "not_required" }) }) as Report;
  const v = mapStellarCheckReport(rep, caseFile());
  assert.equal(v.libraryStatus, "incomplete");
  assert.equal(v.verdict, "unknown");
  assert.ok(v.reasons.some((r) => r.code === "UNSUPPORTED_SCENARIO"));
  assert.ok(v.reasons.some((r) => r.code === "CHECK_SKIPPED" && r.severity === "info"));
});

test("stellar-check map: every DiagnosticCode maps; an unknown code is listed in unmapped", () => {
  for (const code of LIBRARY_INVENTORY["stellar-check"].codes) {
    const rep = { status: "issues_found", issues: [{ code, party: "recipient", message: "m", action: "a" }], facts: {}, coverage: [], observation: { networkPassphrase: PASS, reads: [], atomic: false }, limitations: [] } as unknown as Report;
    const v = mapStellarCheckReport(rep, caseFile());
    assert.deepEqual(v.unmapped, [], code);
    assert.equal(v.reasons.length + v.senderSide.length, 1, code);
  }
  const rep = { status: "issues_found", issues: [{ code: "NEW_CODE", party: "recipient", message: "m", action: "a" }], facts: {}, coverage: [], observation: { networkPassphrase: PASS, reads: [], atomic: false }, limitations: [] } as unknown as Report;
  assert.deepEqual(mapStellarCheckReport(rep, caseFile()).unmapped, ["NEW_CODE"]);
});
