// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createAllAdapters } from "./adapters/registry.ts";
import { NotImplemented, PfhError } from "./errors.ts";
import { CASE_CATALOGUE } from "./fixtures/catalogue.ts";
import { loadAllCases } from "./fixtures/load.ts";
import { REASON_CODES, TAXONOMY_VERSION } from "./taxonomy/codes.ts";
import { parseAdapterList, reportFrom, runHarness } from "./run.ts";
import { renderJson, renderMarkdown } from "./report/render.ts";
import type { DiffReport } from "./report/diff.ts";
import type { ReceiveVerdict } from "./types.ts";
import { runDtcScenarios } from "./dtc/run.ts";
import { buildScenarioPack } from "./export/scenario-pack.ts";
import { DTC_SCENARIOS } from "./dtc/scenarios.ts";

export const VERSION = "0.1.0";

/** Captured cases in this repository (fixtures/preflight-harness/cases), independent of the working directory. */
const DEFAULT_FIXTURES = fileURLToPath(new URL("../../../fixtures/preflight-harness/cases", import.meta.url));

/** Exit codes: 0 ok, 1 findings/failed verification, 2 usage error, 3 network error, 70 not implemented. */
export const COMMANDS: { name: string; usage: string; ticket: string | null }[] = [
  { name: "adapters", usage: "pfh adapters [--json]", ticket: null },
  { name: "taxonomy", usage: "pfh taxonomy [--json]", ticket: null },
  { name: "catalogue", usage: "pfh catalogue [--json]", ticket: null },
  { name: "fixtures validate", usage: "pfh fixtures validate [--root fixtures/preflight-harness/cases]", ticket: null },
  { name: "run", usage: "pfh run [--fixtures fixtures/preflight-harness/cases] [--adapters a,b,c] [--cases id,...] [--out out/] [--allow-unmapped] [--fail-on-findings] [--generated-at ISO]", ticket: null },
  { name: "report", usage: "pfh report --in out/verdicts.json [--fixtures fixtures/preflight-harness/cases] [--format md|json|both] [--out out/] [--check out/report.json]", ticket: null },
  { name: "dtc run", usage: "pfh dtc run [--fixtures fixtures/preflight-harness/cases] [--out out/]", ticket: null },
  { name: "export-pack", usage: "pfh export-pack --out out/dtc-wallet-readiness.pack.json [--pack-version YYYY-MM-DD]", ticket: null },
  { name: "capture", usage: "node scripts/capture.ts --accounts G...,G... --network testnet   |   node scripts/seed-testnet.ts [--case id,...]", ticket: null },
  { name: "run --live", usage: "pfh run --live (read-only live mode)", ticket: "PFH-014" },
];

