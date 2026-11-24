// SPDX-License-Identifier: Apache-2.0
// MKR-008 / MKR-007 / MKR-024: hash chain, tamper classes, stores, export.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { controlActionEntries, toCsv, toJsonl } from "../src/audit/export.ts";
import { FileAuditStore } from "../src/audit/file-store.ts";
import { AuditLog, MemoryAuditStore, verifyEntries } from "../src/audit/log.ts";
import type { AuditEntry } from "../src/audit/types.ts";
import { MkrError } from "../src/errors.ts";
import { GENESIS_HASH } from "../src/hash.ts";

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;
const root = new URL("..", import.meta.url).pathname;
const RID = "a".repeat(64);

async function sample(n = 6): Promise<AuditEntry[]> {
  const log = new AuditLog(new MemoryAuditStore());
  for (let i = 0; i < n; i++) await log.append({ type: i === 0 ? "request.proposed" : "approval.recorded", actor: i === 0 ? "maker-alice" : i === 1 ? "=HYPERLINK(1)" : "checker-bob", requestId: RID, data: { i, kind: "control", headline: "=cmd|' /C calc'!A0" } }, 1_800_000_000 + i);
  return log.readAll();
}

test("append builds seq, prevHash and hash; entries validate against the schema", async () => {
  const e = await sample(3);
  assert.deepEqual(e.map((x) => x.seq), [0, 1, 2]);
  assert.equal(e[0]!.prevHash, GENESIS_HASH);
  assert.equal(e[1]!.prevHash, e[0]!.hash);
  assert.ok(verifyEntries(e).ok);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const v = ajv.compile(JSON.parse(readFileSync(root + "../../schemas/maker-checker/audit-entry.schema.json", "utf8")));
  for (const x of e) assert.ok(v(x), JSON.stringify(v.errors));
});

test("verify names the first failing seq for each tamper class", async () => {
  const e = await sample(6);
  const edited = structuredClone(e);
  (edited[2]!.data as Record<string, unknown>).i = 99;
  assert.deepEqual(verifyEntries(edited).failure, { seq: 2, reason: "bad_hash" });
  assert.deepEqual(verifyEntries([...e.slice(0, 2), ...e.slice(3)]).failure, { seq: 2, reason: "bad_seq" });
  assert.deepEqual(verifyEntries([e[0], e[2], e[1], ...e.slice(3)]).failure, { seq: 1, reason: "bad_seq" });
  const regenesis = structuredClone(e);
  regenesis[0]!.prevHash = "1".repeat(64);
  assert.deepEqual(verifyEntries(regenesis).failure, { seq: 0, reason: "bad_prev" });
  const shape = structuredClone(e) as unknown[];
  (shape[3] as Record<string, unknown>).extra = 1;
  assert.deepEqual(verifyEntries(shape).failure, { seq: 3, reason: "bad_shape" });
  assert.deepEqual(verifyEntries([e[0], e[1], e[1], ...e.slice(2)]).failure, { seq: 2, reason: "bad_seq" });
  // Re-hashing an edited entry still breaks the next link.
  const rehash = structuredClone(e);
  (rehash[2]!.data as Record<string, unknown>).i = 99;
  const { auditEntryHash } = await import("../src/audit/log.ts");
  rehash[2]!.hash = auditEntryHash(rehash[2]!);
  assert.deepEqual(verifyEntries(rehash).failure, { seq: 3, reason: "bad_prev" });
});

test("truncation is caught only against an anchored head (SPEC 8.5)", async () => {
  const e = await sample(6);
  assert.ok(verifyEntries(e.slice(0, 4)).ok, "a truncated chain is internally consistent");
  assert.equal(verifyEntries(e.slice(0, 4), { anchoredHead: { seq: 5, hash: e[5]!.hash } }).ok, false);
  assert.ok(verifyEntries(e, { anchoredHead: { seq: 5, hash: e[5]!.hash } }).ok);
  assert.ok(verifyEntries(e.slice(3), { fromSeq: 3, trustedPrevHash: e[2]!.hash }).ok);
});

