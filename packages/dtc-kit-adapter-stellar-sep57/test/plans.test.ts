// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, Networks, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { StellarSep57Adapter } from "../src/index.ts";

const profile = resolveProfile(loadBundledProfile("dtc-stellar"));
const kp = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)).publicKey();
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 9));
const OPERATOR = kp(1);
const A = kp(2);
const B = kp(3);
const adapter = new StellarSep57Adapter({ network: "testnet", tokenContractId: TOKEN, operator: OPERATOR, profile });
const req = { ledger: "stellar-testnet", address: A, cusip: "SBX000AA0" };
const fnName = (p: { envelopeXdr?: string }) => {
  assert.ok(p.envelopeXdr);
  const tx = TransactionBuilder.fromXDR(p.envelopeXdr, Networks.TESTNET) as Transaction;
  // stellar-sdk 17.4 decodes the host function as a plain object: { invokeContract: { functionName, ... } }
  const op = tx.operations[0] as unknown as { func: { invokeContract: { functionName: { toString(): string } } } };
  return op.func.invokeContract.functionName.toString();
};

describe("StellarSep57Adapter plans (DTC-025)", () => {
  it("force transfer is one forced_transfer call by the operator, no holder signature", () => {
    const p = adapter.planForceTransfer({ ...req, to: B, tokens: 10n });
    assert.equal(p.atomic, true);
    assert.deepEqual(p.steps.map((s) => [s.op, s.signer]), [["forced_transfer", OPERATOR]]);
    assert.equal(fnName(p), "forced_transfer");
    assert.equal(p.trust, "unknown");
  });
  it("plans reference the SEP-57 function names", () => {
    assert.equal(fnName(adapter.planMint({ ...req, tokens: 1n })), "mint");
    assert.equal(fnName(adapter.planBurn({ ...req, tokens: 1n })), "burn");
    assert.equal(fnName(adapter.planRestrict({ ...req, inbound: true, outbound: true })), "set_address_frozen");
    assert.equal(fnName(adapter.planUnrestrict(req)), "set_address_frozen");
  });
  it("an outbound-only restriction carries a caveat: whether a frozen address can receive is not in the SEP", () => {
    const p = adapter.planRestrict({ ...req, inbound: false, outbound: true });
    assert.ok(p.caveats.some((c) => /inbound/i.test(c)));
  });
  it("allowlist add is identity-registry dependent: a plan with no envelope and a caveat", () => {
    const p = adapter.planAllowlistAdd(req);
    assert.equal(p.envelopeXdr, undefined);
    assert.ok(p.caveats.some((c) => /identity/i.test(c)));
  });
  it("a mainnet config is refused", () => {
    // @ts-expect-error G-VALUE
    assert.throws(() => new StellarSep57Adapter({ network: "mainnet", tokenContractId: TOKEN, operator: OPERATOR }), /G-VALUE/);
  });
});
