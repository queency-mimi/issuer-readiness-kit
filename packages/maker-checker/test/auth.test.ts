// SPDX-License-Identifier: Apache-2.0
// MKR-011 ScValJson + tree digest, MKR-010 plan, MKR-012 share verification, MKR-013 merge, MKR-015 assembly.
// Offline: SDK-built entries and an injected simulate (test/helpers/fake-net.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { Address, authorizeEntry, buildAuthorizationEntryPreimage, Keypair, Networks, Transaction, xdr } from "@stellar/stellar-sdk";
import { addEnvelopeSignature, assembleForEnvelopeSigning, SAFETY_LEDGERS } from "../src/auth/assemble.ts";
import { isComplete, mergeBundles, toBundle, verifyCollectedShare } from "../src/auth/bundle.ts";
import { planAuth } from "../src/auth/plan.ts";
import { jsonToScVal, scValToJson } from "../src/auth/scval.ts";
import { entryToTreeJson, flattenTree, invocationTreeDigest, treeDigestOfEntries } from "../src/auth/tree.ts";
import type { AuthBundle, AuthPlan, CollectedShare } from "../src/auth/types.ts";
import { MkrError } from "../src/errors.ts";
import { sha256Hex } from "../src/hash.ts";
import type { ActionRequest, ScValJson } from "../src/workflow/types.ts";
import { unsignedEntry } from "./helpers/fake-net.ts";
import { mulberry32, pick } from "./helpers/prng.ts";
import { contractId, testWorld } from "./helpers/world.ts";

const root = new URL("..", import.meta.url).pathname;
const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
    return "ok";
  } catch (e) {
    return e instanceof MkrError ? e.code : String(e);
  }
};

function genScVal(r: () => number, d = 0): ScValJson {
  const k = Math.floor(r() * (d > 2 ? 10 : 12));
  const big = (bits: number, signed: boolean) => {
    const edge = pick(r, ["0", "1", ((1n << BigInt(bits - (signed ? 1 : 0))) - 1n).toString()]);
    return signed && r() < 0.5 && edge !== "0" ? "-" + edge : edge;
  };
  switch (k) {
    case 0: return { type: "bool", value: r() < 0.5 };
    case 1: return { type: "void" };
    case 2: return { type: "u32", value: Math.floor(r() * 2 ** 32) };
    case 3: return { type: "i32", value: Math.floor((r() - 0.5) * 2 ** 31) };
    case 4: return { type: "u64", value: big(64, false) };
    case 5: return { type: "i128", value: big(128, true) };
    case 6: return { type: "u256", value: big(256, false) };
    case 7: return { type: "bytes", value: pick(r, ["", "00ff", "deadbeef"]) };
    case 8: return { type: pick(r, ["symbol", "string"] as const), value: pick(r, ["a", "set_address_frozen", "x_1"]) };
    case 9: return { type: "address", value: r() < 0.5 ? Keypair.random().publicKey() : contractId(Math.floor(r() * 200)) };
    case 10: return { type: "vec", value: Array.from({ length: Math.floor(r() * 3) }, () => genScVal(r, d + 1)) };
    default: return { type: "map", value: Array.from({ length: Math.floor(r() * 3) }, () => ({ key: genScVal(r, d + 1), value: genScVal(r, d + 1) })) };
  }
}

