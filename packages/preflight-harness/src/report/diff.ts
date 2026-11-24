// SPDX-License-Identifier: Apache-2.0
// Normative: SPEC.md section 6. Pure: (cases, ground truth, verdicts, capabilities) -> matrix + findings.
import { REASON_CODES, REFINES, SAME_FACT, TAXONOMY_VERSION } from "../taxonomy/codes.ts";
import type { ReasonCode } from "../taxonomy/codes.ts";
import type { AdapterId } from "../taxonomy/library-maps.ts";
import type { AdapterCapabilities } from "../adapters/types.ts";
import type { CaseFile, CaseTag, GroundTruth, ReceiveVerdict, ReceiveVerdictClass } from "../types.ts";
import { statusClass } from "../verdict/derive.ts";

export const ADAPTER_ORDER: AdapterId[] = ["stellar-preflight", "stellagate-core", "stellar-check"];

export type FindingKind =
  | "verdict_class_differs"
  | "reason_set_differs"
  | "severity_differs"
  | "coverage_gap"
  | "differs_from_expected"
  | "abstained"
  | "contradicts_ground_truth"
  | "scope_leak"
  | "adapter_error"
  | "unmapped_code"
  | "status_mismatch";

/**
 * Groups. "expectation" is NOT an accusation: the case's authored expected verdict (a catalogue judgement with a trust
 * tag) differs from the library's answer. Only "error" findings (contradicts_ground_truth etc.) are claims about
 * recorded ledger or simulation evidence.
 */
export const FINDING_GROUP: Record<FindingKind, "disagreement" | "gap" | "expectation" | "error" | "note"> = {
  verdict_class_differs: "disagreement",
  reason_set_differs: "disagreement",
  severity_differs: "disagreement",
  coverage_gap: "gap",
  differs_from_expected: "expectation",
  abstained: "gap",
  contradicts_ground_truth: "error",
  scope_leak: "error",
  adapter_error: "error",
  unmapped_code: "error",
  status_mismatch: "note",
};
const KIND_ORDER = Object.keys(FINDING_GROUP) as FindingKind[];

export interface Finding {
  kind: FindingKind;
  caseId: string;
  adapters: string[];
  codes: ReasonCode[];
  detail: string;
  /** differs_from_expected only: the trust tag ([P][M][I][E][U][S]) the case author put on the expectation. */
  expectationTag?: string;
  /** differs_from_expected only: how the recorded ledger/simulation result relates to the library's verdict. Plain text, never a verdict on the library. */
  evidence?: string;
}

export interface MatrixCell {
  adapterId: string;
  /** False when the adapter's capabilities exclude this case (SPEC 6.3); shown as n/a and never counted as a gap. */
  applicable: boolean;
  /** True when the adapter did not run for this case (unavailable, or not selected); excluded from comparisons. */
  notRun: boolean;
  verdict: ReceiveVerdictClass;
  receiveCodes: ReasonCode[];
  senderCodes: ReasonCode[];
  /** Highest severity among receive-scope reasons. */
  worstSeverity: "none" | "info" | "warning" | "blocking";
  libraryStatus: string;
  reasons: { code: ReasonCode; severity: string; libraryCode: string; message?: string }[];
  error?: string;
}

export interface MatrixRow {
  caseId: string;
  title: string;
  tags: CaseTag[];
  input: CaseFile["input"];
  mustReport: ReasonCode[];
  expectedVerdict: ReceiveVerdictClass | "undetermined";
  groundTruth: GroundTruth;
  ledger?: number;
  cells: MatrixCell[];
  /** unanimous: every pair L0/L1; split: not; single: one library compared; unanimous-unknown: every compared library answered unknown; not-compared: no library that claims the case ran. */
  agreement: "unanimous" | "split" | "single" | "unanimous-unknown" | "not-compared";
}

