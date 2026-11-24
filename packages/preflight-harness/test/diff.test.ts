// SPDX-License-Identifier: Apache-2.0
// PFH-006: diff engine over hand-built verdicts. Each finding kind appears at least once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDiffReport, isApplicable, agreementLevel } from "../src/report/diff.ts";
import type { DiffOptions } from "../src/report/diff.ts";
import { createAdapter } from "../src/adapters/registry.ts";
import { assembleVerdict, errorVerdict } from "../src/adapters/map-common.ts";
import type { AdapterId } from "../src/taxonomy/library-maps.ts";
import type { ReasonCode, Severity } from "../src/taxonomy/codes.ts";
import type { CaseFile, CaseTag, GroundTruth, ReceiveVerdict, ReceiveVerdictClass } from "../src/types.ts";

const G = "GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P";
const S = "GASVYHCTBQCHUOQ5WCTVFHTFPHQ7KLHMEPONISQK5WAHOITOGVE3CLX5";
const I = "GASVYHCTBQCHUOQ5WBQ3JQO4PHQ7KLHMEPONISQK5WADDBERVRE3DTOQ";
const C = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const M = "MASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU6AAAAAAAAABQHEYJK";

const mk = (caseId: string, opts: { tags?: CaseTag[]; dest?: string; sender?: string; must?: ReasonCode[]; verdict?: ReceiveVerdictClass | "undetermined"; asset?: CaseFile["input"]["asset"] } = {}): CaseFile => ({
  schema: "sik.case/1", caseId, title: caseId, tags: opts.tags ?? ["@classic", "@testnet"], captured: true,
  input: { network: "testnet", destination: opts.dest ?? G, asset: opts.asset ?? { kind: "classic", code: "TEST", issuer: I }, amount: "10", sender: opts.sender ?? S },
  expected: { mustReport: opts.must ?? [], verdict: opts.verdict ?? "undetermined", rationale: "test" },
});
const v = (adapterId: AdapterId, caseId: string, reasons: [ReasonCode, Severity][], status = "x", sender: [ReasonCode, Severity][] = []): ReceiveVerdict =>
  assembleVerdict({ adapterId, adapterVersion: "1", caseId, entries: [...reasons, ...sender].map(([code, severity]) => ({ code, severity, party: "unspecified" as const, libraryCode: code.toLowerCase() })), unmapped: [], libraryStatus: status, raw: null });
const caps = new Map((["stellar-preflight", "stellagate-core", "stellar-check"] as const).map((id) => [id, createAdapter(id).capabilities()]));
const opts = (extra: Partial<DiffOptions> = {}): DiffOptions => ({ capabilities: caps, generatedAt: "2026-11-08T00:00:00Z", ...extra });
const kinds = (r: ReturnType<typeof buildDiffReport>, caseId: string) => r.findings.filter((f) => f.caseId === caseId).map((f) => f.kind).sort();

test("isApplicable: muxed, contract, contract-sender and SAC-token cases follow each adapter's capabilities", () => {
  const check = caps.get("stellar-check")!;
  const gate = caps.get("stellagate-core")!;
  const pf = caps.get("stellar-preflight")!;
  assert.equal(isApplicable(check, mk("a.b")), true);
  assert.equal(isApplicable(check, mk("a.b", { dest: M })), false);
  assert.equal(isApplicable(gate, mk("a.b", { dest: M })), true);
  assert.equal(isApplicable(check, mk("a.b", { dest: C })), false);
  assert.equal(isApplicable(gate, mk("a.b", { dest: C })), true);
  assert.equal(isApplicable(check, mk("a.b", { sender: C })), false);
  assert.equal(isApplicable(gate, mk("a.b", { asset: { kind: "contract", contractId: C }, tags: ["@sac"] })), false);
  assert.equal(isApplicable(pf, mk("a.b", { asset: { kind: "contract", contractId: C }, tags: ["@sac"] })), true);
});