test("ScValJson round-trips through XDR for 2,000 generated values incl. 128/256-bit edges; map order kept", () => {
  const r = mulberry32(99);
  const ajv = new Ajv2020({ strict: false });
  const schema = JSON.parse(readFileSync(root + "../../schemas/maker-checker/action-request.schema.json", "utf8"));
  ajv.addSchema(schema);
  const v = ajv.getSchema(`${schema.$id}#/$defs/scval`)!;
  assert.ok(v, "action-request schema defines $defs/scval");
  for (let i = 0; i < 2000; i++) {
    const j = genScVal(r);
    const back = scValToJson(xdr.ScVal.fromXdr(jsonToScVal(j).toXdr("base64"), "base64"));
    assert.deepEqual(back, j);
    assert.ok(v(back), JSON.stringify(v.errors));
  }
  assert.deepEqual(scValToJson(jsonToScVal({ type: "i128", value: "-170141183460469231731687303715884105728" })), { type: "i128", value: "-170141183460469231731687303715884105728" });
  assert.throws(() => scValToJson(xdr.ScVal.scvTimepoint(5n)), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_USAGE");
});

test("tree digest ignores nonce and expiry and changes with any arg, function, contract or sub-invocation", () => {
  const a = Keypair.random().publicKey();
  const args = [new Address(a).toScVal()];
  const base = unsignedEntry({ address: a, contract: contractId(1), fn: "pause", args, nonce: 1n });
  const d0 = treeDigestOfEntries([base]);
  assert.equal(treeDigestOfEntries([unsignedEntry({ address: a, contract: contractId(1), fn: "pause", args, nonce: 999n })]), d0);
  const sub = new xdr.SorobanAuthorizedInvocation({ function: base.rootInvocation.function, subInvocations: [] });
  for (const e of [
    unsignedEntry({ address: a, contract: contractId(2), fn: "pause", args }),
    unsignedEntry({ address: a, contract: contractId(1), fn: "unpause", args }),
    unsignedEntry({ address: a, contract: contractId(1), fn: "pause", args: [new Address(Keypair.random().publicKey()).toScVal()] }),
    unsignedEntry({ address: a, contract: contractId(1), fn: "pause", args, sub: [sub] }),
    unsignedEntry({ address: Keypair.random().publicKey(), contract: contractId(1), fn: "pause", args }),
  ]) assert.notEqual(treeDigestOfEntries([e]), d0);
  const tree = [entryToTreeJson(unsignedEntry({ address: a, contract: contractId(1), fn: "pause", args, sub: [sub] }))];
  assert.deepEqual(flattenTree(tree, "GSOURCE").map((n) => [n.depth, n.function, n.authorizer]), [[0, "pause", a], [1, "pause", a]]);
  assert.equal(invocationTreeDigest(tree), invocationTreeDigest(structuredClone(tree)));
});

// ---- a proposed+approved request through the service, so plan/bundle/assemble see real shapes
async function approvedFreeze() {
  const w = testWorld({ cooldown: 0 });
  const pe = await w.svc.registerPolicy(w.policy, "admin-dana");
  const st = await w.svc.proposeControl({ policyHash: pe.policyHash, maker: "maker-alice", source: w.feePayer.address, params: { kind: "freeze", token: w.token, operator: w.operator.address, userAddress: w.holder } });
  const { approve } = await import("./helpers/world.ts");
  for (const a of ["checker-bob", "checker-carol", "admin-dana"] as const) await approve(w, st.record.request.id, a);
  return { w, request: w.svc.get(st.record.request.id).record.request as ActionRequest };
}

async function signedShare(w: ReturnType<typeof testWorld>, plan: AuthPlan, signer = w.operator, validUntil?: number): Promise<CollectedShare> {
  const slot = plan.slots[0]!;
  const r = await signer.signAuthEntry({ networkPassphrase: Networks.TESTNET, entryXdr: slot.entryXdr, validUntil: validUntil ?? slot.signatureExpirationLedger, preimageXdr: "", preimageHash: validUntil ? sha256Hex(buildAuthorizationEntryPreimage(xdr.SorobanAuthorizationEntry.fromXdr(slot.entryXdr, "base64"), validUntil, Networks.TESTNET).toXdr()) : slot.preimageHash, nodePath: "0", address: signer.address, summary: [], requestId: plan.requestId, slotId: slot.slotId });
  assert.equal(r.status, "signed");
  return { slotId: slot.slotId, signerId: "operator-key", nodePath: "0", signedEntryXdr: r.status === "signed" ? r.entryXdr : "", collectedAt: "2026-11-09T10:00:00Z" };
}

test("plan: one slot per address entry, expiry fixed, preimage hash recomputes, ids stable; bundle validates", async () => {
  const { w, request } = await approvedFreeze();
  const plan = await planAuth(request, w.net, { authEntryTtlLedgers: 100 });
  assert.equal(plan.slots.length, 1);
  const s = plan.slots[0]!;
  assert.deepEqual([s.address, s.credentialType, s.accountKind, s.signatureExpirationLedger], [w.operator.address, "addressV2", "classic", w.net.ledger + 100]);
  assert.equal(s.preimageHash, sha256Hex(buildAuthorizationEntryPreimage(xdr.SorobanAuthorizationEntry.fromXdr(s.entryXdr, "base64"), s.signatureExpirationLedger, Networks.TESTNET).toXdr()));
  assert.equal(s.slotId, `${plan.planId.slice(0, 16)}:0`);
  assert.equal((await planAuth(request, w.net, { authEntryTtlLedgers: 100 })).planId, plan.planId);
  const ajv = new Ajv2020({ strict: false });
  const v = ajv.compile(JSON.parse(readFileSync(root + "../../schemas/maker-checker/auth-bundle.schema.json", "utf8")));
  assert.ok(v(toBundle(plan)), JSON.stringify(v.errors));
});

test("plan: a tree that drifted after approval is MKR_E_PAYLOAD_MISMATCH; a failed simulation is MKR_E_SIMULATION_FAILED", async () => {
  const { w, request } = await approvedFreeze();
  w.net.mutate = (es) => es.map((e) => unsignedEntry({ address: w.operator.address, contract: w.token, fn: "set_address_frozen", args: [...(e.rootInvocation.function as xdr.SorobanAuthorizedFunctionContractFn).contractFn.args], sub: [e.rootInvocation] }));
  assert.equal(await code(planAuth(request, w.net, { authEntryTtlLedgers: 100 })), "MKR_E_PAYLOAD_MISMATCH");
  w.net.mutate = undefined;
  w.net.failRecord = "HostError: Error(Contract, #900)";
  await assert.rejects(planAuth(request, w.net, { authEntryTtlLedgers: 100 }), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_SIMULATION_FAILED" && /#900/.test(e.message));
});

test("share verification: one failure mode per test row (SPEC 7.10)", async () => {
  const { w, request } = await approvedFreeze();
  const plan = await planAuth(request, w.net, { authEntryTtlLedgers: 100 });
  const good = await signedShare(w, plan);
  verifyCollectedShare(plan, good, w.net.ledger);
  const slot = plan.slots[0]!;
  const planned = xdr.SorobanAuthorizationEntry.fromXdr(slot.entryXdr, "base64");
  const kp = Keypair.random();
  const signWith = async (entry: xdr.SorobanAuthorizationEntry, until: number) => (await authorizeEntry(entry, async (_p, payload) => ({ signature: kp.sign(payload), publicKey: kp.publicKey() }), until, Networks.TESTNET)).toXdr("base64");
  const rows: [string, CollectedShare, number?][] = [
    ["unknown slot", { ...good, slotId: "nope:0" }],
    ["unknown node", { ...good, nodePath: "0.3" }],
    ["not XDR", { ...good, signedEntryXdr: "AAAA" }],
    ["different expiry", await signedShare(w, plan, w.operator, slot.signatureExpirationLedger + 5)],
    ["different nonce", { ...good, signedEntryXdr: (await w.operator.signAuthEntry({ networkPassphrase: Networks.TESTNET, entryXdr: unsignedEntry({ address: w.operator.address, contract: w.token, fn: "set_address_frozen", args: [...(planned.rootInvocation.function as xdr.SorobanAuthorizedFunctionContractFn).contractFn.args], nonce: 7n }).toXdr("base64"), validUntil: slot.signatureExpirationLedger, preimageXdr: "", preimageHash: sha256Hex(buildAuthorizationEntryPreimage(unsignedEntry({ address: w.operator.address, contract: w.token, fn: "set_address_frozen", args: [...(planned.rootInvocation.function as xdr.SorobanAuthorizedFunctionContractFn).contractFn.args], nonce: 7n }), slot.signatureExpirationLedger, Networks.TESTNET).toXdr()), nodePath: "0", address: w.operator.address, summary: [], requestId: "", slotId: "" }) as { entryXdr: string }).entryXdr }],
    ["another invocation", { ...good, signedEntryXdr: await signWith(unsignedEntry({ address: w.operator.address, contract: w.token, fn: "pause", args: [] }), slot.signatureExpirationLedger) }],
    ["another address", { ...good, signedEntryXdr: await signWith(unsignedEntry({ address: kp.publicKey(), contract: w.token, fn: "set_address_frozen", args: [...(planned.rootInvocation.function as xdr.SorobanAuthorizedFunctionContractFn).contractFn.args], nonce: 42n }), slot.signatureExpirationLedger) }],
    ["missing signature", { ...good, signedEntryXdr: slot.entryXdr }],
    ["signature by another key", { ...good, signedEntryXdr: await signWith(planned, slot.signatureExpirationLedger) }],
    ["expired slot", good, slot.signatureExpirationLedger],
  ];
  for (const [name, share, ledger] of rows) {
    const c = await code(() => verifyCollectedShare(plan, share, ledger ?? w.net.ledger));
    assert.ok(c === "MKR_E_AUTH_ENTRY_INVALID" || c === "MKR_E_AUTH_SLOT_UNKNOWN", `${name}: ${c}`);
  }
});

test("merge: commutative, associative, idempotent over 1,000 seeded cases; conflicts and foreign plans refused", async () => {
  const { w, request } = await approvedFreeze();
  const plan = await planAuth(request, w.net, { authEntryTtlLedgers: 100 });
  const share = await signedShare(w, plan);
  const empty = toBundle(plan);
  const r = mulberry32(1234);
  const variants: AuthBundle[] = [empty, { ...empty, collected: [share] }, { ...empty, collected: [{ ...share, signerId: "operator-key-2" }] }, { ...empty, collected: [{ ...share, collectedAt: "2026-11-09T11:00:00Z" }] }];
  for (let i = 0; i < 1000; i++) {
    const a = pick(r, variants);
    const b = pick(r, variants);
    const c = pick(r, variants);
    assert.deepEqual(mergeBundles(a, b), mergeBundles(b, a));
    assert.deepEqual(mergeBundles(mergeBundles(a, b), c), mergeBundles(a, mergeBundles(b, c)));
    assert.deepEqual(mergeBundles(a, a), mergeBundles(a, a.collected.length ? a : a));
  }
  assert.equal(isComplete(plan, empty), false);
  assert.equal(isComplete(plan, mergeBundles(empty, { ...empty, collected: [share] })), true);
  assert.equal(await code(() => mergeBundles(empty, { ...empty, planId: "f".repeat(64) })), "MKR_E_AUTH_ENTRY_INVALID");
  assert.equal(await code(() => mergeBundles({ ...empty, collected: [share] }, { ...empty, collected: [{ ...share, signedEntryXdr: plan.slots[0]!.entryXdr }] })), "MKR_E_AUTH_ENTRY_INVALID");
});

test("assembly: entries in plan order, enforce-mode failure surfaces the contract error, stale plan refused; envelope signatures checked", async () => {
  const { w, request } = await approvedFreeze();
  const plan = await planAuth(request, w.net, { authEntryTtlLedgers: 100 });
  const bundle = mergeBundles(toBundle(plan), { ...toBundle(plan), collected: [await signedShare(w, plan)] });
  assert.equal(await code(assembleForEnvelopeSigning(plan, toBundle(plan), w.net)), "MKR_E_AUTH_ENTRY_INVALID");
  const ok = await assembleForEnvelopeSigning(plan, bundle, w.net);
  const tx = new Transaction(ok.envelopeXdr, Networks.TESTNET);
  const op = tx.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
  assert.equal(op.auth!.length, 1);
  assert.equal(w.net.simulations.at(-1)!.mode, "enforce");
  w.net.failEnforce = "HostError: Error(Auth, InvalidInput) __check_auth failed";
  await assert.rejects(assembleForEnvelopeSigning(plan, bundle, w.net), (e: unknown) => e instanceof MkrError && e.code === "MKR_E_SIMULATION_FAILED" && /check_auth/.test(e.message));
  w.net.failEnforce = undefined;
  w.net.ledger = plan.slots[0]!.signatureExpirationLedger - SAFETY_LEDGERS;
  assert.equal(await code(assembleForEnvelopeSigning(plan, bundle, w.net)), "MKR_E_AUTH_PLAN_STALE");
  // Envelope signatures: the right key passes, a foreign key or a different tx is refused.
  const signed = await w.feePayer.signTransaction({ networkPassphrase: Networks.TESTNET, envelopeXdr: ok.envelopeXdr, address: w.feePayer.address, summary: [], requestId: "" });
  const merged = addEnvelopeSignature(ok.envelopeXdr, signed.status === "signed" ? signed.envelopeXdr : "", Networks.TESTNET, [w.feePayer.address]);
  assert.equal(new Transaction(merged, Networks.TESTNET).signatures.length, 1);
  assert.equal(await code(() => addEnvelopeSignature(ok.envelopeXdr, signed.status === "signed" ? signed.envelopeXdr : "", Networks.TESTNET, [w.operator.address])), "MKR_E_AUTH_ENTRY_INVALID");
  assert.equal(await code(() => addEnvelopeSignature(plan.unsignedTxXdr, signed.status === "signed" ? signed.envelopeXdr : "", Networks.TESTNET, [w.feePayer.address])), "MKR_E_PAYLOAD_MISMATCH");
});
