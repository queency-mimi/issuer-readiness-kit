// SPDX-License-Identifier: Apache-2.0
// MKR-005 StubSigner and MKR-017 SEP-57 builders.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Account, buildAuthorizationEntryPreimage, Keypair, Networks, Operation, TransactionBuilder, Transaction, xdr, nativeToScVal } from "@stellar/stellar-sdk";
import { buildControlAction } from "../src/control/sep57.ts";
import { MkrError } from "../src/errors.ts";
import { evaluate } from "../src/policy/evaluate.ts";
import { policyHash } from "../src/policy/hash.ts";
import { sha256Hex, hexToBytes } from "../src/hash.ts";
import { StubSigner } from "../src/signer/stub.ts";
import { base64ToBytes } from "../src/workflow/approval.ts";
import { unsignedEntry } from "./helpers/fake-net.ts";
import { contractId, T0, testWorld } from "./helpers/world.ts";

const root = new URL("..", import.meta.url).pathname;

test("StubSigner: runtime keys, distinct per instance, never serialised", async () => {
  const a = new StubSigner("a");
  const b = new StubSigner("b");
  assert.notEqual(a.address, b.address);
  assert.deepEqual(await a.addresses(), [a.address]);
  assert.doesNotMatch(JSON.stringify(a), /"S[A-D][A-Z2-7]{54}"/);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(a))).sort(), ["address", "id", "kind"]);
  const src = readFileSync(root + "src/signer/stub.ts", "utf8");
  assert.doesNotMatch(src, /node:fs|console\.|JSON\.stringify\(this|secret\(\)|rawSecretKey/);
});

