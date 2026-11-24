// SPDX-License-Identifier: Apache-2.0
// `pfh run` engine (PFH-008): load fixtures, replay each case through each selected adapter that claims to cover
// it, map, derive, diff. Offline: every read is served from the snapshots.
import { createAdapter, ADAPTER_IDS } from "./adapters/registry.ts";
import type { AdapterCapabilities } from "./adapters/types.ts";
import { PfhError } from "./errors.ts";
import { CASE_CATALOGUE, NOT_CAPTURED_REASON } from "./fixtures/catalogue.ts";
import { loadAllCases } from "./fixtures/load.ts";
import type { LoadedCase } from "./fixtures/load.ts";
import { buildDiffReport, isApplicable } from "./report/diff.ts";
import type { DiffReport } from "./report/diff.ts";
import type { AdapterId } from "./taxonomy/library-maps.ts";
import type { GroundTruth, ReceiveVerdict } from "./types.ts";

export interface RunOptions {
  fixturesRoot: string;
  adapters?: AdapterId[];
  cases?: string[];
  allowUnmapped?: boolean;
  generatedAt: string;
}

export interface RunResult {
  loaded: LoadedCase[];
  verdicts: ReceiveVerdict[];
  report: DiffReport;
}

export function parseAdapterList(list: string | undefined): AdapterId[] {
  if (!list) return [...ADAPTER_IDS];
  const ids = list.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) if (!(ADAPTER_IDS as string[]).includes(id)) throw new PfhError("PFH_E_USAGE", `unknown adapter ${id}; known: ${ADAPTER_IDS.join(", ")}`);
  return ids as AdapterId[];
}

/** Rebuild the report from loaded cases and verdicts (shared by run and `pfh report`). */
export async function reportFrom(loaded: LoadedCase[], verdicts: ReceiveVerdict[], generatedAt: string): Promise<DiffReport> {
  const caps = new Map<string, AdapterCapabilities>(ADAPTER_IDS.map((id) => [id, createAdapter(id).capabilities()]));
  const truth = new Map<string, GroundTruth>(loaded.filter((l) => l.truth).map((l) => [l.testCase.caseId, l.truth!]));
  const ledgers = new Map(loaded.filter((l) => l.state).map((l) => [l.testCase.caseId, l.state!.ledger]));
  const allSynthetic = loaded.every((l) => l.testCase.tags.includes("@synthetic"));
  const have = new Set(loaded.map((l) => l.testCase.caseId));
  const notEvaluated = allSynthetic ? [] : CASE_CATALOGUE.filter((c) => !have.has(c.caseId)).map((c) => ({ caseId: c.caseId, title: c.title, reason: NOT_CAPTURED_REASON[c.caseId] ?? "not captured yet" }));
  const adapters = await Promise.all(ADAPTER_IDS.map(async (id) => {
    const info = await createAdapter(id).info();
    const ran = verdicts.some((v) => v.adapterId === id && v.error?.kind !== "adapter_unavailable");
    return { id, version: info.version, available: ran, ...(info.available ? {} : { note: info.installHint }) };
  }));
  return buildDiffReport(loaded.map((l) => l.testCase), truth, verdicts, { capabilities: caps, generatedAt, ledgers, notEvaluated, adapters });
}

export async function runHarness(options: RunOptions): Promise<RunResult> {
  let loaded = loadAllCases(options.fixturesRoot).filter((l) => l.state);
  if (options.cases) {
    const want = new Set(options.cases);
    for (const id of want) if (!loaded.some((l) => l.testCase.caseId === id)) throw new PfhError("PFH_E_USAGE", `case ${id} has no captured fixture under ${options.fixturesRoot}`);
    loaded = loaded.filter((l) => want.has(l.testCase.caseId));
  }
  const adapters = (options.adapters ?? [...ADAPTER_IDS]).map(createAdapter);
  const verdicts: ReceiveVerdict[] = [];
  for (const l of loaded) {
    for (const a of adapters) {
      if (!isApplicable(a.capabilities(), l.testCase)) continue;
      verdicts.push(await a.replay(l.testCase, l.state!));
    }
  }
  const unmapped = verdicts.filter((v) => v.unmapped.length);
  if (unmapped.length && !options.allowUnmapped) {
    throw new PfhError("PFH_E_UNMAPPED_LIBRARY_CODE", `unmapped library codes: ${unmapped.map((v) => `${v.adapterId}/${v.caseId}: ${v.unmapped.join(", ")}`).join("; ")} (rerun with --allow-unmapped to list them as findings)`);
  }
  return { loaded, verdicts, report: await reportFrom(loaded, verdicts, options.generatedAt) };
}
