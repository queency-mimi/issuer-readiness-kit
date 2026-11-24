// SPDX-License-Identifier: Apache-2.0
// MKR-031: end-to-end testnet run through the HTTP API. Records a transcript the web console replays.
//
// What it does (testnet only, throwaway keys generated at runtime and never written):
//   deploy the DEMO-ONLY RWA token, register a policy, show refusals (deny rule, per-request limit,
//   recipient list, separation of duties, bad attestation, cooldown), collect three SEP-53 approvals, plan the
//   operator's auth entry, collect it from a second signer, assemble with enforce-mode simulation, sign the
//   envelope as the fee payer, submit, and read is_frozen(holder) back.
// Output: fixtures/testnet/e2e-run.json, e2e-audit.jsonl, e2e-run.provenance.json (no secrets).
//
// Usage: node --dns-result-order=ipv4first scripts/e2e-testnet.ts [rpcUrl]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ApiError, createClient } from "../src/api/client.ts";
import type { ApiCall } from "../src/api/client.ts";
import { startServer } from "../src/api/server.ts";
import { FileAuditStore } from "../src/audit/file-store.ts";
import { AuditLog, verifyEntries } from "../src/audit/log.ts";
import { RequestService } from "../src/service/requests.ts";
import { createRpcSubmitter } from "../src/service/submit.ts";
import { createWorld, readIsFrozen, EXPLORER_TX } from "./lib/world.ts";
import { walletRoutes, worldInfo } from "./lib/wallet-sim.ts";

const root = new URL("..", import.meta.url).pathname;
const COOLDOWN = 20;
const startedAt = new Date().toISOString().slice(0, 19) + "Z";
const log = (m: string) => process.stderr.write(`[e2e] ${m}\n`);

interface Step {
  n: number;
  title: string;
  actor: string;
  /** What the step is meant to show. */
  expect: "ok" | "refused";
  calls: { method: string; path: string; status: number; code?: string; message?: string }[];
  outcome: string;
  auditSeqAfter?: number;
  data?: Record<string, unknown>;
}

const world = await createWorld({ rpcUrl: process.argv[2], cooldownSeconds: COOLDOWN, log });
const runDir = root + "out/e2e-" + Date.now();
mkdirSync(runDir, { recursive: true });
const auditPath = runDir + "/audit.jsonl";
const audit = new AuditLog(new FileAuditStore(auditPath));
const svc = new RequestService({
  audit,
  auth: world.deps,
  submitter: createRpcSubmitter({ server: world.server, networkPassphrase: world.passphrase }),
  clock: () => Math.floor(Date.now() / 1000),
  signerPrincipal: (s) => world.registry[s],
});

let token: string | undefined;
let calls: ApiCall[] = [];
const holder = { policyHash: "" };
const srv = await startServer({
  service: svc,
  port: 0,
  authenticate: (t) => (t.startsWith("demo:") ? t.slice(5) : undefined),
  extraRoutes: (req, res, body) => walletRoutes(world, svc, holder.policyHash)(req, res, body),
});
const api = createClient(srv.url, { token: () => token, onCall: (c) => calls.push(c) });
const as = (p: string) => {
  token = `demo:${p}`;
};

const steps: Step[] = [];
async function step(title: string, actor: string, expect: "ok" | "refused", fn: () => Promise<{ outcome: string; data?: Record<string, unknown> }>) {
  calls = [];
  as(actor);
  let outcome: string;
  let data: Record<string, unknown> | undefined;
  try {
    const r = await fn();
    outcome = r.outcome;
    data = r.data;
    if (expect === "refused") throw new Error(`step "${title}" should have been refused`);
  } catch (e) {
    if (!(e instanceof ApiError) || expect === "ok") throw e;
    outcome = `${e.body.code}: ${e.body.message}`;
  }
  const head = await svc.deps.audit.store.head();
  const s: Step = {
    n: steps.length + 1, title, actor, expect,
    calls: calls.filter((c) => !c.path.startsWith("/demo/")).map((c) => ({ method: c.method, path: c.path.replace(/[0-9a-f]{64}/g, (h) => `${h.slice(0, 8)}…`), status: c.status, ...(c.ok ? {} : { code: String((c.body as { code?: string }).code), message: String((c.body as { message?: string }).message) }) })),
    outcome, ...(head ? { auditSeqAfter: head.seq } : {}), ...(data ? { data } : {}),
  };
  steps.push(s);
  log(`${s.n}. ${title}: ${outcome}`);
}