test("memory store rejects a stale expectedSeq", async () => {
  const s = new MemoryAuditStore();
  const log = new AuditLog(s);
  const a = await log.append({ type: "audit.checkpoint", actor: "system", data: {} }, 1);
  await assert.rejects(s.append({ ...a }, 0), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_AUDIT_APPEND_CONFLICT");
});

test("1,000-entry log verifies quickly", async () => {
  const log = new AuditLog(new MemoryAuditStore());
  for (let i = 0; i < 1000; i++) await log.append({ type: "audit.checkpoint", actor: "system", data: { i } }, 1_800_000_000);
  const t = performance.now();
  assert.ok((await log.verify()).ok);
  assert.ok(performance.now() - t < 2000);
});

test("file store: canonical JSON lines, mode 0600, partial last line refused until repaired", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mkr-audit-"));
  const path = join(dir, "audit.jsonl");
  const store = new FileAuditStore(path);
  const log = new AuditLog(store);
  for (let i = 0; i < 3; i++) await log.append({ type: "audit.checkpoint", actor: "system", data: { i } }, 1_800_000_000 + i);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readFileSync(path, "utf8"), toJsonl(await log.readAll()));
  appendFileSync(path, '{"version":1,"seq":3,"pre');
  await assert.rejects(log.append({ type: "audit.checkpoint", actor: "system", data: {} }, 1), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_AUDIT_CHAIN_BROKEN");
  assert.deepEqual(store.repair(), { moved: true });
  assert.ok(readFileSync(path + ".partial", "utf8").startsWith('{"version"'));
  await log.append({ type: "audit.checkpoint", actor: "system", data: { repaired: true } }, 1_800_000_010);
  assert.ok((await log.verify()).ok);
});

test("file store: a second writer process with a stale head gets MKR_E_AUDIT_APPEND_CONFLICT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mkr-audit2-"));
  const path = join(dir, "audit.jsonl");
  const log = new AuditLog(new FileAuditStore(path));
  const first = await log.append({ type: "audit.checkpoint", actor: "system", data: {} }, 1_800_000_000);
  const script = join(dir, "writer.ts");
  writeFileSync(script, `import { FileAuditStore } from ${JSON.stringify(root + "src/audit/file-store.ts")};
const s = new FileAuditStore(${JSON.stringify(path)});
const e = JSON.parse(process.argv[2]);
try { await s.append(e, 1); console.log("ok"); } catch (err) { console.log(err.code); }`);
  const run = (arg: string) => new Promise<string>((res) => {
    const p = spawn(process.execPath, [script, arg]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => res(out.trim()));
  });
  const next = { ...first, seq: 1, prevHash: first.hash };
  const results = await Promise.all([run(JSON.stringify(next)), run(JSON.stringify(next))]);
  assert.deepEqual(results.sort(), ["MKR_E_AUDIT_APPEND_CONFLICT", "ok"]);
});

test("export: csv quotes, guards formulas, filters control actions, adds the verified head", async () => {
  const e = await sample(3);
  const csv = toCsv(e, { head: { seq: 2, hash: e[2]!.hash } });
  assert.match(csv, /^seq,at,type,actor,requestId,summary\r\n/);
  assert.match(csv, /,'=HYPERLINK\(1\),/);
  assert.match(csv, /,control: =cmd\|' \/C calc'!A0\r\n/);
  assert.match(csv, /# verified head seq 2/);
  assert.equal(controlActionEntries(e).length, 3);
  const fixture = readFileSync(root + "../../fixtures/maker-checker/testnet/e2e-audit.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l) as AuditEntry);
  const golden = readFileSync(root + "../../fixtures/maker-checker/testnet/e2e-control-actions.csv", "utf8");
  assert.equal(toCsv(fixture, { controlActions: true, head: verifyEntries(fixture).head! }), golden);
});
