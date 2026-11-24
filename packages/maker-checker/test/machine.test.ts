// SPDX-License-Identifier: Apache-2.0
// MKR-004 / MKR-006: reducer transitions (SPEC 5.3), separation of duties (S1-S4), approval attestations.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Networks } from "@stellar/stellar-sdk";
import { MkrError } from "../src/errors.ts";
import { evaluate } from "../src/policy/evaluate.ts";
import type { PolicyDecision } from "../src/policy/evaluate.ts";
import { policyHash } from "../src/policy/hash.ts";
import { unixToIso } from "../src/policy/parse.ts";
import { requestHash } from "../src/service/requests.ts";
import { approvalMessage, approvalStatement, verifyApproval } from "../src/workflow/approval.ts";
import { applyEvent, legalNextEvents } from "../src/workflow/machine.ts";
import type { TransitionContext } from "../src/workflow/machine.ts";
import type { ActionRequest, Approval, RequestRecord } from "../src/workflow/types.ts";
import { mulberry32, pick, seedFromEnv } from "./helpers/prng.ts";
import { T0, testWorld } from "./helpers/world.ts";

const w = testWorld({ cooldown: 60 });
const H = policyHash(w.policy);
const decision: PolicyDecision = evaluate({ policy: w.policy, policyHash: H, maker: "maker-alice", networkPassphrase: Networks.TESTNET, nodes: [{ depth: 0, contract: w.token, function: "pause", args: [{ type: "address", value: w.operator.address }], authorizer: w.operator.address }], controlKind: "pause", nowUnix: T0, priorSpend: [] });
assert.equal(decision.outcome, "allow");

function makeRequest(nonce = "n-0000000000000001"): ActionRequest {
  const body: Omit<ActionRequest, "id"> = {
    version: 1, policyHash: H, maker: "maker-alice", createdAt: unixToIso(T0), expiresAt: unixToIso(T0 + 86400), kind: "control", controlKind: "pause",
    intent: { networkPassphrase: Networks.TESTNET, source: w.feePayer.address, contract: w.token, function: "pause", args: [{ type: "address", value: w.operator.address }], invocationTreeDigest: "d".repeat(64) },
    summary: { headline: "PAUSE", facts: [], tree: [], warnings: [] }, unsignedTxXdr: "AAAA", nonce,
  };
  return { id: requestHash(body), ...body };
}
const req = makeRequest();
const ctx = (nowUnix = T0, extra: Partial<TransitionContext> = {}): TransitionContext => ({ policy: w.policy, decision, nowUnix, signerPrincipal: (s) => w.registry[s], ...extra });
const hostCtx = (nowUnix = T0) => ctx(nowUnix, { verifyAttestation: () => undefined });
const appr = (approver: string, d: "approve" | "reject" = "approve", r = req): Approval => ({ statement: approvalStatement({ request: r, approver, decision: d, at: unixToIso(T0), nonce: "nonce-000000000001" }), attestation: { scheme: "host-asserted", assertedBy: "test" } });
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof MkrError ? e.code : String(e);
  }
};
const proposed = () => applyEvent(undefined, { type: "proposed", at: unixToIso(T0), request: req }, ctx());
const approvedRecord = () => {
  let r = proposed();
  for (const a of ["checker-bob", "checker-carol", "admin-dana"]) r = applyEvent(r, { type: "approval_recorded", at: unixToIso(T0), approval: appr(a) }, hostCtx());
  return r;
};

test("proposed: allowed decision creates the record; a second proposal or a bad expiry is illegal", () => {
  const r = proposed();
  assert.equal(r.state, "proposed");
  assert.equal(code(() => applyEvent(r, { type: "proposed", at: unixToIso(T0), request: req }, ctx())), "MKR_E_TRANSITION_ILLEGAL");
  assert.equal(code(() => applyEvent(undefined, { type: "proposed", at: unixToIso(T0), request: { ...req, expiresAt: unixToIso(T0 + 5) } }, ctx())), "MKR_E_TRANSITION_ILLEGAL");
  assert.equal(code(() => applyEvent(undefined, { type: "proposed", at: unixToIso(T0), request: req }, ctx(T0, { decision: { ...decision, outcome: "deny" } }))), "MKR_E_POLICY_DENIED");
});

