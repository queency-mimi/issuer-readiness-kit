// SPDX-License-Identifier: Apache-2.0
// `pfh dtc run` (PFH-026): evaluate every DTC scenario against the captured fixture of its base case. Scenarios
// whose base case is not captured are listed as not evaluated, never given a result.
import { createAllAdapters } from "../adapters/registry.ts";
import { loadAllCases } from "../fixtures/load.ts";
import { NOT_CAPTURED_REASON } from "../fixtures/catalogue.ts";
import { isApplicable } from "../report/diff.ts";
import { REFINES } from "../taxonomy/codes.ts";
import type { ReasonCode } from "../taxonomy/codes.ts";
import type { CaseFile } from "../types.ts";
import { evaluateDtcReadiness } from "./readiness.ts";
import { DTC_SCENARIOS, DTC_STELLAR_DISCLAIMER, scenarioStatusTag } from "./scenarios.ts";
import type { DtcReasonCode, DtcScenarioDef } from "./scenarios.ts";

export interface DtcScenarioResult {
  id: string;
  sc: number;
  title: string;
  area: string;
  tag: "@published" | "@inferred" | "@unknown";
  rows: { profileId: string; rowId: string; status: string }[];
  baseCase: string | null;
  amount?: string;
  status: "evaluated" | "not-evaluated";
  reason?: string;
  ledger?: number;
  capturedAt?: string;
  readiness?: "ready" | "not-ready" | "unknown";
  dtcReasons?: DtcReasonCode[];
  receive?: { adapterId: string; verdict: string; codes: ReasonCode[]; error?: string }[];
  expected: DtcScenarioDef["expect"];
  matchesExpectation?: boolean;
}

export interface DtcRunResult {
  schema: "sik.dtc-readiness/1";
  profile: "dtc-stellar";
  disclaimer: string;
  scenarios: DtcScenarioResult[];
}

const withAncestors = (code: ReasonCode): ReasonCode[] => {
  const out: ReasonCode[] = [code];
  let cur = REFINES[code];
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = REFINES[cur];
  }
  return out;
};

export async function runDtcScenarios(fixturesRoot: string): Promise<DtcRunResult> {
  const loaded = new Map(loadAllCases(fixturesRoot).filter((l) => l.state).map((l) => [l.testCase.caseId, l]));
  const adapters = createAllAdapters();
  const scenarios: DtcScenarioResult[] = [];
  for (const def of [...DTC_SCENARIOS].sort((a, b) => a.sc - b.sc)) {
    const base: Omit<DtcScenarioResult, "status"> = {
      id: def.id, sc: def.sc, title: def.title, area: def.area, tag: scenarioStatusTag(def),
      rows: def.requirementRefs.map((r) => ({ ...r })), baseCase: def.baseCase, expected: def.expect,
      ...(def.inputOverride?.amount ? { amount: def.inputOverride.amount } : {}),
    };
    const fixture = def.baseCase ? loaded.get(def.baseCase) : undefined;
    if (!fixture) {
      scenarios.push({ ...base, status: "not-evaluated", reason: def.baseCase ? `base case ${def.baseCase} is not captured. ${NOT_CAPTURED_REASON[def.baseCase] ?? ""}`.trim() : "no base case" });
      continue;
    }
    const testCase: CaseFile = { ...fixture.testCase, input: { ...fixture.testCase.input, ...(def.inputOverride ?? {}) } };
    const receive = [];
    for (const a of adapters) if (isApplicable(a.capabilities(), testCase)) receive.push(await a.replay(testCase, fixture.state!));
    const result = evaluateDtcReadiness(testCase.input, fixture.state!, receive, { rows: def.requirementRefs.map((r) => r.rowId) });
    const ran = receive.filter((v) => v.error?.kind !== "adapter_unavailable");
    const reported = new Set(ran.flatMap((v) => v.reasons.flatMap((r) => withAncestors(r.code))));
    const matches = result.readiness === def.expect.readiness && def.expect.dtcReasons.every((r) => result.dtcReasons.includes(r)) && def.expect.receiveReasons.every((r) => reported.has(r));
    scenarios.push({
      ...base,
      status: "evaluated",
      ledger: fixture.state!.ledger,
      capturedAt: fixture.state!.capturedAt,
      readiness: result.readiness,
      dtcReasons: result.dtcReasons,
      receive: ran.map((v) => ({ adapterId: v.adapterId, verdict: v.verdict, codes: v.reasons.map((r) => r.code), ...(v.error ? { error: `${v.error.kind}: ${v.error.message}` } : {}) })),
      matchesExpectation: matches,
    });
  }
  return { schema: "sik.dtc-readiness/1", profile: "dtc-stellar", disclaimer: DTC_STELLAR_DISCLAIMER, scenarios };
}
