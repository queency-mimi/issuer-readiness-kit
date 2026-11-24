// SPDX-License-Identifier: Apache-2.0
// Approval statements and attestation checks (SPEC 5.4). Crypto via @stellar/stellar-sdk (SEP-53 verifyMessage).
import { Keypair } from "@stellar/stellar-sdk";
import { canonicalBytes, canonicalize } from "../canonical.ts";
import { MkrError } from "../errors.ts";
import { DOMAIN, taggedHash } from "../hash.ts";
import type { Hex32 } from "../hash.ts";
import type { PolicyDoc, PrincipalId } from "../policy/types.ts";
import type { ActionRequest, Approval, ApprovalStatement } from "./types.ts";

export function approvalStatement(args: { request: ActionRequest; approver: PrincipalId; decision: "approve" | "reject"; at: string; nonce: string }): ApprovalStatement {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(args.nonce)) throw new MkrError("MKR_E_USAGE", "approval nonce must be 16-64 chars [A-Za-z0-9_-]");
  return {
    v: 1,
    kind: "mkr-approval",
    requestId: args.request.id,
    policyHash: args.request.policyHash,
    intentDigest: args.request.intent.invocationTreeDigest,
    decision: args.decision,
    approver: args.approver,
    at: args.at,
    nonce: args.nonce,
  };
}

/** The exact UTF-8 string a wallet signs with SEP-53: JCS(statement). */
export function approvalMessage(statement: ApprovalStatement): string {
  return canonicalize(statement);
}

export function approvalDigest(statement: ApprovalStatement): Hex32 {
  return taggedHash(DOMAIN.approval, canonicalBytes(statement));
}

export function base64ToBytes(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new MkrError("MKR_E_ATTESTATION_INVALID", "signature is not base64");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/**
 * Verify one approval against what the record expects and the policy's principal (SPEC 5.4, S5).
 * Throws MKR_E_ATTESTATION_INVALID. Separation-of-duties checks live in the reducer.
 */
export function verifyApproval(approval: Approval, policy: PolicyDoc, expect: { requestId: Hex32; policyHash: Hex32; intentDigest: Hex32 }): void {
  const s = approval.statement;
  const bad = (m: string): never => {
    throw new MkrError("MKR_E_ATTESTATION_INVALID", m, { approver: s.approver });
  };
  if (s.v !== 1 || s.kind !== "mkr-approval") bad("unknown statement version or kind");
  if (s.requestId !== expect.requestId) bad("statement is for another request");
  if (s.policyHash !== expect.policyHash) bad("statement is for another policy version");
  if (s.intentDigest !== expect.intentDigest) bad("statement approves a different invocation tree");
  if (s.decision !== "approve" && s.decision !== "reject") bad("unknown decision");
  const p = policy.principals.find((x) => x.id === s.approver);
  if (!p) bad(`approver ${s.approver} is not a principal of the pinned policy`);
  const a = approval.attestation;
  if (a.scheme === "stellar-sep53") {
    if (!p!.attestation.includes("stellar-sep53")) bad("principal does not allow stellar-sep53");
    if (!p!.address || a.address !== p!.address) bad("attestation address differs from the principal's declared address (S5)");
    let ok = false;
    try {
      ok = Keypair.fromPublicKey(a.address).verifyMessage(approvalMessage(s), base64ToBytes(a.signatureBase64));
    } catch {
      ok = false;
    }
    if (!ok) bad("SEP-53 signature does not verify over the statement");
  } else if (a.scheme === "host-asserted") {
    if (!p!.attestation.includes("host-asserted")) bad("principal does not allow host-asserted attestation");
    if (typeof a.assertedBy !== "string" || a.assertedBy.length === 0) bad("host-asserted attestation needs assertedBy");
  } else bad("unknown attestation scheme");
}
