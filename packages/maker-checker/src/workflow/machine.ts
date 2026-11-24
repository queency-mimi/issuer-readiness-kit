// SPDX-License-Identifier: Apache-2.0
// Approval workflow reducer (SPEC 5.3, 5.5). Pure: no clock, no network; time comes in ctx.nowUnix.
import { MkrError } from "../errors.ts";
import type { MkrErrorCode } from "../errors.ts";
import { insideWindows } from "../policy/evaluate.ts";
import type { MergedRequirement, PolicyDecision } from "../policy/evaluate.ts";
import { isoToUnix, unixToIso } from "../policy/parse.ts";
import type { PolicyDoc, PrincipalId } from "../policy/types.ts";
import { verifyApproval } from "./approval.ts";
import { TERMINAL_STATES } from "./types.ts";
import type { Approval, RequestEvent, RequestRecord } from "./types.ts";

export interface TransitionContext {
  policy: PolicyDoc;
  /** The decision recorded at proposal time (SPEC 5.6: requirement is pinned, not re-derived). */
  decision: PolicyDecision;
  nowUnix: number;
  /** Attestation check; defaults to verifyApproval (SEP-53 / host-asserted). Injected for tests. */
  verifyAttestation?: (approval: Approval, policy: PolicyDoc, expect: { requestId: string; policyHash: string; intentDigest: string }) => void;
  /** Signer registry for S3: signer id -> principal id (undefined = unmapped). */
  signerPrincipal?: (signerId: string) => PrincipalId | undefined;
  /** Slot ids of the current auth plan; signing_completed requires all of them collected. */
  slotIds?: string[];
}

const err = (code: MkrErrorCode, msg: string, details: Record<string, unknown> = {}): never => {
  throw new MkrError(code, msg, details);
};

function requirementOf(ctx: TransitionContext): MergedRequirement {
  if (ctx.decision.outcome !== "allow" || !ctx.decision.requirement) return err("MKR_E_POLICY_DENIED", "the pinned decision is not allow");
  return ctx.decision.requirement;
}

export function groupCounts(record: RequestRecord, req: MergedRequirement): { checkers: number; admins: number } {
  let checkers = 0;
  let admins = 0;
  for (const a of record.approvals) {
    if (a.statement.decision !== "approve") continue;
    if (req.checkersFrom.includes(a.statement.approver)) checkers++;
    else if (req.adminsFrom.includes(a.statement.approver)) admins++;
  }
  return { checkers, admins };
}

function expiresAtUnix(record: RequestRecord): number {
  return isoToUnix(record.request.expiresAt) ?? err("MKR_E_TRANSITION_ILLEGAL", "request has an invalid expiresAt");
}

function signingGuards(record: RequestRecord, ctx: TransitionContext, req: MergedRequirement): void {
  const eligible = record.signingEligibleAt ? isoToUnix(record.signingEligibleAt) : undefined;
  if (eligible === undefined || ctx.nowUnix < eligible) err("MKR_E_TRANSITION_ILLEGAL", `cooldown: signing is allowed from ${record.signingEligibleAt}`, { signingEligibleAt: record.signingEligibleAt });
  if (!insideWindows(req.windows, ctx.nowUnix)) err("MKR_E_TRANSITION_ILLEGAL", "outside the policy's signing windows (UTC)");
}

/**
 * Pure reducer. Returns the next record or throws MkrError:
 *  MKR_E_TRANSITION_ILLEGAL, MKR_E_SOD_VIOLATION, MKR_E_ATTESTATION_INVALID, MKR_E_REQUEST_EXPIRED, MKR_E_POLICY_DENIED.
 */
