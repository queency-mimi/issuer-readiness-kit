// SPDX-License-Identifier: Apache-2.0
// MKR-009 / 025 / 026 / 027: RequestService over the HTTP API (offline RPC), projection rebuild, registry, submitter.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Networks } from "@stellar/stellar-sdk";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { ApiError, createClient } from "../src/api/client.ts";
import { startServer } from "../src/api/server.ts";
import { AuditLog, MemoryAuditStore, verifyEntries } from "../src/audit/log.ts";
import { MkrError } from "../src/errors.ts";
import { RequestService } from "../src/service/requests.ts";
import { approve, T0, testWorld } from "./helpers/world.ts";

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;
const root = new URL("..", import.meta.url).pathname;
const errCode = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof ApiError ? `${e.status} ${e.body.code}` : e instanceof MkrError ? e.code : String(e)));

test("full flow over HTTP: propose, refusals, approvals, cooldown, plan, collect, assemble, sign, submit; audit verifies", async () => {
  const w = testWorld({ cooldown: 60 });
  let as = "admin-dana";
  const srv = await startServer({ service: w.svc, port: 0, authenticate: (t) => (t.startsWith("demo:") ? t.slice(5) : undefined) });
  const api = createClient(srv.url, { token: () => `demo:${as}` });
  try {
    const health = await api.get<{ ok: boolean; mainnetSubmitAllowed: boolean }>("/v1/healthz");
    assert.deepEqual([health.ok, health.mainnetSubmitAllowed], [true, false]);
    const { policyHash } = await api.post<{ policyHash: string }>("/v1/policies", { policy: w.policy, registeredBy: "admin-dana" });
    as = "maker-alice";
    assert.equal(await errCode(api.post("/v1/requests", { policyHash, maker: "checker-bob", intent: { source: w.feePayer.address, contract: w.token, function: "pause", args: [] } })), "422 MKR_E_SOD_VIOLATION");
    assert.equal(await errCode(api.post("/v1/requests", { policyHash, maker: "maker-alice", intent: { source: w.feePayer.address, contract: w.token, function: "mint", args: [{ type: "address", value: w.holder }, { type: "i128", value: "1" }, { type: "address", value: w.operator.address }] } })), "403 MKR_E_POLICY_DENIED");
    const v = await api.post<{ request: { id: string }; state: string; decision: { requirement: { checkersMin: number } } }>("/v1/requests", { policyHash, maker: "maker-alice", control: { source: w.feePayer.address, params: { kind: "freeze", token: w.token, operator: w.operator.address, userAddress: w.holder } } });
    const rid = v.request.id;
    assert.deepEqual([v.state, v.decision.requirement.checkersMin], ["proposed", 2]);
    const sep53 = async (who: "checker-bob" | "checker-carol" | "admin-dana" | "maker-alice") => {
      as = who;
      const s = await api.get<{ statement: { at: string; nonce: string }; message: string }>(`/v1/requests/${rid}/approval-statement?approver=${who}&decision=approve`);
      const sig = await w.p[who].signMessage({ message: s.message, address: w.p[who].address, requestId: rid });
      return api.post<{ state: string; signingEligibleAt?: string }>(`/v1/requests/${rid}/approvals`, { approver: who, decision: "approve", at: s.statement.at, nonce: s.statement.nonce, attestation: { scheme: "stellar-sep53", address: w.p[who].address, signatureBase64: sig.status === "signed" ? sig.signatureBase64 : "" } });
    };
    assert.equal(await errCode(sep53("maker-alice")), "422 MKR_E_SOD_VIOLATION");
    await sep53("checker-bob");
    assert.equal(await errCode(sep53("checker-bob")), "422 MKR_E_SOD_VIOLATION");
    await sep53("checker-carol");
    const done = await sep53("admin-dana");
    assert.equal(done.state, "approved");
    as = "admin-dana";
    const { plan } = await api.post<{ plan: { slots: { slotId: string; entryXdr: string; signatureExpirationLedger: number; preimageHash: string; address: string }[] } }>(`/v1/requests/${rid}/auth-plan`);
    const slot = plan.slots[0]!;
    const signed = await w.operator.signAuthEntry({ networkPassphrase: Networks.TESTNET, entryXdr: slot.entryXdr, validUntil: slot.signatureExpirationLedger, preimageXdr: "", preimageHash: slot.preimageHash, nodePath: "0", address: slot.address, summary: [], requestId: rid, slotId: slot.slotId });
    const entry = signed.status === "signed" ? signed.entryXdr : "";
    assert.equal(await errCode(api.post(`/v1/requests/${rid}/auth-entries`, { slotId: slot.slotId, signerId: "operator-key", signedEntryXdr: entry })), "409 MKR_E_TRANSITION_ILLEGAL"); // cooldown
    w.clock.now += 61;
    assert.equal(await errCode(api.post(`/v1/requests/${rid}/auth-entries`, { slotId: slot.slotId, signerId: "alice-device", signedEntryXdr: entry })), "422 MKR_E_SOD_VIOLATION"); // S3
    assert.deepEqual(await api.post(`/v1/requests/${rid}/auth-entries`, { slotId: slot.slotId, signerId: "operator-key", signedEntryXdr: entry }), { slotId: slot.slotId, status: "collected", complete: true });
    const env = await api.post<{ envelopeXdr: string }>(`/v1/requests/${rid}/assemble`);
    const se = await w.feePayer.signTransaction({ networkPassphrase: Networks.TESTNET, envelopeXdr: env.envelopeXdr, address: w.feePayer.address, summary: [], requestId: rid });
    const sx = se.status === "signed" ? se.envelopeXdr : "";
    assert.equal(await errCode(api.post(`/v1/requests/${rid}/signatures`, { signerId: "alice-device", signedEnvelopeXdr: sx })), "422 MKR_E_SOD_VIOLATION");
    assert.equal((await api.post<{ state: string }>(`/v1/requests/${rid}/signatures`, { signerId: "fee-payer-key", signedEnvelopeXdr: sx })).state, "signed");
    const sub = await api.post<{ state: string; txHash: string }>(`/v1/requests/${rid}/submit`);
    assert.equal(sub.state, "submitted");
    assert.equal(w.submitted.length, 1);
    assert.equal((await api.post<{ state: string }>(`/v1/requests/${rid}/submit`)).state, "submitted", "submit is idempotent");
    assert.equal(w.submitted.length, 1);
    const rep = await api.post<{ ok: boolean; entries: number }>("/v1/audit/verify", {});
    assert.ok(rep.ok);
    const csv = await (await fetch(`${srv.url}/v1/audit?format=csv`, { headers: { authorization: "Bearer demo:checker-bob" } })).text();
    assert.match(csv, /request\.submitted/);
    assert.equal((await fetch(`${srv.url}/v1/requests`)).status, 401, "no token, no access");
    // Every audit entry validates against the schema; no entry carries a raw auth-entry or tx signature.
    const all = await w.audit.readAll();
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const val = ajv.compile(JSON.parse(readFileSync(root + "../../schemas/maker-checker/audit-entry.schema.json", "utf8")));
    for (const e of all) assert.ok(val(e));
    assert.doesNotMatch(JSON.stringify(all), new RegExp(entry.slice(20, 80).replace(/[+/]/g, ".")));
    // Projection rebuilt from the log alone equals the live one.
    const fresh = new RequestService({ ...w.svc.deps, audit: w.audit });
    await fresh.rebuild();
    assert.deepEqual(fresh.get(rid).record, w.svc.get(rid).record);
    assert.deepEqual([...fresh.policies.keys()], [...w.svc.policies.keys()]);
  } finally {
    await srv.close();
  }
});