type View = { request: { id: string; summary: { headline: string } }; state: string; signingEligibleAt?: string; decision: { requirement?: unknown }; plan?: { slots: { slotId: string; address: string; credentialType: string; signatureExpirationLedger: number }[] }; submit?: { txHash: string; ledger?: number; createdAt?: string } };
const sep53 = async (rid: string, approver: string, opts: { tamper?: boolean } = {}) => {
  const st = await api.get<{ statement: { at: string; nonce: string }; message: string }>(`/v1/requests/${rid}/approval-statement?approver=${approver}&decision=approve`);
  const sig = await api.post<{ signatureBase64: string; address: string }>("/demo/wallet/sign-message", { principal: approver, message: opts.tamper ? st.message.replace('"approve"', '"reject"') : st.message, requestId: rid });
  return api.post<View>(`/v1/requests/${rid}/approvals`, { approver, decision: "approve", at: st.statement.at, nonce: st.statement.nonce, attestation: { scheme: "stellar-sep53", address: sig.address, signatureBase64: sig.signatureBase64 } });
};

let rid = "";
await step("Register the policy", "admin-dana", "ok", async () => {
  const r = await api.post<{ policyHash: string }>("/v1/policies", { policy: world.policy, registeredBy: "admin-dana" });
  holder.policyHash = r.policyHash;
  return { outcome: `policy ${r.policyHash.slice(0, 12)}… registered`, data: { policyHash: r.policyHash } };
});
await step("Propose a mint (forbidden by a deny rule)", "maker-alice", "refused", async () => {
  await api.post("/v1/requests", { policyHash: holder.policyHash, maker: "maker-alice", intent: { source: world.signers["fee-payer-key"]!.address, contract: world.token, function: "mint", args: [{ type: "address", value: world.holder }, { type: "i128", value: "1000" }, { type: "address", value: world.signers["operator-key"]!.address }] } });
  return { outcome: "unexpected" };
});
await step("Propose a 2,000 XLM treasury transfer (cap is 1,000 XLM per request)", "maker-alice", "refused", async () => {
  await api.post("/v1/requests", { policyHash: holder.policyHash, maker: "maker-alice", intent: { source: world.signers["fee-payer-key"]!.address, contract: world.xlmSac, function: "transfer", args: [{ type: "address", value: world.signers["fee-payer-key"]!.address }, { type: "address", value: world.treasuryRecipient }, { type: "i128", value: "20000000000" }] } });
  return { outcome: "unexpected" };
});
await step("Propose 10 XLM to an address not on the recipients list", "maker-alice", "refused", async () => {
  await api.post("/v1/requests", { policyHash: holder.policyHash, maker: "maker-alice", intent: { source: world.signers["fee-payer-key"]!.address, contract: world.xlmSac, function: "transfer", args: [{ type: "address", value: world.signers["fee-payer-key"]!.address }, { type: "address", value: world.signers["operator-key"]!.address }, { type: "i128", value: "100000000" }] } });
  return { outcome: "unexpected" };
});
await step("Propose the freeze of the holder (SEP-57 set_address_frozen)", "maker-alice", "ok", async () => {
  const r = await api.post<View>("/v1/requests", { policyHash: holder.policyHash, maker: "maker-alice", reason: "Demo: court order reference held outside the log", control: { source: world.signers["fee-payer-key"]!.address, params: { kind: "freeze", token: world.token, operator: world.signers["operator-key"]!.address, userAddress: world.holder } } });
  rid = r.request.id;
  return { outcome: `proposed; requirement pinned: 2 checkers + 1 admin, cooldown ${COOLDOWN} s`, data: { requestId: rid, headline: r.request.summary.headline, requirement: r.decision.requirement } };
});
await step("Maker tries to approve her own request", "maker-alice", "refused", () => sep53(rid, "maker-alice").then(() => ({ outcome: "unexpected" })));
await step("Bob approves (SEP-53 signature over the statement)", "checker-bob", "ok", async () => ({ outcome: `state ${(await sep53(rid, "checker-bob")).state}, 1 of 2 checkers` }));
await step("Bob tries to approve a second time", "checker-bob", "refused", () => sep53(rid, "checker-bob").then(() => ({ outcome: "unexpected" })));
await step("Carol sends a signature over a different statement", "checker-carol", "refused", () => sep53(rid, "checker-carol", { tamper: true }).then(() => ({ outcome: "unexpected" })));
await step("Carol approves", "checker-carol", "ok", async () => ({ outcome: `state ${(await sep53(rid, "checker-carol")).state}, 2 of 2 checkers, admin pending` }));
await step("Dana (admin) approves: threshold met", "admin-dana", "ok", async () => {
  const v = await sep53(rid, "admin-dana");
  return { outcome: `state ${v.state}; signing allowed from ${v.signingEligibleAt}`, data: { signingEligibleAt: v.signingEligibleAt } };
});
let slotId = "";
await step("Plan the authorisation entries (record-mode simulation)", "admin-dana", "ok", async () => {
  const r = await api.post<{ plan: { slots: { slotId: string; address: string; credentialType: string; signatureExpirationLedger: number; preimageHash: string }[]; planLedger: number } }>(`/v1/requests/${rid}/auth-plan`);
  const s = r.plan.slots[0]!;
  slotId = s.slotId;
  return { outcome: `${r.plan.slots.length} slot: ${s.credentialType} entry for the operator ${s.address.slice(0, 6)}…, valid until ledger ${s.signatureExpirationLedger}`, data: { planLedger: r.plan.planLedger, slots: r.plan.slots } };
});
await step("Operator signs before the cooldown has passed", "admin-dana", "refused", async () => {
  const sig = await api.post<{ signedEntryXdr: string }>("/demo/wallet/sign-auth-entry", { requestId: rid, slotId, signerId: "operator-key" });
  await api.post(`/v1/requests/${rid}/auth-entries`, { slotId, signerId: "operator-key", signedEntryXdr: sig.signedEntryXdr });
  return { outcome: "unexpected" };
});
log(`waiting ${COOLDOWN + 2} s for the cooldown`);
await new Promise((r) => setTimeout(r, (COOLDOWN + 2) * 1000));
await step("The operator entry arrives from the maker's device", "maker-alice", "refused", async () => {
  const sig = await api.post<{ signedEntryXdr: string }>("/demo/wallet/sign-auth-entry", { requestId: rid, slotId, signerId: "alice-device" });
  await api.post(`/v1/requests/${rid}/auth-entries`, { slotId, signerId: "alice-device", signedEntryXdr: sig.signedEntryXdr });
  return { outcome: "unexpected" };
});
await step("Operations desk signs the operator's authorisation entry", "admin-dana", "ok", async () => {
  const sig = await api.post<{ signedEntryXdr: string }>("/demo/wallet/sign-auth-entry", { requestId: rid, slotId, signerId: "operator-key" });
  const r = await api.post<{ complete: boolean }>(`/v1/requests/${rid}/auth-entries`, { slotId, signerId: "operator-key", signedEntryXdr: sig.signedEntryXdr });
  return { outcome: `share verified (ed25519 over the planned preimage hash); all slots complete: ${r.complete}` };
});
await step("Assemble: enforce-mode simulation with the signed entry", "checker-carol", "ok", async () => {
  const r = await api.post<{ envelopeHash: string }>(`/v1/requests/${rid}/assemble`);
  return { outcome: `envelope ${r.envelopeHash.slice(0, 12)}… ready for the fee payer`, data: { envelopeHash: r.envelopeHash } };
});
await step("Fee payer signs the envelope", "checker-carol", "ok", async () => {
  const sig = await api.post<{ signedEnvelopeXdr: string }>("/demo/wallet/sign-envelope", { requestId: rid, signerId: "fee-payer-key" });
  const v = await api.post<View>(`/v1/requests/${rid}/signatures`, { signerId: "fee-payer-key", signedEnvelopeXdr: sig.signedEnvelopeXdr });
  return { outcome: `state ${v.state}` };
});
let submitted: View["submit"];
await step("Submit to testnet", "checker-carol", "ok", async () => {
  const v = await api.post<View>(`/v1/requests/${rid}/submit`);
  submitted = v.submit;
  return { outcome: `state ${v.state}; tx ${v.submit?.txHash.slice(0, 12)}… in ledger ${v.submit?.ledger}`, data: { ...v.submit, explorer: EXPLORER_TX + v.submit?.txHash } };
});
const frozen = await readIsFrozen(world, world.holder);
await step("Read is_frozen(holder) back from testnet", "checker-bob", "ok", async () => ({ outcome: `is_frozen = ${frozen.frozen} at ledger ${frozen.latestLedger}`, data: frozen }));
const verify = await api.post<{ ok: boolean; entries: number; head?: { seq: number; hash: string } }>("/v1/audit/verify", {});
await step("Verify the audit chain", "checker-bob", "ok", async () => ({ outcome: `ok=${verify.ok}, ${verify.entries} entries, head ${verify.head?.hash.slice(0, 12)}…`, data: verify }));
await srv.close();

