// SPDX-License-Identifier: Apache-2.0
// PFH-021: the seeder refuses anything but testnet; the case plan covers every catalogue case it claims, with
// inputs that match the catalogue and no secret material.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { assertTestnetWrite, planCases, SEEDED_CASES, TESTNET } from "../src/fixtures/seed.ts";
import type { WorldAddresses } from "../src/fixtures/seed.ts";
import { CASE_CATALOGUE, NOT_CAPTURED_REASON } from "../src/fixtures/catalogue.ts";
import { assertNoSecrets } from "../src/fixtures/load.ts";
import { PfhError } from "../src/errors.ts";

const pub = () => Keypair.random().publicKey();
const c = () => StrKey.encodeContract(Keypair.random().rawPublicKey());
function world(): WorldAddresses {
  const roles = ["iPlain", "iAuth", "iClaw", "iRev", "iCtrl", "iNoSac", "sRich", "sPoor", "sDeauth"] as const;
  const dests = Object.fromEntries(SEEDED_CASES.map((id) => [id, pub()]));
  return {
    ...(Object.fromEntries(roles.map((r) => [r, pub()])) as Record<(typeof roles)[number], string>),
    dest: dests,
    sacTest: c(), sacAuth: c(), sacRev: c(), undeployed: c(),
  };
}

test("seed guard: only the public testnet endpoints and passphrase may be written to", () => {
  assert.doesNotThrow(() => assertTestnetWrite(TESTNET));
  const bad = [
    { ...TESTNET, passphrase: "Public Global Stellar Network ; September 2015" },
    { ...TESTNET, horizonUrl: "https://horizon.stellar.org" },
    { ...TESTNET, rpcUrl: "https://mainnet.sorobanrpc.com" },
  ];
  for (const cfg of bad) assert.throws(() => assertTestnetWrite(cfg), (e: unknown) => e instanceof PfhError && e.code === "PFH_E_CAPTURE_WRITE_ATTEMPT");
});

test("seed plan: every catalogue case is either seeded or listed as not captured with a reason", () => {
  const seeded = new Set<string>(SEEDED_CASES);
  for (const entry of CASE_CATALOGUE) assert.ok(seeded.has(entry.caseId) !== (entry.caseId in NOT_CAPTURED_REASON), entry.caseId);
});

test("seed plan: inputs are schema-shaped, testnet, and contain no secret; truth kinds match the catalogue", () => {
  const plans = planCases(world());
  assert.deepEqual(plans.map((p) => p.caseId).sort(), [...SEEDED_CASES].sort());
  for (const p of plans) {
    const entry = CASE_CATALOGUE.find((e) => e.caseId === p.caseId)!;
    assert.equal(p.input.network, "testnet");
    assertNoSecrets(JSON.stringify(p, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)), p.caseId);
    const truthKind = p.truth.kind === "payment" ? "horizon-result" : p.truth.kind;
    assert.equal(truthKind, entry.truth.kind === "none" ? "none" : entry.truth.kind, p.caseId);
    if (p.input.destination.startsWith("M")) assert.ok(StrKey.isValidMed25519PublicKey(p.input.destination));
  }
});