export function applyEvent(record: RequestRecord | undefined, event: RequestEvent, ctx: TransitionContext): RequestRecord {
  if (event.type === "proposed") {
    if (record) err("MKR_E_TRANSITION_ILLEGAL", "request already exists");
    const req = requirementOf(ctx);
    void req;
    const r = event.request;
    if (r.policyHash !== ctx.decision.policyHash) err("MKR_E_TRANSITION_ILLEGAL", "request policyHash differs from the decision");
    const maker = ctx.policy.principals.find((p) => p.id === r.maker);
    if (!maker || !maker.roles.includes("maker")) err("MKR_E_SOD_VIOLATION", "proposer does not hold the maker role");
    const created = isoToUnix(r.createdAt);
    if (created === undefined || r.expiresAt !== unixToIso(created + ctx.policy.requestTtlSeconds)) err("MKR_E_TRANSITION_ILLEGAL", "expiresAt must equal createdAt + requestTtlSeconds");
    return { request: r, state: "proposed", approvals: [], collectedSlotIds: [], version: 1 };
  }
  if (!record) return err("MKR_E_TRANSITION_ILLEGAL", `${event.type} before proposed`);
  if (TERMINAL_STATES.includes(record.state)) return err("MKR_E_TRANSITION_ILLEGAL", `request is ${record.state} (terminal)`);
  const next = (patch: Partial<RequestRecord>): RequestRecord => ({ ...record, ...patch, version: record.version + 1 });
  const expired = ctx.nowUnix >= expiresAtUnix(record);
  const maker = record.request.maker;

  switch (event.type) {
    case "expired":
      if (!expired) err("MKR_E_TRANSITION_ILLEGAL", "request has not reached expiresAt");
      return next({ state: "expired" });

    case "cancelled": {
      if (record.state !== "proposed" && record.state !== "approved") err("MKR_E_TRANSITION_ILLEGAL", `cannot cancel in state ${record.state}`);
      const by = ctx.policy.principals.find((p) => p.id === event.by);
      if (event.by !== maker && !by?.roles.includes("admin")) err("MKR_E_SOD_VIOLATION", "only the maker or an admin may cancel");
      return next({ state: "cancelled" });
    }

    case "approval_recorded": {
      if (record.state !== "proposed") err("MKR_E_TRANSITION_ILLEGAL", `approvals are only recorded while proposed (state ${record.state})`);
      if (expired) err("MKR_E_REQUEST_EXPIRED", "request expired");
      const req = requirementOf(ctx);
      const s = event.approval.statement;
      // S1: the maker never approves or rejects their own request, under any role or attestation.
      if (s.approver === maker) err("MKR_E_SOD_VIOLATION", "S1: the maker cannot approve or reject their own request", { approver: s.approver });
      // S2: one decision per principal per request.
      if (record.approvals.some((a) => a.statement.approver === s.approver)) err("MKR_E_SOD_VIOLATION", "S2: this principal already decided on this request", { approver: s.approver });
      // S4: only principals named in the pinned requirement count.
      const inCheckers = req.checkersFrom.includes(s.approver);
      const inAdmins = req.adminsFrom.includes(s.approver);
      if (!inCheckers && !inAdmins) err("MKR_E_SOD_VIOLATION", "S4: approver is not named in the pinned requirement", { approver: s.approver });
      (ctx.verifyAttestation ?? verifyApproval)(event.approval, ctx.policy, {
        requestId: record.request.id,
        policyHash: record.request.policyHash,
        intentDigest: record.request.intent.invocationTreeDigest,
      });
      const approvals = [...record.approvals, event.approval];
      if (s.decision === "reject") return next({ approvals, state: "rejected" });
      const before = groupCounts(record, req);
      if (inCheckers && before.checkers >= req.checkersMin) err("MKR_E_TRANSITION_ILLEGAL", "checker group already satisfied");
      if (inAdmins && before.admins >= req.adminsMin) err("MKR_E_TRANSITION_ILLEGAL", "admin group already satisfied");
      const after = groupCounts({ ...record, approvals }, req);
      if (after.checkers >= req.checkersMin && after.admins >= req.adminsMin) {
        const at = isoToUnix(event.at) ?? err("MKR_E_TRANSITION_ILLEGAL", "bad event time");
        return next({ approvals, state: "approved", thresholdMetAt: event.at, signingEligibleAt: unixToIso(at + req.cooldownSeconds) });
      }
      return next({ approvals });
    }

    case "signature_collected": {
      if (record.state !== "approved") err("MKR_E_TRANSITION_ILLEGAL", `signatures are collected only when approved (state ${record.state})`);
      if (expired) err("MKR_E_REQUEST_EXPIRED", "request expired");
      signingGuards(record, ctx, requirementOf(ctx));
      if (ctx.slotIds && !ctx.slotIds.includes(event.slotId)) err("MKR_E_AUTH_SLOT_UNKNOWN", `unknown slot ${event.slotId}`);
      if (ctx.policy.separation.makerCannotSign) {
        const who = ctx.signerPrincipal?.(event.signerId);
        if (who === undefined) err("MKR_E_SOD_VIOLATION", "S3: signer is not mapped to a principal (required when makerCannotSign)", { signerId: event.signerId });
        if (who === maker) err("MKR_E_SOD_VIOLATION", "S3: the maker may not contribute a signature", { signerId: event.signerId });
      }
      const ids = record.collectedSlotIds.includes(event.slotId) ? record.collectedSlotIds : [...record.collectedSlotIds, event.slotId].sort();
      return next({ collectedSlotIds: ids });
    }

    case "signing_completed": {
      if (record.state !== "approved") err("MKR_E_TRANSITION_ILLEGAL", `signing completes only from approved (state ${record.state})`);
      if (expired) err("MKR_E_REQUEST_EXPIRED", "request expired");
      signingGuards(record, ctx, requirementOf(ctx));
      const missing = (ctx.slotIds ?? []).filter((id) => !record.collectedSlotIds.includes(id));
      if (missing.length) err("MKR_E_TRANSITION_ILLEGAL", `slots not collected: ${missing.join(", ")}`);
      return next({ state: "signed", signedTxXdrHash: event.signedTxXdrHash });
    }

    case "submitted": {
      if (record.state !== "signed") err("MKR_E_TRANSITION_ILLEGAL", `submit only from signed (state ${record.state})`);
      if (expired) err("MKR_E_REQUEST_EXPIRED", "request expired");
      if (!insideWindows(requirementOf(ctx).windows, ctx.nowUnix)) err("MKR_E_TRANSITION_ILLEGAL", "outside the policy's signing windows (UTC)");
      if (event.signedTxXdrHash !== undefined && event.signedTxXdrHash !== record.signedTxXdrHash) err("MKR_E_PAYLOAD_MISMATCH", "submitted envelope differs from the signed one");
      return next({ state: "submitted", txHash: event.txHash });
    }
  }
  return err("MKR_E_TRANSITION_ILLEGAL", "unknown event");
}

