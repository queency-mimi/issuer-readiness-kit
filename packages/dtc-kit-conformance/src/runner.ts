// SPDX-License-Identifier: Apache-2.0
import type { ChainAdapter } from "@sik/dtc-kit-core";
import type { ResolvedProfile, RowStatus } from "@sik/dtc-kit-profile-spec/pure";
import { weakestStatus } from "@sik/dtc-kit-profile-spec/pure";
import { IMPLEMENTATIONS } from "./implementations.ts";
import type { Evidence, RecordedTestnetRun } from "./implementations.ts";
import type { Scenario, ScenarioPack, ScenarioTag } from "./pack.ts";

export type Outcome = "pass" | "fail" | "skipped" | "observed";

export interface ScenarioResult {
  id: string;
  title: string;
  tags: ScenarioTag[];
  outcome: Outcome;
  /** Present for 'skipped', e.g. `unknown-field:wallet.contract-address-registrable` or `not-implemented:DTC-026`. */
  skipReason?: string;
  /** Weakest status among the scenario's required rows. Every report line carries it (G-DTCC). */
  trust: RowStatus;
  /** Profile rows the scenario rests on, and the ones of them that are not published. */
  rows: string[];
  unpublishedRows: string[];
  /** Failure messages, or notes for pass/observed. */
  detail?: string[];
  evidence?: Evidence[];
  /** For 'observed': what happened, recorded as a fixture candidate. */
  observation?: unknown;
  durationMs: number;
}

/**
 * `sandbox`: implemented scenarios run against the in-memory mock registry; @testnet scenarios are skipped.
 * `testnet-recorded`: as sandbox, plus @testnet scenarios replay the recorded testnet run (real
 * transactions from fixtures/, not re-submitted). Live testnet submission is the spike script
 * (packages/dtc-kit-adapter-stellar-sac/scripts/testnet-spike.ts), not this runner.
 */
export type Target = "sandbox" | "testnet-recorded";

export interface RunReport {
  runner: "dtc-kit-conformance";
  packId: string;
  packVersion: string;
  profile: string;
  profileVersion: string;
  adapter: string;
  target: Target;
  startedAt: string;
  disclaimer: string;
  summary: Record<Outcome, number> & { total: number };
  results: ScenarioResult[];
}

export interface RunOptions {
  pack: ScenarioPack;
  profile: ResolvedProfile;
  adapter: ChainAdapter;
  target: Target;
  /** Run only scenarios with any of these tags (others are reported skipped `not-selected`). */
  include?: ScenarioTag[];
  /** Never run scenarios with any of these tags (default: @slow, plus @testnet for target sandbox). */
  exclude?: ScenarioTag[];
  /** Recorded testnet evidence for target testnet-recorded. */
  testnetRun?: RecordedTestnetRun;
  /** Clock for startedAt (default: now) and durations (default: performance.now). */
  clock?: { iso: () => string; ms: () => number };
}

const adapterTagFor = (id: string): ScenarioTag | undefined => (id === "stellar-sac" ? "@stellar-sac" : id === "stellar-sep57" ? "@stellar-sep57" : undefined);

/**
 * Select, gate on profile rows (an unknown row with onUnknown 'skip' gives `unknown-field:<row>`), run
 * implemented scenarios, report catalogue-only ones as `not-implemented:<ticket>` (SPEC 5.2, DTC-018).
 * A skipped or observed scenario is never a failure. Every line carries its trust label.
 */