test("StubSigner: signMessage verifies (SEP-53), signTransaction adds a valid signature", async () => {
  const s = new StubSigner("s");
  const m = await s.signMessage({ message: "hello", address: s.address, requestId: "r" });
  assert.ok(m.status === "signed" && Keypair.fromPublicKey(s.address).verifyMessage("hello", base64ToBytes(m.signatureBase64)));
  const tx = new TransactionBuilder(new Account(s.address, "1"), { fee: "100", networkPassphrase: Networks.TESTNET }).addOperation(Operation.bumpSequence({ bumpTo: "9" })).setTimebounds(0, T0).build();
  const r = await s.signTransaction({ networkPassphrase: Networks.TESTNET, envelopeXdr: tx.toXDR(), address: s.address, summary: [], requestId: "r" });
  assert.equal(r.status, "signed");
  const signed = new Transaction(r.status === "signed" ? r.envelopeXdr : "", Networks.TESTNET);
  assert.ok(Keypair.fromPublicKey(s.address).verify(signed.hash(), signed.signatures[0]!.signature.value));
  await assert.rejects(s.signMessage({ message: "x", address: Keypair.random().publicKey(), requestId: "r" }), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_SIGNER_UNAVAILABLE");
});

test("StubSigner: signAuthEntry signs over the preimage hash and refuses a mismatched hash", async () => {
  const s = new StubSigner("s");
  const entry = unsignedEntry({ address: s.address, contract: contractId(1), fn: "pause", args: [nativeToScVal(1, { type: "u32" })] });
  const pre = sha256Hex(buildAuthorizationEntryPreimage(entry, 500, Networks.TESTNET).toXdr());
  const req = { networkPassphrase: Networks.TESTNET, entryXdr: entry.toXdr("base64"), validUntil: 500, preimageXdr: "", preimageHash: pre, nodePath: "0", address: s.address, summary: [], requestId: "r", slotId: "x:0" };
  const r = await s.signAuthEntry(req);
  assert.equal(r.status, "signed");
  const signed = xdr.SorobanAuthorizationEntry.fromXdr(r.status === "signed" ? r.entryXdr : "", "base64");
  const { inspectAuthEntry } = await import("@stellar/stellar-sdk");
  const sig = inspectAuthEntry(signed).signers[0]!.signatures![0]!;
  assert.ok(Keypair.fromPublicKey(s.address).verify(hexToBytes(pre), sig.signature));
  await assert.rejects(s.signAuthEntry({ ...req, preimageHash: "0".repeat(64) }), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_AUTH_ENTRY_INVALID");
});

test("StubSigner scripted modes: decline and pending-then-sign", async () => {
  const d = new StubSigner("d", "decline");
  assert.equal((await d.signMessage({ message: "m", address: d.address, requestId: "r" })).status, "declined");
  const p = new StubSigner("p", "pending-then-sign");
  const r = await p.signMessage({ message: "m", address: p.address, requestId: "r" });
  assert.equal(r.status, "pending");
  assert.equal((await p.poll(r.status === "pending" ? r.ticket : "")).status, "signed");
});

test("SEP-57 builders: SPEC 6.1 functions, argument order and summaries", () => {
  const w = testWorld();
  const op = w.operator.address;
  const f = buildControlAction({ kind: "freeze", token: w.token, operator: op, userAddress: w.holder });
  assert.equal(f.function, "set_address_frozen");
  assert.deepEqual(f.args, [{ type: "address", value: w.holder }, { type: "bool", value: true }, { type: "address", value: op }]);
  assert.equal(f.summary.headline, `FREEZE all balances of ${w.holder.slice(0, 4)}...${w.holder.slice(-4)} on token ${w.token.slice(0, 4)}...${w.token.slice(-4)} (operator ${op.slice(0, 4)}...${op.slice(-4)})`);
  assert.ok(f.summary.facts.some(([k, v]) => k === "token" && v === w.token), "full contract id in facts");
  const u = buildControlAction({ kind: "unfreeze", token: w.token, operator: op, userAddress: w.holder });
  assert.deepEqual(u.args[1], { type: "bool", value: false });
  const pf = buildControlAction({ kind: "freeze", token: w.token, operator: op, userAddress: w.holder, amount: "12500000000", decimals: 7 });
  assert.equal(pf.function, "freeze_partial_tokens");
  assert.match(pf.summary.headline, /1250\.0000000 units/);
  const ft = buildControlAction({ kind: "forced_transfer", token: w.token, operator: op, from: w.holder, to: w.recipient, amount: "5", allowedRecipients: [] });
  assert.deepEqual([ft.function, ft.amountArg, ft.recipientArg], ["forced_transfer", 2, 1]);
  assert.ok(ft.summary.warnings.some((x) => x.includes("recipients")));
  assert.deepEqual(buildControlAction({ kind: "pause", token: w.token, caller: op }).args, [{ type: "address", value: op }]);
  assert.ok(buildControlAction({ kind: "freeze", token: w.token, operator: op, userAddress: op }).summary.warnings.length === 1);
});

test("SEP-57 builders refuse bad input", () => {
  const w = testWorld();
  const op = w.operator.address;
  const bad: unknown[] = [
    { kind: "freeze", token: op, operator: op, userAddress: w.holder },
    { kind: "freeze", token: w.token, operator: "GABC", userAddress: w.holder },
    { kind: "freeze", token: w.token, operator: op, userAddress: w.holder, amount: "-1" },
    { kind: "freeze", token: w.token, operator: op, userAddress: w.holder, amount: "1.5" },
    { kind: "forced_transfer", token: w.token, operator: op, from: w.holder, to: w.holder, amount: "5" },
    { kind: "mint", token: w.token },
  ];
  for (const b of bad) assert.throws(() => buildControlAction(b as never), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_USAGE", JSON.stringify(b));
});

test("integration: a built freeze is allowed with 2 checkers + 1 admin; a mint is denied by the deny rule", () => {
  const ex = JSON.parse(readFileSync(root + "../../fixtures/maker-checker/policies/example-treasury.policy.json", "utf8"));
  const token = ex.rules[0].match.targets[0].contract as string;
  const op = Keypair.random().publicKey();
  const b = buildControlAction({ kind: "freeze", token, operator: op, userAddress: Keypair.random().publicKey() });
  const base = { policy: ex, policyHash: policyHash(ex), maker: "maker-alice", networkPassphrase: Networks.TESTNET, nowUnix: T0, priorSpend: [] };
  const d = evaluate({ ...base, nodes: [{ depth: 0, contract: token, function: b.function, args: b.args, authorizer: op }], controlKind: "freeze" });
  assert.equal(d.outcome, "allow");
  assert.deepEqual([d.requirement!.checkersMin, d.requirement!.adminsMin, d.requirement!.cooldownSeconds], [2, 1, 3600]);
  const m = evaluate({ ...base, nodes: [{ depth: 0, contract: token, function: "mint", args: [], authorizer: op }] });
  assert.deepEqual([m.outcome, m.matchedRuleIds], ["deny", ["deny-rwa-mint-burn"]]);
});
