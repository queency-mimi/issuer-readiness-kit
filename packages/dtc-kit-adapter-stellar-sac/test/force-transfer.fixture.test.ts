// SPDX-License-Identifier: Apache-2.0
// DTC-020 / DTC-022 (SAC half) / SC-019 / SC-029 / SC-031: replay the recorded testnet run. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Keypair, Networks, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { verifyFixture } from "../../../scripts/dtc-kit/capture-fixture.ts";
import { StellarSacAdapter } from "../src/index.ts";

interface Step {
  step: string;
  scenario?: string;
  planAction?: string;
  operations: string[];
  hash: string;
  ledger: number | null;
  successful: boolean;
  resultCodes: { transaction?: string; operations?: string[] } | null;
  envelopeXdr: string;
  balancesAfter: Record<string, string>;
}
const REL = "sac-force-transfer/testnet-run.json";
const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "fixtures", "dtc-kit", REL), "utf8");
const run = JSON.parse(text) as { network: string; asset: { code: string; issuer: string }; accounts: Record<string, string>; steps: Step[] };
const find = (re: RegExp): Step => {
  const s = run.steps.find((x) => re.test(x.step));
  assert.ok(s, `no step matching ${re}`);
  return s;
};
const decode = (s: Step) => TransactionBuilder.fromXDR(s.envelopeXdr, Networks.TESTNET) as Transaction;
const hint = (pub: string) => Buffer.from(Keypair.fromPublicKey(pub).signatureHint()).toString("hex");

describe("recorded testnet run (fixtures/sac-force-transfer)", () => {
  it("matches its provenance hash, is testnet, and every step has a ledger", () => {
    const v = verifyFixture(REL);
    assert.equal(v.ok, true);
    assert.equal(v.provenance.network, "testnet");
    assert.equal(run.network, "testnet");
    for (const s of run.steps) assert.ok(s.ledger && s.ledger > 0, s.step);
  });

  it("contains no secret seed (G-SECRETS)", () => {
    for (const token of text.match(/S[A-Z2-7]{55}/g) ?? []) assert.equal(StrKey.isValidEd25519SecretSeed(token), false);
  });

  it("SC-019 main: one transaction [clawback, payment] moved 10 from A to B, signed by the issuer only", () => {
    const s = find(/^SC-019 main/);
    assert.equal(s.successful, true);
    assert.deepEqual(s.operations, ["clawback", "payment"]);
    assert.deepEqual([s.balancesAfter["holderA"], s.balancesAfter["holderB"]], ["0.0000000", "10.0000000"]);
    const tx = decode(s);
    assert.equal(tx.source, run.accounts["issuer"]);
    assert.deepEqual(tx.signatures.map((sig) => Buffer.from(sig.hint.toXdrObject()).toString("hex")), [hint(run.accounts["issuer"] ?? "")]);
  });

  it("SC-019 variant: with B deauthorised the payment leg fails and so does the clawback (atomic); A keeps 10", () => {
    const s = find(/^SC-019 variant/);
    assert.equal(s.successful, false);
    assert.deepEqual(s.resultCodes?.operations, ["op_success", "op_not_authorized"]);
    assert.equal(s.balancesAfter["holderA"], "10.0000000");
  });

  it("SC-029: DTC cannot authorise a trustline that does not exist (op_no_trust)", () => {
    const s = find(/^SC-029/);
    assert.equal(s.successful, false);
    assert.deepEqual(s.resultCodes?.operations, ["op_no_trust"]);
  });

  it("deny paths: the ledger refuses holder payments to a deauthorised wallet and to an address without a trustline", () => {
    assert.deepEqual(find(/deauthorised B$/).resultCodes?.operations, ["op_not_authorized"]);
    assert.deepEqual(find(/to C \(no trustline\)/).resultCodes?.operations, ["op_no_trust"]);
  });

  it("SC-031: a 0.5-token payment succeeds on-chain, so whole tokens are enforceable only off-chain", () => {
    const s = find(/^SC-031/);
    assert.equal(s.successful, true);
    assert.equal(s.balancesAfter["holderA"], "9.5000000");
  });

  it("every adapter-planned step has the operations the adapter plans today", () => {
    const adapter = new StellarSacAdapter({ network: "testnet", assetCode: run.asset.code, issuerAccount: run.asset.issuer });
    for (const s of run.steps.filter((x) => x.planAction)) {
      const tx = decode(s);
      const planned = adapter.planMint({ ledger: "x", address: run.accounts["holderA"] ?? "", cusip: "x", tokens: 1n });
      assert.ok(planned.envelopeXdr);
      const expected: Record<string, string[]> = {
        "allowlist-add": ["setTrustLineFlags"],
        "allowlist-remove": ["setTrustLineFlags"],
        unrestrict: ["setTrustLineFlags"],
        mint: ["payment"],
        "force-transfer": ["clawback", "payment"],
      };
      assert.deepEqual(tx.operations.map((o) => o.type), expected[s.planAction ?? ""], s.step);
    }
  });
});