export interface DiffReport {
  schema: "sik.diff-report/1";
  generatedAt: string;
  taxonomyVersion: number;
  adapters: { id: string; version: string; available: boolean; note?: string }[];
  fixtureSet: { cases: number; synthetic: number; ledgerRange?: [number, number] };
  rows: MatrixRow[];
  findings: Finding[];
  notRun: { adapterId: string; cases: number; reason: string }[];
  notEvaluated: { caseId: string; title: string; reason: string }[];
  summary: {
    cases: number;
    synthetic: number;
    unanimous: number;
    split: number;
    single: number;
    unanimousUnknown: number;
    notCompared: number;
    findingsByKind: Record<string, number>;
    disagreements: number;
    gaps: number;
    /** Differs from the case's authored expected verdict. A catalogue judgement, not recorded evidence. */
    expectationDiffs: number;
    /** Contradicts recorded evidence, or the library failed. */
    errors: number;
  };
}

export interface DiffOptions {
  capabilities: Map<string, AdapterCapabilities>;
  generatedAt: string;
  adapters?: DiffReport["adapters"];
  ledgers?: Map<string, number>;
  notEvaluated?: DiffReport["notEvaluated"];
}

// ---------- applicability ----------

/** Whether a library claims to cover a case, from its capabilities and the case tags/input (SPEC 6.3). */
export function isApplicable(caps: AdapterCapabilities, testCase: CaseFile): boolean {
  const { destination, asset, sender } = testCase.input;
  if (caps.requiresSender && !sender) return false;
  if (sender?.startsWith("C") && !caps.contractDestination && !caps.sacTransfer) return false;
  if (destination.includes("*") && !caps.federation) return false;
  if (destination.startsWith("M") && !caps.muxedDestination) return false;
  if (destination.startsWith("C") && !caps.contractDestination) return false;
  if (asset.kind === "contract") {
    const custom = testCase.tags.includes("@sep41") || testCase.tags.includes("@sep57");
    return custom ? caps.sep41Token : caps.sacTransfer;
  }
  if (asset.kind === "native") return caps.nativeDestination;
  return caps.classicDestination;
}

// ---------- code relations ----------

function ancestors(code: ReasonCode): ReasonCode[] {
  const out: ReasonCode[] = [];
  let cur = REFINES[code];
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = REFINES[cur];
  }
  return out;
}

/** Fact-level form: root REFINES ancestor, then the first member of its SAME_FACT group. */
export function factOf(code: ReasonCode): ReasonCode {
  const root = ancestors(code).at(-1) ?? code;
  const group = SAME_FACT.find((g) => g.includes(root));
  return group ? group[0]! : root;
}

/** Does reporting `reported` cover an expected `must` code? Exact, or more specific (child of must), or a simulation code naming the same fact. */
function covers(reported: ReasonCode, must: ReasonCode): boolean {
  if (reported === must || ancestors(reported).includes(must)) return true;
  const sameFact = SAME_FACT.some((g) => g.includes(reported) && g.includes(must));
  return sameFact && REASON_CODES[reported].derivation === "simulation";
}

const receiveCodesOf = (v: ReceiveVerdict): ReasonCode[] => [...new Set(v.reasons.filter((r) => REASON_CODES[r.code].scope === "receive").map((r) => r.code))].sort();

export type AgreementLevel = "L0" | "L1" | "L2" | "L3";

export function agreementLevel(a: ReceiveVerdict, b: ReceiveVerdict): AgreementLevel {
  if (a.verdict !== b.verdict) return "L3";
  const ca = receiveCodesOf(a);
  const cb = receiveCodesOf(b);
  if (ca.join() === cb.join()) return "L0";
  const fa = [...new Set(ca.map(factOf))].sort().join();
  const fb = [...new Set(cb.map(factOf))].sort().join();
  return fa === fb ? "L1" : "L2";
}

// ---------- ground truth ----------

/** "success" | "failure" for the RECEIVE side, or null when the evidence says nothing about receiving. */
function truthOutcome(t: GroundTruth): "success" | "failure" | null {
  if (t.kind === "horizon-result") {
    if (t.operationResult === "success") return "success";
    if (t.operationResult === "op_underfunded" || t.operationResult === "other") return null; // sender-side or unclassified
    return "failure";
  }
  if (t.kind === "simulation") {
    if (t.outcome === "ok") return "success";
    // #10 Balance is the sender's; #11 BalanceDeauthorized does not say which party (SPEC 8 SIM-5).
    if (t.contractErrorCode === 10 || t.contractErrorCode === 11) return null;
    return "failure";
  }
  return null;
}