export function helpText(): string {
  const lines = [`pfh ${VERSION} (preflight-harness; read-only replay; never signs or submits)`, "", "Commands:"];
  for (const c of COMMANDS) lines.push("  " + c.usage + (c.ticket ? `   [not implemented: ${c.ticket}]` : ""));
  lines.push("", "Global: --help, --version, --json", "Stellar-Preflight runs only after you run scripts/fetch-competitors.sh and set PFH_ALLOW_COMPETITOR_CODE=1.");
  return lines.join("\n") + "\n";
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const writeFile = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
/** Report JSON minus generatedAt: what `report --check` compares. */
const comparable = (r: DiffReport) => renderJson({ ...r, generatedAt: "" });

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: "boolean" }, version: { type: "boolean" }, json: { type: "boolean" }, root: { type: "string" },
      fixtures: { type: "string" }, adapters: { type: "string" }, cases: { type: "string" }, out: { type: "string" },
      "allow-unmapped": { type: "boolean" }, "fail-on-findings": { type: "boolean" }, "generated-at": { type: "string" },
      "pack-version": { type: "string" }, in: { type: "string" }, format: { type: "string" }, check: { type: "string" }, live: { type: "boolean" },
    },
  });
  const o = parsed.values;
  const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : s + "\n");
  const err = (s: string) => process.stderr.write(s.endsWith("\n") ? s : s + "\n");
  if (o.version) return out(VERSION), 0;
  if (o.help || parsed.positionals.length === 0) return out(helpText()), 0;
  const name = parsed.positionals.length >= 2 && ["fixtures", "dtc"].includes(parsed.positionals[0]!) ? parsed.positionals.slice(0, 2).join(" ") : parsed.positionals[0]!;
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd) {
    err(`unknown command: ${parsed.positionals.join(" ")}\n${helpText()}`);
    return 2;
  }
  const fixtures = str(o.fixtures) ?? DEFAULT_FIXTURES;
  const outDir = str(o.out) ?? "out";
  const generatedAt = str(o["generated-at"]) ?? new Date().toISOString();

  try {
    switch (name) {
      case "adapters": {
        const infos = await Promise.all(createAllAdapters().map((a) => a.info()));
        if (o.json) out(JSON.stringify(infos, null, 2));
        else for (const i of infos) out(`${i.available ? "ok     " : "MISSING"} ${i.id} ${i.version} ${i.installHint}`.trimEnd());
        return 0;
      }
      case "taxonomy":
        if (o.json) out(JSON.stringify({ version: TAXONOMY_VERSION, codes: REASON_CODES }, null, 2));
        else for (const [code, meta] of Object.entries(REASON_CODES)) out(`${code.padEnd(40)} ${meta.group}/${meta.scope}/${meta.defaultSeverity}  ${meta.summary}`);
        return 0;
      case "catalogue":
        if (o.json) out(JSON.stringify(CASE_CATALOGUE, null, 2));
        else for (const c of CASE_CATALOGUE) out(`${c.caseId.padEnd(46)} ${c.expected.verdict.padEnd(26)} ${c.tags.join(" ")}`);
        return 0;
      case "fixtures validate": {
        const fixturesRoot = str(o.root) ?? fixtures;
        const cases = loadAllCases(fixturesRoot);
        out(`ok: ${cases.length} case(s) under ${fixturesRoot} (${cases.filter((c) => c.state).length} with state, ${cases.filter((c) => c.truth).length} with ground truth)`);
        return 0;
      }
      case "run": {
        if (o.live) throw new NotImplemented("PFH-014");
        const adapters = parseAdapterList(str(o.adapters));
        const cases = str(o.cases)?.split(",").map((s) => s.trim()).filter(Boolean);
        const { verdicts, report } = await runHarness({ fixturesRoot: fixtures, adapters, ...(cases ? { cases } : {}), allowUnmapped: o["allow-unmapped"] === true, generatedAt });
        writeFile(join(outDir, "verdicts.json"), JSON.stringify(verdicts, null, 2) + "\n");
        writeFile(join(outDir, "report.json"), renderJson(report));
        writeFile(join(outDir, "report.md"), renderMarkdown(report));
        const s = report.summary;
        out(`${report.rows.length} case(s) (${s.cases} captured, ${s.synthetic} synthetic), ${verdicts.length} verdict(s): ${s.disagreements} disagreements, ${s.gaps} gaps, ${s.expectationDiffs} differ from expectation, ${s.errors} contradict evidence or failed. Wrote ${outDir}/{verdicts.json,report.json,report.md}`);
        const headlineFindings = s.disagreements + s.gaps + s.expectationDiffs + s.errors;
        const anyFindings = report.findings.some((f) => f.kind !== "status_mismatch");
        return o["fail-on-findings"] && (headlineFindings > 0 || anyFindings) ? 1 : 0;
      }
      case "report": {
        const input = str(o.in);
        if (!input) throw new PfhError("PFH_E_USAGE", "report needs --in <verdicts.json>");
        const verdicts = JSON.parse(readFileSync(input, "utf8")) as ReceiveVerdict[];
        const loaded = loadAllCases(fixtures).filter((l) => l.state && verdicts.some((v) => v.caseId === l.testCase.caseId));
        const report = await reportFrom(loaded, verdicts, generatedAt);
        const check = str(o.check);
        if (check) {
          const stored = JSON.parse(readFileSync(check, "utf8")) as DiffReport;
          if (comparable(stored) !== comparable(report)) {
            err(`report --check: ${check} differs from a report rebuilt from ${input} (generatedAt excluded)`);
            return 1;
          }
          out(`report --check: ${check} matches`);
          return 0;
        }
        const format = str(o.format) ?? "both";
        if (!["md", "json", "both"].includes(format)) throw new PfhError("PFH_E_USAGE", "--format must be md, json or both");
        if (format !== "md") writeFile(join(outDir, "report.json"), renderJson(report));
        if (format !== "json") writeFile(join(outDir, "report.md"), renderMarkdown(report));
        out(`wrote ${format} report to ${outDir}`);
        return 0;
      }
      case "dtc run": {
        const result = await runDtcScenarios(fixtures);
        writeFile(join(outDir, "dtc-readiness.json"), JSON.stringify(result, null, 2) + "\n");
        for (const r of result.scenarios) out(`${r.id.padEnd(36)} ${r.tag.padEnd(10)} ${r.status === "evaluated" ? `${r.readiness!.padEnd(9)} ${r.matchesExpectation ? "as expected" : "DIFFERS from expectation"}` : `not evaluated: ${r.reason}`}`);
        out(result.disclaimer);
        return 0;
      }
      case "export-pack": {
        const target = str(o.out) ?? "out/dtc-wallet-readiness.pack.json";
        const version = str(o["pack-version"]) ?? new Date().toISOString().slice(0, 10);
        writeFile(target, JSON.stringify(buildScenarioPack(DTC_SCENARIOS, { version }), null, 2) + "\n");
        out(`wrote ${target} (12 scenarios, pack version ${version})`);
        return 0;
      }
      case "capture":
        out(cmd.usage);
        return 0;
      default:
        throw new NotImplemented(cmd.ticket ?? "PFH-000");
    }
  } catch (e) {
    if (e instanceof NotImplemented) {
      err(`${e.message} (${cmd.usage})`);
      return 70;
    }
    if (e instanceof PfhError) {
      err(`${e.code}: ${e.message}`);
      return e.code === "PFH_E_USAGE" ? 2 : e.code === "PFH_E_CAPTURE_NETWORK" ? 3 : 1;
    }
    throw e;
  }
}

if (import.meta.main) {
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EPIPE") throw e;
  });
  process.exitCode = await run(process.argv.slice(2));
}
