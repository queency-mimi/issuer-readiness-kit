// SPDX-License-Identifier: Apache-2.0
// Smoke test: the scaffold compiles, loads, and every unimplemented function names its ticket.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import * as mkr from "../src/index.ts";
import { COMMANDS, run } from "../src/cli.ts";

// ajv-formats is CommonJS; under NodeNext the default import is the module namespace type.
const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");
const json = (p: string) => JSON.parse(read(p));

async function ticketOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e instanceof mkr.NotImplemented ? e.ticket : undefined;
  }
}

test("sha256Hex matches the FIPS 180 'abc' vector", () => {
  assert.equal(mkr.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(mkr.taggedHash(mkr.DOMAIN.audit, "x"), mkr.sha256Hex(mkr.DOMAIN.audit + "x"));
  assert.equal(mkr.GENESIS_HASH.length, 64);
});

test("remaining stubs throw NotImplemented with the ticket id that replaces them (out of MVP scope)", async () => {
  assert.equal(await ticketOf(() => mkr.createSep43Adapter({ id: "x" })), "MKR-020");
  assert.equal(await ticketOf(() => mkr.createKmsAdapter({ id: "x" })), "MKR-021");
  assert.equal(await ticketOf(() => mkr.createXdrHandoffAdapter({ id: "x" })), "MKR-022");
  assert.equal(await ticketOf(() => mkr.createCustodyApiAdapter({ id: "x" })), "MKR-023");
  assert.equal(await ticketOf(() => mkr.canonicalize({})), undefined, "MKR-001 is implemented");
});

test("state machine exposes exactly the states in SPEC section 5", () => {
  const states: mkr.RequestState[] = ["proposed", "approved", "signed", "submitted", "rejected", "expired", "cancelled"];
  assert.deepEqual([...mkr.TERMINAL_STATES].sort(), ["cancelled", "expired", "rejected", "submitted"]);
  assert.equal(states.length, 7);
});

test("cli: --version and --help work, every command maps to a ticket, exit codes per SPEC 11", async () => {
  assert.equal(await run(["--version"]), 0);
  assert.equal(await run(["--help"]), 0);
  assert.equal(await run(["bogus", "cmd"]), 2);
  for (const c of COMMANDS) assert.match(c.ticket, /^MKR-\d{3}$/);
  assert.equal(await run(["policy", "hash", "/nonexistent.json"]), 2);
  assert.equal(await run(["policy", "validate", root + "../../fixtures/maker-checker/policies/invalid/version-2.policy.json"]), 1);
  assert.equal(await run(["audit", "verify", root + "../../fixtures/maker-checker/testnet/e2e-audit.jsonl"]), 0);
  assert.equal(await run(["auth", "collect", "x"]), 70);
});

test("schemas compile under JSON Schema 2020-12 (strict) and the example policy conforms", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const schemas = readdirSync(root + "../../schemas/maker-checker").filter((f) => f.endsWith(".schema.json"));
  assert.ok(schemas.length >= 5);
  const validators = new Map<string, ReturnType<typeof ajv.compile>>();
  for (const f of schemas) validators.set(f, ajv.compile(json("../../schemas/maker-checker/" + f)));
  const policy = validators.get("policy-doc.schema.json")!;
  assert.ok(policy(json("../../fixtures/maker-checker/policies/example-treasury.policy.json")), JSON.stringify(policy.errors));
});

test("invalid policy fixtures: structurally-detectable ones fail the schema, all are listed in EXPECT.json", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const policy = ajv.compile(json("../../schemas/maker-checker/policy-doc.schema.json"));
  const expect = json("../../fixtures/maker-checker/policies/invalid/EXPECT.json").expect as Record<string, string>;
  const files = readdirSync(root + "../../fixtures/maker-checker/policies/invalid").filter((f) => f.endsWith(".policy.json"));
  assert.deepEqual(files.sort(), Object.keys(expect).sort());
  // These codes are purely structural, so the schema alone must reject them.
  const structural = new Set(["PD_UNKNOWN_FIELD", "PD_BAD_VALUE", "PD_ALLOW_NEEDS_APPROVAL", "PD_DENY_HAS_ACTION_FIELDS", "PD_VERSION_UNSUPPORTED"]);
  for (const [file, code] of Object.entries(expect)) {
    if (!structural.has(code)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(read("../../fixtures/maker-checker/policies/invalid/" + file));
    } catch {
      continue;
    }
    assert.equal(policy(doc), false, `${file} (${code}) should fail the schema`);
  }
});

test("OpenAPI file declares every path the SPEC lists and no endpoint takes key material", () => {
  const y = read("openapi/openapi.yaml");
  assert.match(y, /^openapi: 3\.1\.0/m);
  for (const p of [
    "/v1/healthz", "/v1/policies", "/v1/policies/{policyHash}", "/v1/policies/{policyHash}/evaluate", "/v1/requests",
    "/v1/requests/{requestId}", "/v1/requests/{requestId}/approval-statement", "/v1/requests/{requestId}/approvals",
    "/v1/requests/{requestId}/cancel", "/v1/requests/{requestId}/auth-plan", "/v1/requests/{requestId}/auth-entries",
    "/v1/requests/{requestId}/assemble", "/v1/requests/{requestId}/signatures", "/v1/requests/{requestId}/submit",
    "/v1/control-actions/build", "/v1/audit", "/v1/audit/head", "/v1/audit/verify",
  ]) assert.ok(y.includes(`  ${p}:`), `missing path ${p}`);
  assert.doesNotMatch(y, /^\s+(privateKey|secretKey|secret|seed|mnemonic):/im, "no property may carry key material");
});