test("agreement levels: exact, refinement, class-only, differ", () => {
  const a = v("stellagate-core", "c.x", [["TRUSTLINE_NOT_AUTHORIZED", "blocking"]]);
  assert.equal(agreementLevel(a, v("stellar-check", "c.x", [["TRUSTLINE_NOT_AUTHORIZED", "blocking"]])), "L0");
  assert.equal(agreementLevel(a, v("stellar-preflight", "c.x", [["TRUSTLINE_MAINTAIN_LIABILITIES_ONLY", "blocking"]])), "L1");
  assert.equal(agreementLevel(a, v("stellar-preflight", "c.x", [["TRUSTLINE_LIMIT_EXCEEDED", "blocking"]])), "L2");
  assert.equal(agreementLevel(a, v("stellar-preflight", "c.x", [])), "L3");
});

test("findings: class differs, gap, differs from expected, contradicts the ledger", () => {
  const c = mk("classic.missing", { must: ["TRUSTLINE_MISSING"], verdict: "cannot_receive" });
  const truth = new Map<string, GroundTruth>([["classic.missing", { kind: "horizon-result", operationResult: "op_no_trust" }]]);
  const r = buildDiffReport([c], truth, [v("stellagate-core", c.caseId, [["TRUSTLINE_MISSING", "blocking"]], "block"), v("stellar-check", c.caseId, [], "no_known_issues")], opts());
  assert.deepEqual(kinds(r, c.caseId), ["contradicts_ground_truth", "coverage_gap", "differs_from_expected", "verdict_class_differs"]);
  assert.equal(r.rows[0]!.agreement, "split");
  const gap = r.findings.find((f) => f.kind === "coverage_gap")!;
  assert.deepEqual([gap.adapters, gap.codes], [["stellar-check"], ["TRUSTLINE_MISSING"]]);
});

test("expectation findings are not errors: tag and evidence relation are kept; an unknown verdict is an abstention (gap), not a wrong answer", () => {
  const c = { ...mk("native.create", { tags: ["@native", "@testnet"], verdict: "can_receive_with_warnings", asset: { kind: "native" } }), expected: { mustReport: [], verdict: "can_receive_with_warnings" as const, rationale: "[I] inferred" } };
  const truth = new Map<string, GroundTruth>([["native.create", { kind: "horizon-result", operationResult: "op_no_destination" }]]);
  const r = buildDiffReport([c], truth, [v("stellar-check", c.caseId, [["ACCOUNT_UNFUNDED", "blocking"]], "issues_found"), v("stellagate-core", c.caseId, [["ACCOUNT_UNFUNDED", "warning"]], "warn")], opts());
  const f = r.findings.find((x) => x.kind === "differs_from_expected")!;
  assert.equal(f.expectationTag, "I");
  assert.match(f.evidence!, /consistent with the recorded Horizon result op_no_destination/);
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.expectationDiffs, 1);
  const c2 = mk("classic.issuer", { verdict: "can_receive" });
  const r2 = buildDiffReport([c2], new Map(), [v("stellar-check", c2.caseId, [["UNSUPPORTED_SCENARIO", "blocking"]], "incomplete")], opts());
  assert.deepEqual(kinds(r2, c2.caseId), ["abstained"]);
  assert.equal(r2.summary.errors, 0);
  assert.equal(r2.summary.expectationDiffs, 0);
  assert.equal(r2.summary.gaps, 1);
});

test("findings: reason set and severity differ on the same class; status mismatch is informational", () => {
  const c = mk("memo.req", { tags: ["@memo", "@testnet"], must: ["MEMO_REQUIRED"] });
  const r = buildDiffReport([c], new Map(), [v("stellagate-core", c.caseId, [["MEMO_REQUIRED", "blocking"]], "block"), v("stellar-check", c.caseId, [["MEMO_REQUIRED", "warning"]], "issues_found")], opts());
  assert.deepEqual(kinds(r, c.caseId), ["severity_differs", "status_mismatch", "verdict_class_differs"]);
  const c2 = mk("classic.rev", { must: [] });
  const r2 = buildDiffReport([c2], new Map(), [v("stellagate-core", c2.caseId, [], "ok"), v("stellar-preflight", c2.caseId, [["ASSET_AUTH_REVOCABLE", "info"]], "READY")], opts());
  assert.deepEqual(kinds(r2, c2.caseId), ["reason_set_differs"]);
});

