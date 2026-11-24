// SPDX-License-Identifier: Apache-2.0
// The recorded testnet run (MKR-031): provenance validates, the audit log verifies and rebuilds to "submitted",
// the transcript is internally consistent, and nothing secret is in it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { createHash } from "node:crypto";
import { AuditLog, MemoryAuditStore, verifyEntries } from "../src/audit/log.ts";
import type { AuditEntry } from "../src/audit/types.ts";
import { parsePolicyDoc } from "../src/policy/parse.ts";
import { RequestService } from "../src/service/requests.ts";

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;
const root = new URL("..", import.meta.url).pathname;
const dir = root + "../../fixtures/maker-checker/testnet/";
const run = JSON.parse(readFileSync(dir + "e2e-run.json", "utf8"));
const entries = readFileSync(dir + "e2e-audit.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l) as AuditEntry);

test("provenance files validate against schemas/provenance.schema.json", () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const v = ajv.compile(JSON.parse(readFileSync(root + "../../schemas/maker-checker/provenance.schema.json", "utf8")));
  const files = readdirSync(dir).filter((f) => f.endsWith(".provenance.json"));
  assert.ok(files.length >= 2);
  for (const f of files) assert.ok(v(JSON.parse(readFileSync(dir + f, "utf8"))), `${f}: ${JSON.stringify(v.errors)}`);
});

test("recorded audit log verifies, matches the transcript head, and rebuilds the request to submitted", async () => {
  const rep = verifyEntries(entries);
  assert.ok(rep.ok);
  assert.deepEqual(rep.head, run.auditHead);
  const log = new AuditLog(new MemoryAuditStore());
  for (const e of entries) await log.store.append(e, e.seq);
  const registry: Record<string, string> = Object.fromEntries(run.world.signers.map((s: { signerId: string; heldBy: string }) => [s.signerId, s.heldBy]));
  const svc = new RequestService({ audit: log, clock: () => 0, signerPrincipal: (s) => registry[s] });
  await svc.rebuild();
  const st = svc.get(run.requestId);
  assert.equal(st.record.state, "submitted");
  assert.equal(st.record.approvals.length, 3);
  assert.ok(st.record.approvals.every((a) => a.attestation.scheme === "stellar-sep53"), "SEP-53 signatures re-verified on replay");
  assert.equal(st.record.txHash, run.submitted.txHash);
});

test("recorded policy is a valid PolicyDoc and the run froze the holder", () => {
  assert.ok("doc" in parsePolicyDoc(JSON.stringify(run.policy)));
  assert.equal(run.frozenReadBack.frozen, true);
  assert.equal(run.steps.length, 20);
  assert.equal(run.steps.filter((s: { expect: string }) => s.expect === "refused").length, 8);
  assert.ok(run.steps.every((s: { expect: string; outcome: string }) => (s.expect === "refused") === /^MKR_E_/.test(s.outcome)));
});

test("the demo token wasm in fixtures is the one the run deployed", () => {
  const sha = createHash("sha256").update(readFileSync(root + "../../fixtures/maker-checker/wasm/rwa-demo.wasm")).digest("hex");
  assert.equal(sha, run.world.deploy.wasmSha256);
});

test("no secret seed anywhere in the recorded fixtures", () => {
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(dir + f, "utf8"), /\bS[A-D][A-Z2-7]{54}\b/, f);
});