test("approvals: threshold needs both groups; sets thresholdMetAt and signingEligibleAt = + cooldown", () => {
  let r = proposed();
  r = applyEvent(r, { type: "approval_recorded", at: unixToIso(T0), approval: appr("checker-bob") }, hostCtx());
  r = applyEvent(r, { type: "approval_recorded", at: unixToIso(T0), approval: appr("checker-carol") }, hostCtx());
  assert.equal(r.state, "proposed");
  r = applyEvent(r, { type: "approval_recorded", at: unixToIso(T0 + 10), approval: appr("admin-dana") }, hostCtx(T0 + 10));
  assert.equal(r.state, "approved");
  assert.equal(r.thresholdMetAt, unixToIso(T0 + 10));
  assert.equal(r.signingEligibleAt, unixToIso(T0 + 70));
});

test("S1: the maker can never approve or reject, even holding checker", () => {
  // The maker is named in the checkers group here, so S4 would accept her: only S1 can refuse.
  const d1: PolicyDecision = { ...decision, requirement: { ...decision.requirement!, checkersFrom: ["checker-bob", "checker-carol", "maker-alice"] } };
  assert.equal(code(() => applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("maker-alice") }, { ...hostCtx(), decision: d1 })), "MKR_E_SOD_VIOLATION");
  assert.equal(code(() => applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("maker-alice", "reject") }, { ...hostCtx(), decision: d1 })), "MKR_E_SOD_VIOLATION");
  assert.equal(code(() => applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("maker-alice") }, hostCtx())), "MKR_E_SOD_VIOLATION");
  assert.equal(code(() => applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("maker-alice", "reject") }, hostCtx())), "MKR_E_SOD_VIOLATION");
});

test("S2: a principal decides once", () => {
  const r = applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("checker-bob") }, hostCtx());
  assert.equal(code(() => applyEvent(r, { type: "approval_recorded", at: unixToIso(T0), approval: appr("checker-bob") }, hostCtx())), "MKR_E_SOD_VIOLATION");
});

test("S4: approvers outside the pinned requirement do not count", () => {
  const d2: PolicyDecision = { ...decision, requirement: { ...decision.requirement!, checkersFrom: ["checker-bob"] } };
  assert.equal(code(() => applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("checker-carol") }, { ...hostCtx(), decision: d2 })), "MKR_E_SOD_VIOLATION");
});

test("reject terminates; terminal states absorb every event", () => {
  const r = applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("checker-bob", "reject") }, hostCtx());
  assert.equal(r.state, "rejected");
  assert.equal(code(() => applyEvent(r, { type: "cancelled", at: unixToIso(T0), by: "maker-alice" }, ctx())), "MKR_E_TRANSITION_ILLEGAL");
});

test("cancel: maker or admin only, from proposed or approved", () => {
  assert.equal(applyEvent(proposed(), { type: "cancelled", at: unixToIso(T0), by: "maker-alice" }, ctx()).state, "cancelled");
  assert.equal(applyEvent(approvedRecord(), { type: "cancelled", at: unixToIso(T0), by: "admin-dana" }, ctx()).state, "cancelled");
  assert.equal(code(() => applyEvent(proposed(), { type: "cancelled", at: unixToIso(T0), by: "checker-bob" }, ctx())), "MKR_E_SOD_VIOLATION");
});

test("expiry: only at or after expiresAt; approvals after it are refused", () => {
  assert.equal(code(() => applyEvent(proposed(), { type: "expired", at: unixToIso(T0) }, ctx())), "MKR_E_TRANSITION_ILLEGAL");
  assert.equal(applyEvent(proposed(), { type: "expired", at: unixToIso(T0 + 86400) }, ctx(T0 + 86400)).state, "expired");
  assert.equal(code(() => applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: appr("checker-bob") }, hostCtx(T0 + 86400))), "MKR_E_REQUEST_EXPIRED");
});

