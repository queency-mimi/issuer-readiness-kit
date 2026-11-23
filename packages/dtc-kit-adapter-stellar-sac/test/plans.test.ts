// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, Networks, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { StellarSacAdapter, operationsFromPlan } from "../src/index.ts";

const profile = resolveProfile(loadBundledProfile("dtc-stellar"));
// Deterministic, public-only test addresses: derived from fixed seeds that hold nothing on any network.
const kp = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n));
const ISSUER = kp(1).publicKey();
const A = kp(2).publicKey();
const B = kp(3).publicKey();
const adapter = new StellarSacAdapter({ network: "testnet", assetCode: "SBXTKN", issuerAccount: ISSUER, profile });
const req = { ledger: "stellar-testnet", address: A, cusip: "SBX000AA0" };

describe("StellarSacAdapter plans (DTC-021)", () => {
  it("force transfer is ONE atomic plan: [clawback(from), payment(issuer -> to)], issuer signs, no holder signature", () => {
    const p = adapter.planForceTransfer({ ...req, to: B, tokens: 10n });
    assert.equal(p.atomic, true);
    assert.deepEqual(p.steps.map((s) => s.op), ["clawback", "payment"]);
    assert.deepEqual([...new Set(p.steps.map((s) => s.signer))], [ISSUER]);
    assert.equal(p.steps[0]?.params["from"], A);
    assert.equal(p.steps[1]?.params["destination"], B);
    assert.equal(p.trust, "unknown", "authorities.force-transfer-mechanism is unknown for Stellar");
  });

  it("the unsigned envelope decodes to exactly the planned operations", () => {
    const p = adapter.planForceTransfer({ ...req, to: B, tokens: 10n });
    assert.ok(p.envelopeXdr);
    const tx = TransactionBuilder.fromXDR(p.envelopeXdr, Networks.TESTNET) as Transaction;
    assert.equal(tx.signatures.length, 0, "adapters never sign");
    assert.deepEqual(tx.operations.map((o) => o.type), ["clawback", "payment"]);
    assert.equal(tx.source, ISSUER);
  });

  it("allowlist add/remove set and clear AUTHORIZED on the holder's trustline", () => {
    const add = adapter.planAllowlistAdd(req);
    assert.deepEqual(add.steps.map((s) => [s.op, s.params["authorized"]]), [["set_trust_line_flags", true]]);
    assert.ok(add.preconditions.some((c) => /trustline/i.test(c)));
    const rm = adapter.planAllowlistRemove(req);
    assert.deepEqual(rm.steps.map((s) => [s.op, s.params["authorized"]]), [["set_trust_line_flags", false]]);
  });

  it("an outbound-only restriction (chill) is planned as a two-way deauthorisation with a caveat", () => {
    const p = adapter.planRestrict({ ...req, inbound: false, outbound: true });
    assert.deepEqual(p.steps.map((s) => s.op), ["set_trust_line_flags"]);
    assert.ok(p.caveats.some((c) => /both directions/.test(c)));
  });

  it("mint is an issuer payment; burn is a clawback", () => {
    assert.deepEqual(adapter.planMint({ ...req, tokens: 5n }).steps.map((s) => s.op), ["payment"]);
    assert.deepEqual(adapter.planBurn({ ...req, tokens: 5n }).steps.map((s) => s.op), ["clawback"]);
  });

  it("operationsFromPlan rebuilds stellar-sdk operations from a plan", () => {
    const ops = operationsFromPlan(adapter.planForceTransfer({ ...req, to: B, tokens: 3n }), adapter.asset());
    assert.equal(ops.length, 2);
  });

  it("a non-Stellar address gets a plan without an envelope and says why", () => {
    const p = adapter.planMint({ ...req, address: "SBX-ADDR-NOT-STELLAR", tokens: 1n });
    assert.equal(p.envelopeXdr, undefined);
    assert.ok(p.caveats.some((c) => /not a valid Stellar address/.test(c)));
  });

  it("a mainnet config is refused at runtime (and is a type error)", () => {
    // @ts-expect-error network "mainnet" is not assignable: G-VALUE
    assert.throws(() => new StellarSacAdapter({ network: "mainnet", assetCode: "X", issuerAccount: ISSUER }), /G-VALUE/);
    assert.ok(StrKey.isValidEd25519PublicKey(ISSUER));
  });
});