/** How a library's verdict relates to the recorded result, in words that claim no more than the evidence shows. */
export function evidenceRelation(verdict: ReceiveVerdictClass, t: GroundTruth): string {
  const what = t.kind === "horizon-result" ? `recorded Horizon result ${t.operationResult}` : t.kind === "simulation" ? `recorded simulation ${t.outcome}${t.contractErrorCode !== undefined ? ` #${t.contractErrorCode}` : ""}` : null;
  const outcome = truthOutcome(t);
  if (!what || outcome === null) return what ? `${what} does not decide the receive side` : "no ledger-derivable evidence for this case";
  if (verdict === "unknown") return `library abstained; ${what}`;
  if (outcome === "failure") return verdict === "cannot_receive" ? `consistent with the ${what} (the payment failed)` : `${what} (the payment failed); the verdict class "${verdict}" does not itself claim success`;
  return verdict === "cannot_receive" ? `contradicts the ${what}` : `consistent with the ${what} (the payment succeeded)`;
}

// ---------- report ----------

const SEV_RANK = { none: 0, info: 1, warning: 2, blocking: 3 } as const;

function cellOf(adapterId: AdapterId, applicable: boolean, v: ReceiveVerdict | undefined): MatrixCell {
  if (!v) return { adapterId, applicable, notRun: true, verdict: "unknown", receiveCodes: [], senderCodes: [], worstSeverity: "none", libraryStatus: "", reasons: [], error: "not run" };
  const receive = v.reasons.filter((r) => REASON_CODES[r.code].scope === "receive");
  const worst = receive.reduce<MatrixCell["worstSeverity"]>((w, r) => (SEV_RANK[r.severity] > SEV_RANK[w] ? r.severity : w), "none");
  const cell: MatrixCell = {
    adapterId,
    applicable,
    notRun: v.error?.kind === "adapter_unavailable",
    verdict: v.verdict,
    receiveCodes: receiveCodesOf(v),
    senderCodes: [...new Set(v.senderSide.map((r) => r.code))].sort(),
    worstSeverity: worst,
    libraryStatus: v.libraryStatus,
    reasons: [...v.reasons, ...v.senderSide].map((r) => ({ code: r.code, severity: r.severity, libraryCode: r.libraryCode, ...(r.message ? { message: r.message } : {}) })),
  };
  if (v.error) cell.error = `${v.error.kind}: ${v.error.message}`;
  return cell;
}