test("signing: cooldown, S3 (maker and unmapped signers), slot known, all slots before signing_completed", () => {
  const r = approvedRecord();
  const sc = (signerId: string, slotId = "s:0") => ({ type: "signature_collected" as const, at: unixToIso(T0), slotId, signerId });
  assert.equal(code(() => applyEvent(r, sc("operator-key"), ctx(T0 + 59, { slotIds: ["s:0"] }))), "MKR_E_TRANSITION_ILLEGAL");
  assert.equal(code(() => applyEvent(r, sc("alice-device"), ctx(T0 + 60, { slotIds: ["s:0"] }))), "MKR_E_SOD_VIOLATION");
  assert.equal(code(() => applyEvent(r, sc("stranger"), ctx(T0 + 60, { slotIds: ["s:0"] }))), "MKR_E_SOD_VIOLATION");
  assert.equal(code(() => applyEvent(r, sc("operator-key", "s:9"), ctx(T0 + 60, { slotIds: ["s:0"] }))), "MKR_E_AUTH_SLOT_UNKNOWN");
  assert.equal(code(() => applyEvent(r, { type: "signing_completed", at: unixToIso(T0), signedTxXdrHash: "a".repeat(64) }, ctx(T0 + 60, { slotIds: ["s:0"] }))), "MKR_E_TRANSITION_ILLEGAL");
  const r2 = applyEvent(r, sc("operator-key"), ctx(T0 + 60, { slotIds: ["s:0"] }));
  const r3 = applyEvent(r2, { type: "signing_completed", at: unixToIso(T0), signedTxXdrHash: "a".repeat(64) }, ctx(T0 + 60, { slotIds: ["s:0"] }));
  assert.equal(r3.state, "signed");
  assert.equal(code(() => applyEvent(r3, { type: "submitted", at: unixToIso(T0), txHash: "b".repeat(64), signedTxXdrHash: "c".repeat(64) }, ctx(T0 + 61))), "MKR_E_PAYLOAD_MISMATCH");
  assert.equal(applyEvent(r3, { type: "submitted", at: unixToIso(T0), txHash: "b".repeat(64), signedTxXdrHash: "a".repeat(64) }, ctx(T0 + 61)).state, "submitted");
});

test("signing windows are enforced at signature time, not at approval", () => {
  const ww = testWorld({ cooldown: 0, windows: [{ days: ["mon"], startUtc: "08:00", endUtc: "09:00" }] });
  const d = evaluate({ policy: ww.policy, policyHash: policyHash(ww.policy), maker: "maker-alice", networkPassphrase: Networks.TESTNET, nodes: [{ depth: 0, contract: ww.token, function: "pause", args: [{ type: "address", value: ww.operator.address }], authorizer: ww.operator.address }], controlKind: "pause", nowUnix: T0, priorSpend: [] });
  const c2 = (now: number): TransitionContext => ({ policy: ww.policy, decision: d, nowUnix: now, verifyAttestation: () => undefined, signerPrincipal: (s) => ww.registry[s] });
  const r0: RequestRecord = { request: { ...req, policyHash: d.policyHash }, state: "approved", approvals: [], collectedSlotIds: [], version: 4, thresholdMetAt: unixToIso(T0 - 7200), signingEligibleAt: unixToIso(T0 - 7200) };
  assert.equal(code(() => applyEvent(r0, { type: "signature_collected", at: unixToIso(T0), slotId: "s:0", signerId: "operator-key" }, c2(T0))), "MKR_E_TRANSITION_ILLEGAL"); // 10:00 Monday
  assert.equal(applyEvent(r0, { type: "signature_collected", at: unixToIso(T0), slotId: "s:0", signerId: "operator-key" }, c2(T0 - 3600 - 1)).state, "approved"); // 08:59:59
});

test("SEP-53 attestation: StubSigner signature verifies; every tampered field and replay is refused", async () => {
  const s = approvalStatement({ request: req, approver: "checker-bob", decision: "approve", at: unixToIso(T0), nonce: "nonce-000000000001" });
  const sig = await w.p["checker-bob"].signMessage({ message: approvalMessage(s), address: w.p["checker-bob"].address, requestId: req.id });
  assert.equal(sig.status, "signed");
  const b64 = sig.status === "signed" ? sig.signatureBase64 : "";
  const expect = { requestId: req.id, policyHash: H, intentDigest: req.intent.invocationTreeDigest };
  const good: Approval = { statement: s, attestation: { scheme: "stellar-sep53", address: w.p["checker-bob"].address, signatureBase64: b64 } };
  verifyApproval(good, w.policy, expect);
  const fields: [keyof typeof s, unknown][] = [["requestId", "e".repeat(64)], ["policyHash", "e".repeat(64)], ["intentDigest", "e".repeat(64)], ["decision", "reject"], ["approver", "checker-carol"], ["at", unixToIso(T0 + 1)], ["nonce", "nonce-000000000002"]];
  for (const [k, v] of fields) {
    const bad = { ...good, statement: { ...s, [k]: v } } as Approval;
    assert.equal(code(() => verifyApproval(bad, w.policy, expect)), "MKR_E_ATTESTATION_INVALID", k);
  }
  assert.equal(code(() => verifyApproval({ ...good, attestation: { ...good.attestation, address: w.p["checker-carol"].address } as never }, w.policy, expect)), "MKR_E_ATTESTATION_INVALID");
  const other = makeRequest("n-0000000000000002");
  assert.equal(code(() => verifyApproval(good, w.policy, { ...expect, requestId: other.id })), "MKR_E_ATTESTATION_INVALID");
  assert.equal(code(() => verifyApproval({ ...good, attestation: { scheme: "host-asserted", assertedBy: "x" } }, w.policy, expect)), "MKR_E_ATTESTATION_INVALID");
  // The reducer runs the same check by default.
  assert.equal(applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: good }, ctx()).approvals.length, 1);
  assert.equal(code(() => applyEvent(proposed(), { type: "approval_recorded", at: unixToIso(T0), approval: { ...good, statement: { ...s, decision: "reject" } } }, ctx())), "MKR_E_ATTESTATION_INVALID");
});