/** Events that would be legal now, for UI/CLI hints (approval_recorded listed when any approver could still act). */
export function legalNextEvents(record: RequestRecord, ctx: TransitionContext): RequestEvent["type"][] {
  if (TERMINAL_STATES.includes(record.state)) return [];
  const out: RequestEvent["type"][] = [];
  const expired = ctx.nowUnix >= expiresAtUnix(record);
  if (expired) out.push("expired");
  if (record.state === "proposed" || record.state === "approved") out.push("cancelled");
  if (expired || ctx.decision.outcome !== "allow" || !ctx.decision.requirement) return out;
  const req = ctx.decision.requirement;
  const eligible = record.signingEligibleAt ? isoToUnix(record.signingEligibleAt) : undefined;
  const canSign = eligible !== undefined && ctx.nowUnix >= eligible && insideWindows(req.windows, ctx.nowUnix);
  if (record.state === "proposed") out.push("approval_recorded");
  if (record.state === "approved" && canSign) {
    out.push("signature_collected");
    if ((ctx.slotIds ?? []).every((id) => record.collectedSlotIds.includes(id))) out.push("signing_completed");
  }
  if (record.state === "signed" && insideWindows(req.windows, ctx.nowUnix)) out.push("submitted");
  return out.sort();
}

export { verifyApproval };