test("findings: scope leak, adapter error, unmapped code; not-run adapters are excluded from agreement", () => {
  const c = mk("sender.short", { tags: ["@classic", "@sender-side", "@testnet"], verdict: "can_receive" });
  const leak = v("stellagate-core", c.caseId, [["TRUSTLINE_MISSING", "blocking"]]);
  const threw = errorVerdict("stellar-check", "1", c.caseId, "threw", "boom");
  const notRun = errorVerdict("stellar-preflight", "", c.caseId, "adapter_unavailable", "opt-in required");
  const unmapped = { ...v("stellar-check", "other.case", []), unmapped: ["NEW_CODE"] };
  const c2 = mk("other.case");
  const r = buildDiffReport([c, c2], new Map(), [leak, threw, notRun, unmapped, v("stellagate-core", "other.case", [])], opts());
  assert.deepEqual(kinds(r, c.caseId), ["adapter_error", "differs_from_expected", "scope_leak", "verdict_class_differs"]);
  assert.deepEqual(kinds(r, "other.case"), ["unmapped_code"]);
  assert.deepEqual(r.notRun, [{ adapterId: "stellar-preflight", cases: 1, reason: "opt-in required" }]);
  assert.equal(r.rows.find((x) => x.caseId === "other.case")!.agreement, "unanimous");
  const onlyNotRun = buildDiffReport([mk("solo.case")], new Map(), [errorVerdict("stellar-preflight", "", "solo.case", "adapter_unavailable", "x")], opts());
  assert.equal(onlyNotRun.rows[0]!.agreement, "not-compared");
  assert.equal(onlyNotRun.summary.notCompared, 1);
});

test("ground truth: @not-derivable skips the check; ambiguous SAC #11 and sender-side results are not receive evidence", () => {
  const und = mk("sac.undeployed", { tags: ["@sac", "@not-derivable"], dest: C, must: ["CONTRACT_DESTINATION_MISSING"], verdict: "cannot_receive" });
  const send = mk("sac.sender", { tags: ["@sac", "@sender-side"], verdict: "can_receive" });
  const truth = new Map<string, GroundTruth>([
    ["sac.undeployed", { kind: "simulation", outcome: "ok" }],
    ["sac.sender", { kind: "simulation", outcome: "contract-error", contractErrorCode: 11 }],
  ]);
  const r = buildDiffReport([und, send], truth, [v("stellagate-core", und.caseId, [["CONTRACT_DESTINATION_MISSING", "blocking"]]), v("stellar-preflight", send.caseId, [])], opts());
  assert.deepEqual(r.findings.filter((f) => f.kind === "contradicts_ground_truth"), []);
});

test("report: deterministic, independent of verdict order; synthetic cases excluded from the headline", () => {
  const a = mk("classic.a", { must: ["TRUSTLINE_MISSING"] });
  const s = mk("synthetic.b", { tags: ["@classic", "@synthetic"] });
  const vs = [v("stellar-check", a.caseId, []), v("stellagate-core", a.caseId, [["TRUSTLINE_MISSING", "blocking"]]), v("stellagate-core", s.caseId, [])];
  const one = buildDiffReport([a, s], new Map(), vs, opts());
  const two = buildDiffReport([s, a], new Map(), [...vs].reverse(), opts());
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.equal(one.summary.cases, 1);
  assert.equal(one.summary.synthetic, 1);
  assert.deepEqual(one.rows[0]!.cells.map((c) => c.adapterId), ["stellar-preflight", "stellagate-core", "stellar-check"]);
});
