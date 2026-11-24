// SPDX-License-Identifier: Apache-2.0
// `pnpm demo:data`: build the web report's data from committed fixtures only (offline). Every number the page shows
// comes from this file, which carries its provenance (recorded testnet capture: ledgers, dates, tools).
// Output: web/src/data/report.json and web/public/dtc-wallet-readiness.pack.json. Deterministic for the same
// fixtures and library versions: the "generated" stamp is the latest fixture capture time, not the clock.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { runHarness } from "../src/run.ts";
import { runDtcScenarios } from "../src/dtc/run.ts";
import { buildScenarioPack } from "../src/export/scenario-pack.ts";
import { DTC_SCENARIOS } from "../src/dtc/scenarios.ts";
import { LIBRARY_INVENTORY } from "../src/taxonomy/library-maps.ts";
import { REASON_CODE_LIST, REASON_CODES, TAXONOMY_VERSION } from "../src/taxonomy/codes.ts";
import { CASE_CATALOGUE } from "../src/fixtures/catalogue.ts";
import { checkInventory } from "../src/taxonomy/inventory-check.ts";
import { VERSION } from "../src/cli.ts";
import { caseFacts } from "../src/report/facts.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "../../fixtures/preflight-harness/cases");

const loadedProbe = (await runHarness({ fixturesRoot: fixtures, generatedAt: "pending" })).loaded;
const captureTimes = loadedProbe.map((l) => l.state!.capturedAt).sort();
const generatedAt = captureTimes.at(-1) ?? "1970-01-01T00:00:00Z";
const { report, loaded } = await runHarness({ fixturesRoot: fixtures, generatedAt });
const dtc = await runDtcScenarios(fixtures);

const provs = loaded.map((l) => l.stateProvenance!).filter(Boolean);
const pick = <K extends "rpcVersion" | "horizonVersion" | "protocolVersion">(k: K) => [...new Set(provs.map((p) => p.source[k]).filter((v) => v !== undefined))];
const seedRunsDir = join(root, "../../fixtures/preflight-harness/seed-runs");
const seedRuns = existsSync(seedRunsDir) ? readdirSync(seedRunsDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(seedRunsDir, f), "utf8")) as { ranAt: string; setupTransactions: { purpose: string; hash: string }[]; addresses: Record<string, unknown> }) : [];

// Pack: build, and validate against dtc-kit's published schema in this repository (read as JSON only).
const pack = buildScenarioPack(DTC_SCENARIOS, { version: "2026-11-08" });
const schemaPath = join(root, "../dtc-kit-conformance/schema/scenario-pack.schema.json");
let packCheck: { validatedAgainst: string | null; errors: { path: string; message: string }[] } = { validatedAgainst: null, errors: [] };
if (existsSync(schemaPath)) {
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(schemaPath, "utf8")) as object);
  validate(pack);
  packCheck = { validatedAgainst: "dtc-kit packages/conformance/schema/scenario-pack.schema.json", errors: (validate.errors ?? []).map((e) => ({ path: e.instancePath, message: e.message ?? e.keyword })) };
}

const inventory = checkInventory(LIBRARY_INVENTORY, root);
const data = {
  schema: "pfh.demo-data/1",
  meta: {
    harnessVersion: VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    reasonCodes: REASON_CODE_LIST.length,
    catalogueCases: CASE_CATALOGUE.length,
    generatedFromFixturesAt: generatedAt,
    provenance: {
      kind: "recorded testnet capture",
      network: "testnet",
      ledgerRange: report.fixtureSet.ledgerRange ?? null,
      capturedFrom: captureTimes[0] ?? null,
      capturedTo: captureTimes.at(-1) ?? null,
      rpcVersions: pick("rpcVersion"),
      horizonVersions: pick("horizonVersion"),
      protocolVersions: pick("protocolVersion"),
      script: "scripts/seed-testnet.ts (seed with throwaway keys) + src/fixtures/capture.ts (read-only capture)",
      replay: "pfh run: each library's own code replays the snapshot offline; no network during replay",
    },
    seedRuns: seedRuns.map((r) => ({ ranAt: r.ranAt, setupTransactions: r.setupTransactions.length })),
  },
  adapters: report.adapters.map((a) => {
    const inv = LIBRARY_INVENTORY[a.id as keyof typeof LIBRARY_INVENTORY];
    const ic = inventory.find((x) => x.adapterId === a.id);
    return { ...a, repo: inv.repo, licence: inv.licence, install: inv.install.method, commit: inv.commit, codes: inv.codes.length, inventoryCheck: ic?.skipped ? "skipped" : ic && ic.missingFromInventory.length === 0 ? "ok" : "fail" };
  }),
  summary: report.summary,
  rows: report.rows,
  findings: report.findings,
  notRun: report.notRun,
  notEvaluated: report.notEvaluated,
  codes: Object.fromEntries(Object.entries(REASON_CODES).map(([k, v]) => [k, { group: v.group, scope: v.scope, summary: v.summary }])),
  facts: Object.fromEntries(loaded.map((l) => [l.testCase.caseId, caseFacts(l.testCase, l.state!, l.truth, l.stateProvenance)])),
  dtc: {
    ...dtc,
    scenarios: dtc.scenarios.map((s) => {
      const def = DTC_SCENARIOS.find((d) => d.id === s.id);
      const got = new Set(s.receive?.flatMap((r) => r.codes) ?? []);
      const missingReceive = (s.expected?.receiveReasons ?? []).filter((c) => !got.has(c));
      return { ...s, given: def?.given ?? null, ...(s.matchesExpectation === false ? { mismatch: { missingReceiveReasons: missingReceive } } : {}) };
    }),
  },
  pack: { file: "dtc-wallet-readiness.pack.json", version: pack.version, scenarios: pack.scenarios.length, check: packCheck },
};

mkdirSync(join(root, "web/src/data"), { recursive: true });
mkdirSync(join(root, "web/public"), { recursive: true });
writeFileSync(join(root, "web/src/data/report.json"), JSON.stringify(data, null, 2) + "\n");
writeFileSync(join(root, "web/public/dtc-wallet-readiness.pack.json"), JSON.stringify(pack, null, 2) + "\n");
process.stdout.write(`demo data: ${report.summary.cases} captured cases, ${report.findings.length} findings, ${dtc.scenarios.filter((s) => s.status === "evaluated").length}/12 DTC scenarios evaluated -> web/src/data/report.json\n`);