export async function runPack(options: RunOptions): Promise<RunReport> {
  const { pack, profile, adapter, target } = options;
  const clock = options.clock ?? { iso: () => new Date().toISOString(), ms: () => performance.now() };
  const exclude = options.exclude ?? (target === "sandbox" ? (["@slow", "@testnet"] as ScenarioTag[]) : (["@slow"] as ScenarioTag[]));
  const myTag = adapterTagFor(adapter.id);
  const startedAt = clock.iso();
  const results: ScenarioResult[] = [];
  for (const s of pack.scenarios) {
    const t0 = clock.ms();
    // SPEC 1.3: an empty row list is `unknown`. A scenario with no rows asserts no DTC rule at all (SC-000).
    const trust: RowStatus = weakestStatus(profile, s.requiresRows);
    const unpublishedRows = s.requiresRows.filter((r) => profile.rows.get(r)?.status !== "published");
    const base = { id: s.id, title: s.title, tags: s.tags, trust, rows: s.requiresRows, unpublishedRows };
    const skip = (skipReason: string): ScenarioResult => ({ ...base, outcome: "skipped", skipReason, durationMs: 0 });
    const reason = selectionProblem(s, options.include, exclude);
    if (reason) {
      results.push(skip(reason));
      continue;
    }
    const impl = IMPLEMENTATIONS[s.id];
    if (s.status !== "implemented" || !impl) {
      results.push(skip(`not-implemented:${s.ticket}`));
      continue;
    }
    const adapterReason = adapterProblem(s, myTag);
    if (adapterReason) {
      results.push(skip(adapterReason));
      continue;
    }
    const unknownRow = s.requiresRows.find((r) => (profile.rows.get(r)?.status ?? "unknown") === "unknown");
    if (unknownRow && s.onUnknown === "skip") {
      results.push(skip(`unknown-field:${unknownRow}`));
      continue;
    }
    if (s.tags.includes("@testnet") && !options.testnetRun) {
      results.push(skip("no-recorded-testnet-run"));
      continue;
    }
    try {
      const r = await impl({ profile, adapter, ...(options.testnetRun ? { testnetRun: options.testnetRun } : {}), now: clock.ms });
      // An unknown row with run-and-label never yields pass/fail: only an observation (SPEC 5.1).
      const outcome = unknownRow ? "observed" : r.outcome;
      results.push({ ...base, outcome, detail: r.detail, evidence: r.evidence, ...(r.observation !== undefined ? { observation: r.observation } : {}), durationMs: round(clock.ms() - t0) });
    } catch (e) {
      results.push({ ...base, outcome: "fail", detail: [`threw: ${e instanceof Error ? e.message : String(e)}`], durationMs: round(clock.ms() - t0) });
    }
  }
  const summary = { total: results.length, pass: 0, fail: 0, skipped: 0, observed: 0 };
  for (const r of results) summary[r.outcome] += 1;
  return {
    runner: "dtc-kit-conformance",
    packId: pack.packId,
    packVersion: pack.version,
    profile: profile.profileId,
    profileVersion: profile.version,
    adapter: adapter.id,
    target,
    startedAt,
    disclaimer: pack.disclaimer,
    summary,
    results,
  };
}

const round = (ms: number) => Math.round(ms * 10) / 10;

function selectionProblem(s: Scenario, include: ScenarioTag[] | undefined, exclude: ScenarioTag[]): string | undefined {
  if (include && include.length > 0 && !s.tags.some((t) => include.includes(t))) return "not-selected";
  const hit = s.tags.find((t) => exclude.includes(t));
  return hit ? `excluded-tag:${hit}` : undefined;
}

function adapterProblem(s: Scenario, myTag: ScenarioTag | undefined): string | undefined {  const adapterTags: ScenarioTag[] = s.tags.filter((t) => t === "@stellar-sac" || t === "@stellar-sep57");
  // Chain-neutral scenarios run with any adapter; an adapter-tagged @testnet scenario needs that adapter.
  if (s.tags.includes("@testnet") && adapterTags.length > 0 && (!myTag || !adapterTags.includes(myTag))) return `other-adapter:${adapterTags.join(",")}`;
  return undefined;
}

/** Exit code per SPEC 5.2: 0 if no fail, 1 if any fail. (2 is the CLI's usage error.) */
export const exitCodeFor = (report: RunReport): 0 | 1 => (report.results.some((r) => r.outcome === "fail") ? 1 : 0);

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JUnit XML: one testcase per scenario; skipped and observed are not failures. */
export function toJunitXml(report: RunReport): string {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- ${xml(report.disclaimer)} -->`,
    `<testsuite name="${xml(`${report.packId}@${report.packVersion} profile=${report.profile}@${report.profileVersion} adapter=${report.adapter} target=${report.target}`)}" tests="${report.summary.total}" failures="${report.summary.fail}" skipped="${report.summary.skipped}" timestamp="${xml(report.startedAt)}">`,
  ];
  for (const r of report.results) {
    lines.push(`  <testcase classname="${xml(r.tags.join(" ") || "untagged")}" name="${xml(`${r.id} [${r.trust}] ${r.title}`)}" time="${(r.durationMs / 1000).toFixed(3)}">`);
    if (r.outcome === "fail") lines.push(`    <failure message="${xml((r.detail ?? []).join("; "))}"/>`);
    if (r.outcome === "skipped") lines.push(`    <skipped message="${xml(r.skipReason ?? "")}"/>`);
    if (r.outcome === "observed") lines.push(`    <system-out>${xml(`OBSERVED (@${r.trust}): ${JSON.stringify(r.observation ?? r.detail ?? null)}`)}</system-out>`);
    lines.push("  </testcase>");
  }
  lines.push("</testsuite>", "");
  return lines.join("\n");
}
