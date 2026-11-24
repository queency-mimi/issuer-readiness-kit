// SPDX-License-Identifier: Apache-2.0
// Offline test world: four principals with runtime StubSigner keys, a policy shaped like the testnet demo.
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { AuditLog, MemoryAuditStore } from "../../src/audit/log.ts";
import { unixToIso } from "../../src/policy/parse.ts";
import type { PolicyDoc } from "../../src/policy/types.ts";
import { RequestService } from "../../src/service/requests.ts";
import type { SubmitResult } from "../../src/service/submit.ts";
import { StubSigner } from "../../src/signer/stub.ts";
import { fakeNet } from "./fake-net.ts";

export const T0 = Date.UTC(2026, 10, 9, 10, 0, 0) / 1000; // a Monday, 10:00 UTC
export const contractId = (seed: number) => StrKey.encodeContract(Buffer.alloc(32, seed));

export function testWorld(opts: { cooldown?: number; windows?: PolicyDoc["rules"][number]["windows"] } = {}) {
  const clock = { now: T0 };
  const p = { "admin-dana": new StubSigner("dana"), "checker-bob": new StubSigner("bob"), "checker-carol": new StubSigner("carol"), "maker-alice": new StubSigner("alice") };
  const operator = new StubSigner("operator-key");
  const feePayer = new StubSigner("fee-payer-key");
  const token = contractId(7);
  const xlm = contractId(9);
  const recipient = Keypair.random().publicKey();
  const holder = Keypair.random().publicKey();
  const policy: PolicyDoc = {
    version: 1, id: "test-policy", name: "test", network: { name: "testnet", passphrase: Networks.TESTNET },
    validity: { notBefore: unixToIso(T0 - 3600), expiresAt: unixToIso(T0 + 30 * 86400) },
    principals: (["admin-dana", "checker-bob", "checker-carol", "maker-alice"] as const).map((id) => ({ id, label: id, roles: [id.split("-")[0] as "admin" | "checker" | "maker"], address: p[id].address, attestation: ["stellar-sep53" as const] })),
    separation: { makerCannotSign: true }, requestTtlSeconds: 86400, authEntryTtlLedgers: 100,
    rules: [
      { id: "allow-rwa-control", effect: "allow", match: { targets: [{ contract: token, functions: [{ name: "forced_transfer", amountArg: 2, recipientArg: 1 }, { name: "pause" }, { name: "set_address_frozen" }, { name: "unpause" }] }], controlKinds: ["forced_transfer", "freeze", "pause", "unfreeze", "unpause"] }, makers: ["maker-alice"], approval: { checkers: { min: 2, from: ["checker-bob", "checker-carol"] }, admins: { min: 1, from: ["admin-dana"] } }, cooldownSeconds: opts.cooldown ?? 60, ...(opts.windows ? { windows: opts.windows } : {}) },
      { id: "allow-xlm", effect: "allow", match: { targets: [{ contract: xlm, functions: [{ name: "transfer", amountArg: 2, recipientArg: 1, recipients: [recipient] }] }] }, makers: ["maker-alice"], approval: { checkers: { min: 1, from: ["checker-bob", "checker-carol"] } }, limits: { perRequest: [{ contract: xlm, max: "1000" }], rolling: [{ contract: xlm, windowSeconds: 86400, max: "1500" }] } },
      { id: "deny-mint", effect: "deny", match: { targets: [{ contract: token, functions: [{ name: "mint" }] }] } },
    ],
  };
  const registry: Record<string, string> = { "operator-key": "admin-dana", "fee-payer-key": "checker-carol", "alice-device": "maker-alice" };
  const net = fakeNet({ passphrase: Networks.TESTNET, now: () => clock.now });
  const submitted: string[] = [];
  const submitter = { async submit(x: string): Promise<SubmitResult> { submitted.push(x); return { txHash: "ab".repeat(32), status: "SUCCESS", ledger: net.ledger + 1 }; } };
  const audit = new AuditLog(new MemoryAuditStore());
  const svc = new RequestService({ audit, auth: net, submitter, clock: () => clock.now, signerPrincipal: (s) => registry[s], nonce: (() => { let i = 0; return () => `nonce-${String(++i).padStart(12, "0")}`; })() });
  return { clock, p, operator, feePayer, token, xlm, recipient, holder, policy, registry, net, svc, audit, submitted };
}

export async function approve(w: ReturnType<typeof testWorld>, rid: string, who: keyof ReturnType<typeof testWorld>["p"], decision: "approve" | "reject" = "approve") {
  const s = w.svc.approvalStatementFor(rid, who, decision);
  const sig = await w.p[who].signMessage({ message: s.message, address: w.p[who].address, requestId: rid });
  if (sig.status !== "signed") throw new Error("not signed");
  return w.svc.recordApproval(rid, { approver: who, decision, at: s.statement.at, nonce: s.statement.nonce, attestation: { scheme: "stellar-sep53", address: w.p[who].address, signatureBase64: sig.signatureBase64 } });
}