test("registry: admin only, idempotent, supersedes must be registered, superseded policy refuses new proposals", async () => {
  const w = testWorld();
  await assert.rejects(w.svc.registerPolicy(w.policy, "checker-bob"), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_SOD_VIOLATION");
  const a = await w.svc.registerPolicy(w.policy, "admin-dana");
  assert.equal((await w.svc.registerPolicy(w.policy, "admin-dana")).policyHash, a.policyHash);
  assert.equal((await w.audit.readAll()).length, 1);
  await assert.rejects(w.svc.registerPolicy({ ...w.policy, name: "v2", supersedes: "f".repeat(64) }, "admin-dana"), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_POLICY_INVALID");
  const b = await w.svc.registerPolicy({ ...w.policy, name: "v2", supersedes: a.policyHash }, "admin-dana");
  assert.equal(w.svc.getPolicy(a.policyHash).supersededBy, b.policyHash);
  await assert.rejects(w.svc.proposeControl({ policyHash: a.policyHash, maker: "maker-alice", source: w.feePayer.address, params: { kind: "pause", token: w.token, caller: w.operator.address } }), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_POLICY_DENIED");
});

test("rolling spend comes from the projection: approved requests count, cancelled ones release", async () => {
  const w = testWorld();
  const { policyHash } = await w.svc.registerPolicy(w.policy, "admin-dana");
  const send = (amount: string) => w.svc.propose({ policyHash, maker: "maker-alice", intent: { source: w.feePayer.address, contract: w.xlm, function: "transfer", args: [{ type: "address", value: w.feePayer.address }, { type: "address", value: w.recipient }, { type: "i128", value: amount }] } });
  const r1 = await send("900");
  await approve(w, r1.record.request.id, "checker-bob");
  assert.deepEqual(w.svc.priorSpend(w.policy, w.clock.now), [{ contract: w.xlm, windowSeconds: 86400, total: "900" }]);
  await assert.rejects(send("700"), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_POLICY_DENIED" && /ROLLING_LIMIT_EXCEEDED/.test(e.message));
  await w.svc.cancel(r1.record.request.id, "maker-alice");
  assert.equal((await send("700")).record.state, "proposed");
  w.clock.now += 86401;
  assert.equal(w.svc.priorSpend(w.policy, w.clock.now)[0]!.total, "0");
});

test("expiry sweep, mainnet submit blocked, failed submit stays signed with request.submit_failed", async () => {
  const w = testWorld({ cooldown: 0 });
  const { policyHash } = await w.svc.registerPolicy(w.policy, "admin-dana");
  const st = await w.svc.proposeControl({ policyHash, maker: "maker-alice", source: w.feePayer.address, params: { kind: "pause", token: w.token, caller: w.operator.address } });
  w.clock.now += 86400;
  assert.deepEqual(await w.svc.expireSweep(), [st.record.request.id]);
  assert.equal(w.svc.get(st.record.request.id).record.state, "expired");

  const f = testWorld({ cooldown: 0 });
  const fp = await f.svc.registerPolicy(f.policy, "admin-dana");
  const fr = await f.svc.proposeControl({ policyHash: fp.policyHash, maker: "maker-alice", source: f.feePayer.address, params: { kind: "pause", token: f.token, caller: f.operator.address } });
  const rid = fr.record.request.id;
  for (const a of ["checker-bob", "checker-carol", "admin-dana"] as const) await approve(f, rid, a);
  const { plan } = await f.svc.plan(rid);
  const s = plan.slots[0]!;
  const sig = await f.operator.signAuthEntry({ networkPassphrase: Networks.TESTNET, entryXdr: s.entryXdr, validUntil: s.signatureExpirationLedger, preimageXdr: "", preimageHash: s.preimageHash, nodePath: "0", address: s.address, summary: [], requestId: rid, slotId: s.slotId });
  await f.svc.addAuthShare(rid, { slotId: s.slotId, signerId: "operator-key", signedEntryXdr: sig.status === "signed" ? sig.entryXdr : "" });
  const env = await f.svc.assemble(rid);
  const se = await f.feePayer.signTransaction({ networkPassphrase: Networks.TESTNET, envelopeXdr: env.envelopeXdr, address: f.feePayer.address, summary: [], requestId: rid });
  await f.svc.addEnvelopeSignature(rid, { signerId: "fee-payer-key", signedEnvelopeXdr: se.status === "signed" ? se.envelopeXdr : "" });
  (f.svc.deps as { submitter: unknown }).submitter = { submit: async () => ({ txHash: "cd".repeat(32), status: "FAILED" }) };
  await assert.rejects(f.svc.submit(rid), (e: unknown) => e instanceof MkrError);
  assert.equal(f.svc.get(rid).record.state, "signed");
  assert.equal((await f.audit.readAll()).at(-1)!.type, "request.submit_failed");
  // Mainnet: the same signed request under a mainnet policy is refused before any network call.
  f.svc.getPolicy(fp.policyHash).doc.network = { name: "mainnet", passphrase: Networks.PUBLIC };
  await assert.rejects(f.svc.submit(rid), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_MAINNET_SUBMIT_BLOCKED");
  assert.ok(verifyEntries(await f.audit.readAll()).ok);
});

test("HTTP guards: foreign Host and foreign Origin are refused, extra routes need caller authentication, mainnet submitter cannot be built", async () => {
  const w = testWorld({ cooldown: 60 });
  let extraHits = 0;
  const srv = await startServer({
    service: w.svc,
    port: 0,
    corsOrigins: ["http://localhost:5173"],
    authenticate: (t) => (t === "good" ? "admin-dana" : undefined),
    extraRoutes: async (req, res) => {
      if (!req.url?.startsWith("/demo/")) return false;
      extraHits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return true;
    },
  });
  try {
    const ok = { host: `127.0.0.1:${srv.port}` };
    const get = (path: string, headers: Record<string, string>) => fetch(srv.url + path, { headers });
    // node's fetch forbids overriding Host via headers on some versions, so use node:http for the Host cases.
    const raw = (path: string, headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        import("node:http").then(({ request }) => {
          const r = request({ host: "127.0.0.1", port: srv.port, path, headers }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          });
          r.on("error", reject);
          r.end();
        }, reject);
      });
    assert.equal(await raw("/v1/healthz", { host: "evil.example:80" }), 403, "DNS-rebinding Host refused");
    assert.equal(await raw("/v1/healthz", { ...ok, origin: "http://evil.example" }), 403, "foreign Origin refused");
    assert.equal(await raw("/v1/healthz", { ...ok, origin: "http://localhost:5173" }), 200, "allow-listed Origin accepted");
    assert.equal((await get("/v1/healthz", {})).status, 200, "no Origin (node client) accepted");
    assert.equal(await raw("/demo/wallet/sign-message", ok), 401, "extra routes need a bearer token");
    assert.equal(extraHits, 0);
    assert.equal(await raw("/demo/world", { ...ok, authorization: "Bearer good" }), 200);
    assert.equal(extraHits, 1);
  } finally {
    await srv.close();
  }
  const { createRpcSubmitter } = await import("../src/service/submit.ts");
  const { rpc } = await import("@stellar/stellar-sdk");
  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  assert.throws(() => createRpcSubmitter({ server, networkPassphrase: Networks.PUBLIC }), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_MAINNET_SUBMIT_BLOCKED");
  assert.doesNotThrow(() => createRpcSubmitter({ server, networkPassphrase: Networks.TESTNET }));
});