test("legalNextEvents agrees with applyEvent", () => {
  const r = approvedRecord();
  for (const now of [T0, T0 + 60]) {
    const legal = legalNextEvents(r, ctx(now, { slotIds: [] }));
    assert.ok(legal.includes("cancelled"));
    assert.equal(legal.includes("signature_collected"), now >= T0 + 60);
  }
  assert.deepEqual(legalNextEvents({ ...r, state: "submitted" }, ctx()), []);
});

test("property: S1-S4 and state invariants hold over 10,000 random event sequences", () => {
  const seed = seedFromEnv(424242);
  const rnd = mulberry32(seed);
  const actors = ["maker-alice", "checker-bob", "checker-carol", "admin-dana", "nobody-x"];
  const signers = ["operator-key", "fee-payer-key", "alice-device", "stranger"];
  const req0 = decision.requirement!;
  for (let i = 0; i < 10_000; i++) {
    let r = proposed();
    let now = T0;
    for (let step = 0; step < 12; step++) {
      now += pick(rnd, [0, 1, 30, 61, 3600, 90000]);
      const k = Math.floor(rnd() * 7);
      const ev =
        k <= 2 ? { type: "approval_recorded" as const, at: unixToIso(now), approval: appr(pick(rnd, actors), rnd() < 0.9 ? "approve" : "reject") }
        : k === 3 ? { type: "signature_collected" as const, at: unixToIso(now), slotId: pick(rnd, ["s:0", "s:1"]), signerId: pick(rnd, signers) }
        : k === 4 ? { type: "signing_completed" as const, at: unixToIso(now), signedTxXdrHash: "a".repeat(64) }
        : k === 5 ? { type: "submitted" as const, at: unixToIso(now), txHash: "b".repeat(64) }
        : rnd() < 0.5 ? { type: "cancelled" as const, at: unixToIso(now), by: pick(rnd, actors) } : { type: "expired" as const, at: unixToIso(now) };
      const prev = r;
      try {
        r = applyEvent(r, ev, ctx(now, { verifyAttestation: () => undefined, slotIds: ["s:0"] }));
      } catch (e) {
        if (!(e instanceof MkrError)) throw e;
        continue;
      }
      const msg = `seed ${seed} sequence ${i} step ${step}`;
      assert.ok(!r.approvals.some((a) => a.statement.approver === "maker-alice"), `S1 ${msg}`);
      const ids = r.approvals.map((a) => a.statement.approver);
      assert.equal(new Set(ids).size, ids.length, `S2 ${msg}`);
      assert.ok(ids.every((a) => req0.checkersFrom.includes(a) || req0.adminsFrom.includes(a)), `S4 ${msg}`);
      if (["submitted", "rejected", "expired", "cancelled"].includes(prev.state)) assert.fail(`terminal state changed ${msg}`);
      if (r.state === "approved" || r.state === "signed" || r.state === "submitted") {
        const ok = r.approvals.filter((a) => a.statement.decision === "approve");
        assert.ok(ok.filter((a) => req0.checkersFrom.includes(a.statement.approver)).length >= req0.checkersMin, `checkers ${msg}`);
        assert.ok(ok.filter((a) => req0.adminsFrom.includes(a.statement.approver)).length >= req0.adminsMin, `admins ${msg}`);
      }
      if (r.state === "signed" && prev.state !== "signed") assert.ok(now >= Date.parse(r.signingEligibleAt!) / 1000, `cooldown ${msg}`);
      if (ev.type === "signature_collected" && r !== prev) assert.notEqual(w.registry[ev.signerId] ?? "maker-alice", "maker-alice", `S3 ${msg}`);
    }
  }
});
