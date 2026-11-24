// SPDX-License-Identifier: Apache-2.0
// PFH-021/022: seed the catalogue cases on the PUBLIC TESTNET with throwaway keys, capture each case read-only,
// submit one ground-truth payment per classic case, and write fixtures/cases/<id>/ with provenance.
// Keys exist only in memory for the duration of this process (G-SECRETS). Usage:
//   node scripts/seed-testnet.ts [--case id,id] [--out fixtures/cases]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { seedWorld, TESTNET } from "../src/fixtures/seed.ts";
import type { CasePlan } from "../src/fixtures/seed.ts";
import { captureSnapshot } from "../src/fixtures/capture.ts";
import { CASE_CATALOGUE } from "../src/fixtures/catalogue.ts";
import { assertNoSecrets } from "../src/fixtures/load.ts";
import { schemaErrors } from "../src/fixtures/validate.ts";
import type { CaseFile, GroundTruth, Provenance, StateSnapshot } from "../src/types.ts";

// This machine has no IPv6 route; Node's dual-stack connect races time out on Cloudflare-fronted hosts.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);
const { values } = parseArgs({ options: { case: { type: "string" }, out: { type: "string" } } });
const root = fileURLToPath(new URL("..", import.meta.url));
const outRoot = values.out ?? join(root, "../../fixtures/preflight-harness/cases");
const only = values.case ? new Set(values.case.split(",")) : null;
const log = { write: (l: string) => process.stdout.write(l + "\n") };
const SCRIPT = "scripts/seed-testnet.ts";

function writeJson(dir: string, name: string, value: unknown, schema: Parameters<typeof schemaErrors>[0]): void {
  const errors = schemaErrors(schema, value);
  if (errors) throw new Error(`${dir}/${name}: ${errors}`);
  const text = JSON.stringify(value, null, 2) + "\n";
  assertNoSecrets(text, `${dir}/${name}`);
  writeFileSync(join(dir, name), text);
}

function caseFile(plan: CasePlan): CaseFile {
  const entry = CASE_CATALOGUE.find((e) => e.caseId === plan.caseId)!;
  return { schema: "sik.case/1", caseId: entry.caseId, title: entry.title, tags: entry.tags, input: plan.input, expected: entry.expected, captured: true };
}

function simulationTruth(state: StateSnapshot): GroundTruth {
  const sim = state.simulations[0];
  if (!sim) return { kind: "none", note: "no simulation recorded" };
  if (sim.result.ok) return { kind: "simulation", outcome: "ok", note: `simulateTransaction of ${sim.call.split("(")[0]} returned success (unsigned envelope, ledger ${state.ledger}).` };
  if (sim.result.contractErrorCode !== undefined) return { kind: "simulation", outcome: "contract-error", contractErrorCode: sim.result.contractErrorCode, note: `simulateTransaction failed with Error(Contract, #${sim.result.contractErrorCode}) at ledger ${state.ledger}.` };
  return { kind: "none", note: `simulateTransaction failed with a host error that carries no contract error code: ${sim.result.error.split("\n")[0]!.slice(0, 200)}` };
}

process.stdout.write(`Seeding the public testnet (${TESTNET.horizonUrl}). Throwaway keys stay in memory; only public addresses are printed.\n`);
const world = await seedWorld(log);
const plans = world.plans.filter((p) => !only || only.has(p.caseId));
await new Promise((r) => setTimeout(r, 6000)); // let Horizon and RPC ingest the last ledger

const captured: { plan: CasePlan; state: StateSnapshot; dir: string }[] = [];
for (const plan of plans) {
  const dir = join(outRoot, plan.caseId);
  mkdirSync(dir, { recursive: true });
  const { snapshot, provenance } = await captureSnapshot({
    network: "testnet", horizonUrl: TESTNET.horizonUrl, rpcUrl: TESTNET.rpcUrl, script: SCRIPT,
    accounts: plan.accounts, contracts: plan.contracts, sacHolders: plan.sacHolders, reads: plan.reads, simulate: plan.simulate,
    notes: `Seeded on testnet by ${SCRIPT} with throwaway keys (never stored), then captured read-only: Horizon GET and RPC read methods; simulations use unsigned envelopes. Reads are not atomic across Horizon and RPC. Testnet resets make these addresses dead; the fixture is a dated snapshot.`,
  });
  writeJson(dir, "case.json", caseFile(plan), "case");
  writeJson(dir, "state.json", snapshot, "state-snapshot");
  writeJson(dir, "state.provenance.json", provenance, "provenance");
  captured.push({ plan, state: snapshot, dir });
  log.write(`  ok  captured ${plan.caseId} at ledger ${snapshot.ledger}`);
}

// Ground truth after every capture, so no payment changes a snapshot.
for (const { plan, state, dir } of captured) {
  let truth: GroundTruth;
  let ledger = state.ledger;
  let urls = [`${TESTNET.rpcUrl} simulateTransaction`];
  if (plan.truth.kind === "payment") {
    const r = await world.submitTruth(plan);
    truth = r.truth;
    ledger = r.ledger || state.ledger;
    urls = [`${TESTNET.horizonUrl}/transactions (POST, testnet)`, `${TESTNET.horizonUrl}/transactions/{hash}`];
  } else if (plan.truth.kind === "simulation") truth = simulationTruth(state);
  else truth = { kind: "none", note: plan.truth.note };
  const prov: Provenance = {
    fixture: "truth.json", capturedAt: new Date().toISOString(), script: SCRIPT, network: "testnet",
    source: { kind: "captured", urls }, ledger, readsAreAtomic: false, containsSecrets: false,
    notes: plan.truth.kind === "payment" ? "One payment submitted on testnet from a throwaway sender after the state capture; the Horizon operation result is the ground truth." : plan.truth.kind === "simulation" ? "The recorded simulateTransaction outcome in state.json is the ground truth for this contract transfer (unsigned, not submitted)." : "No ground truth obtainable for this case.",
  };
  writeJson(dir, "truth.json", truth, "ground-truth");
  writeJson(dir, "truth.provenance.json", prov, "provenance");
}

const runLog = {
  note: "Public record of one seeding run on the Stellar testnet. Addresses and hashes only; no keys were ever written.",
  ranAt: new Date().toISOString(),
  horizon: TESTNET.horizonUrl,
  rpc: TESTNET.rpcUrl,
  addresses: world.addresses,
  setupTransactions: world.txs,
  cases: captured.map((c) => c.plan.caseId),
};
mkdirSync(join(root, "../../fixtures/preflight-harness/seed-runs"), { recursive: true });
const runFile = join(root, "../../fixtures/preflight-harness/seed-runs", `${runLog.ranAt.slice(0, 10)}.json`);
const text = JSON.stringify(runLog, null, 2) + "\n";
assertNoSecrets(text, runFile);
writeFileSync(runFile, text);
process.stdout.write(`done: ${captured.length} case(s) written under ${outRoot}; run log ${runFile}\n`);