export function buildDiffReport(cases: CaseFile[], truth: Map<string, GroundTruth>, verdicts: ReceiveVerdict[], options: DiffOptions): DiffReport {
  const byKey = new Map(verdicts.map((v) => [`${v.caseId}\u0000${v.adapterId}`, v]));
  const findings: Finding[] = [];
  const add = (kind: FindingKind, caseId: string, adapters: string[], codes: ReasonCode[], detail: string) =>
    findings.push({ kind, caseId, adapters: [...adapters].sort((a, b) => ADAPTER_ORDER.indexOf(a as AdapterId) - ADAPTER_ORDER.indexOf(b as AdapterId)), codes: [...codes].sort(), detail });
  const notRun = new Map<string, { cases: number; reason: string }>();
  const rows: MatrixRow[] = [];

  for (const c of [...cases].sort((a, b) => a.caseId.localeCompare(b.caseId))) {
    const gt: GroundTruth = truth.get(c.caseId) ?? { kind: "none" };
    const cells: MatrixCell[] = [];
    const compared: { id: AdapterId; v: ReceiveVerdict }[] = [];
    for (const id of ADAPTER_ORDER) {
      const caps = options.capabilities.get(id);
      const applicable = caps ? isApplicable(caps, c) : true;
      const v = byKey.get(`${c.caseId}\u0000${id}`);
      const cell = cellOf(id, applicable, v);
      cells.push(cell);
      if (v?.error?.kind === "adapter_unavailable") {
        const n = notRun.get(id) ?? { cases: 0, reason: v.error.message };
        n.cases += 1;
        notRun.set(id, n);
      }
      if (v && v.unmapped.length) add("unmapped_code", c.caseId, [id], [], `library codes with no mapping: ${v.unmapped.join(", ")}`);
      if (!applicable || cell.notRun || !v) continue;
      compared.push({ id, v });
    }

    // agreement
    let agreement: MatrixRow["agreement"];
    if (compared.length === 0) agreement = "not-compared";
    else if (compared.every((x) => x.v.verdict === "unknown")) agreement = "unanimous-unknown";
    else if (compared.length === 1) agreement = "single";
    else {
      let all = true;
      for (let i = 0; i < compared.length; i++) for (let j = i + 1; j < compared.length; j++) if (!["L0", "L1"].includes(agreementLevel(compared[i]!.v, compared[j]!.v))) all = false;
      agreement = all ? "unanimous" : "split";
    }

    // disagreements
    const classes = new Set(compared.map((x) => x.v.verdict));
    if (classes.size > 1) {
      add("verdict_class_differs", c.caseId, compared.map((x) => x.id), [], compared.map((x) => `${x.id}=${x.v.verdict}`).join(", "));
    } else if (compared.length > 1) {
      const differing = new Set<AdapterId>();
      const codes = new Set<ReasonCode>();
      for (let i = 0; i < compared.length; i++)
        for (let j = i + 1; j < compared.length; j++)
          if (agreementLevel(compared[i]!.v, compared[j]!.v) === "L2") {
            differing.add(compared[i]!.id).add(compared[j]!.id);
            for (const code of [...receiveCodesOf(compared[i]!.v), ...receiveCodesOf(compared[j]!.v)]) codes.add(code);
          }
      if (differing.size) add("reason_set_differs", c.caseId, [...differing], [...codes], compared.map((x) => `${x.id}: [${receiveCodesOf(x.v).join(", ")}]`).join("; "));
    }
    const severities = new Map<ReasonCode, Map<AdapterId, string>>();
    for (const x of compared) for (const r of [...x.v.reasons, ...x.v.senderSide]) (severities.get(r.code) ?? severities.set(r.code, new Map()).get(r.code)!).set(x.id, r.severity);
    for (const [code, m] of severities) {
      if (m.size > 1 && new Set(m.values()).size > 1) add("severity_differs", c.caseId, [...m.keys()], [code], [...m].map(([id, s]) => `${id}=${s}`).join(", "));
    }

    // per-adapter checks
    for (const x of compared) {
      const errored = x.v.error !== undefined;
      if (errored) {
        add("adapter_error", c.caseId, [x.id], [], `${x.v.error!.kind}: ${x.v.error!.message}`);
        continue;
      }
      const reported = [...x.v.reasons, ...x.v.senderSide].map((r) => r.code);
      const missing = c.expected.mustReport.filter((m) => !reported.some((r) => covers(r, m)));
      if (missing.length) {
        const parents = missing.map((m) => reported.find((r) => ancestors(m).includes(r))).filter((p): p is ReasonCode => p !== undefined);
        add("coverage_gap", c.caseId, [x.id], missing, `does not report ${missing.join(", ")}${parents.length ? ` (reports the less specific ${parents.join(", ")})` : ""}`);
      }
      if (c.expected.verdict !== "undetermined" && x.v.verdict !== c.expected.verdict) {
        if (x.v.verdict === "unknown") {
          // An abstention is not a wrong answer: report it as a coverage/scope fact with the library's own reason.
          const why = x.v.reasons.find((r) => r.severity === "blocking" || r.code === "UNSUPPORTED_SCENARIO");
          add("abstained", c.caseId, [x.id], [], `answered unknown${why ? ` (${why.libraryCode}${why.message ? `: ${why.message}` : ""})`: ""}; the case expects ${c.expected.verdict}`);
        } else {
          const tag = /^\[([A-Z])\]/.exec(c.expected.rationale)?.[1];
          add("differs_from_expected", c.caseId, [x.id], [], `${x.v.verdict}; the case's authored expectation is ${c.expected.verdict}${tag ? ` [${tag}]` : ""}. Evidence: ${evidenceRelation(x.v.verdict, gt)}`);
          const f = findings.at(-1)!;
          if (tag) f.expectationTag = tag;
          f.evidence = evidenceRelation(x.v.verdict, gt);
        }
      }
      if (!c.tags.includes("@not-derivable")) {
        const outcome = truthOutcome(gt);
        if ((outcome === "failure" && x.v.verdict === "can_receive") || (outcome === "success" && x.v.verdict === "cannot_receive")) {
          const what = gt.kind === "horizon-result" ? `Horizon ${gt.operationResult}` : gt.kind === "simulation" ? `simulation ${gt.outcome}${gt.contractErrorCode !== undefined ? ` #${gt.contractErrorCode}` : ""}` : gt.kind;
          add("contradicts_ground_truth", c.caseId, [x.id], receiveCodesOf(x.v), `${x.v.verdict} but the ledger says ${what}`);
        }
      }
      if (c.tags.includes("@sender-side") && c.expected.verdict === "can_receive" && x.v.verdict === "cannot_receive") add("scope_leak", c.caseId, [x.id], receiveCodesOf(x.v), "a sender-side condition turned the receive verdict into cannot_receive");
      const implied = statusClass(x.v.libraryStatus);
      if (implied !== undefined && implied !== x.v.verdict) add("status_mismatch", c.caseId, [x.id], [], `library status ${x.v.libraryStatus} implies ${implied}; reasons derive ${x.v.verdict}`);
    }

    const row: MatrixRow = { caseId: c.caseId, title: c.title, tags: c.tags, input: c.input, mustReport: c.expected.mustReport, expectedVerdict: c.expected.verdict, groundTruth: gt, cells, agreement };
    const ledger = options.ledgers?.get(c.caseId);
    if (ledger !== undefined) row.ledger = ledger;
    rows.push(row);
  }

  findings.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.caseId.localeCompare(b.caseId) || a.adapters.join().localeCompare(b.adapters.join()) || a.codes.join().localeCompare(b.codes.join()));

  const headline = rows.filter((r) => !r.tags.includes("@synthetic"));
  const headlineIds = new Set(headline.map((r) => r.caseId));
  const counted = findings.filter((f) => headlineIds.has(f.caseId));
  const findingsByKind: Record<string, number> = {};
  for (const k of KIND_ORDER) findingsByKind[k] = counted.filter((f) => f.kind === k).length;
  const ledgers = headline.map((r) => r.ledger).filter((l): l is number => l !== undefined && l > 0);

  const report: DiffReport = {
    schema: "sik.diff-report/1",
    generatedAt: options.generatedAt,
    taxonomyVersion: TAXONOMY_VERSION,
    adapters: options.adapters ?? ADAPTER_ORDER.map((id) => ({ id, version: verdicts.find((v) => v.adapterId === id && v.adapterVersion)?.adapterVersion ?? "", available: verdicts.some((v) => v.adapterId === id && v.error?.kind !== "adapter_unavailable") })),
    fixtureSet: { cases: headline.length, synthetic: rows.length - headline.length, ...(ledgers.length ? { ledgerRange: [Math.min(...ledgers), Math.max(...ledgers)] as [number, number] } : {}) },
    rows,
    findings,
    notRun: ADAPTER_ORDER.filter((id) => notRun.has(id)).map((id) => ({ adapterId: id, ...notRun.get(id)! })),
    notEvaluated: [...(options.notEvaluated ?? [])].sort((a, b) => a.caseId.localeCompare(b.caseId)),
    summary: {
      cases: headline.length,
      synthetic: rows.length - headline.length,
      unanimous: headline.filter((r) => r.agreement === "unanimous").length,
      split: headline.filter((r) => r.agreement === "split").length,
      single: headline.filter((r) => r.agreement === "single").length,
      unanimousUnknown: headline.filter((r) => r.agreement === "unanimous-unknown").length,
      notCompared: headline.filter((r) => r.agreement === "not-compared").length,
      findingsByKind,
      disagreements: counted.filter((f) => FINDING_GROUP[f.kind] === "disagreement").length,
      gaps: counted.filter((f) => FINDING_GROUP[f.kind] === "gap").length,
      expectationDiffs: counted.filter((f) => FINDING_GROUP[f.kind] === "expectation").length,
      errors: counted.filter((f) => FINDING_GROUP[f.kind] === "error").length,
    },
  };
  return report;
}