// ---- write the recording (public data only; no keys exist outside this process's memory)
const entries = (await audit.readAll());
const local = verifyEntries(entries);
if (!local.ok || !frozen.frozen) throw new Error("run did not end verified and frozen; not recording");
const outDir = root + "../../fixtures/maker-checker/testnet/";
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + "e2e-audit.jsonl", readFileSync(auditPath, "utf8"));
const finishedAt = new Date().toISOString().slice(0, 19) + "Z";
const record = {
  kind: "maker-checker testnet e2e run",
  startedAt, finishedAt,
  network: "testnet",
  rpcUrl: world.rpcUrl,
  world: worldInfo(world, holder.policyHash),
  policy: world.policy,
  requestId: rid,
  cooldownSeconds: COOLDOWN,
  submitted,
  frozenReadBack: frozen,
  auditHead: local.head,
  auditEntries: local.entries,
  steps,
};
writeFileSync(outDir + "e2e-run.json", JSON.stringify(record, null, 2) + "\n");
const prov = (fixture: string, notes: string) => JSON.stringify({
  fixture,
  capturedAt: finishedAt,
  script: "scripts/e2e-testnet.ts",
  network: "testnet",
  source: { kind: "soroban-rpc", url: world.rpcUrl, method: "simulateTransaction, sendTransaction, getTransaction" },
  ledger: submitted?.ledger ?? frozen.latestLedger,
  containsSecrets: false,
  notes,
}, null, 2) + "\n";
const common = `Token deployed at ledger ${world.deploy.deployLedger}; freeze transaction in ledger ${submitted?.ledger}; is_frozen read back at ledger ${frozen.latestLedger}. Throwaway keys were generated with Keypair.random() inside the run and never written. Addresses, XDR, hashes and SEP-53 signatures over approval statements are public evidence.`;
writeFileSync(outDir + "e2e-run.provenance.json", prov("e2e-run.json", common));
writeFileSync(outDir + "e2e-audit.provenance.json", prov("e2e-audit.jsonl", "The run's audit log, byte for byte. " + common));
log(`recorded ${outDir}e2e-run.json (${steps.length} steps, ${local.entries} audit entries)`);
