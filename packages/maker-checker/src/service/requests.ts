// SPDX-License-Identifier: Apache-2.0
// RequestService: orchestration over the pure cores (SPEC 1, 5, 7, 8). The audit log is the source of truth;
// every record here is a projection that `rebuild()` re-derives from the log alone (ARCHITECTURE D1).
import { Keypair, Transaction } from "@stellar/stellar-sdk";
import { assembleForEnvelopeSigning, addEnvelopeSignature } from "../auth/assemble.ts";
import { isComplete, mergeBundles, toBundle, verifyCollectedShare } from "../auth/bundle.ts";
import { planAuth, simulateIntent } from "../auth/plan.ts";
import type { AuthDeps } from "../auth/plan.ts";
import { renderTree, flattenTree } from "../auth/tree.ts";
import type { AuthBundle, AuthPlan, CollectedShare } from "../auth/types.ts";
import type { AuditLog } from "../audit/log.ts";
import type { AuditEntry } from "../audit/types.ts";
import { canonicalTaggedHash } from "../canonical.ts";
import { buildControlAction } from "../control/sep57.ts";
import type { ControlActionParams } from "../control/sep57.ts";
import { MkrError } from "../errors.ts";
import { DOMAIN, sha256Hex, bytesToHex } from "../hash.ts";
import type { Hex32 } from "../hash.ts";
import { evaluate } from "../policy/evaluate.ts";
import type { PolicyDecision } from "../policy/evaluate.ts";
import { policyHash as hashPolicy } from "../policy/hash.ts";
import { isoToUnix, parsePolicyDoc, unixToIso, validatePolicyDoc } from "../policy/parse.ts";
import type { ControlKind, PolicyDoc, PrincipalId } from "../policy/types.ts";
import { approvalStatement, approvalMessage, approvalDigest, base64ToBytes } from "../workflow/approval.ts";
import { applyEvent, legalNextEvents } from "../workflow/machine.ts";
import type { TransitionContext } from "../workflow/machine.ts";
import { TERMINAL_STATES } from "../workflow/types.ts";
import type { ActionRequest, Approval, Attestation, ClearSigningSummary, RequestEvent, RequestRecord, ScValJson } from "../workflow/types.ts";
import type { SubmitResult, Submitter } from "./submit.ts";

export interface ServiceDeps {
  audit: AuditLog;
  /** Network access for simulation; required for propose/plan/assemble. */
  auth?: AuthDeps;
  submitter?: Submitter;
  /** UTC seconds. Injected so tests control time. */
  clock(): number;
  /** Signer registry (S3): signer id -> principal id. */
  signerPrincipal(signerId: string): PrincipalId | undefined;
  /** G-VALUE: mainnet submission refused unless true. Agents never set it. */
  allowMainnetSubmit?: boolean;
  /** Random request/approval nonces; injected for deterministic tests. */
  nonce?(): string;
}

export interface PolicyEntry {
  doc: PolicyDoc;
  policyHash: Hex32;
  registeredAt: string;
  registeredBy: PrincipalId;
  supersededBy?: Hex32;
}

export interface RequestState {
  record: RequestRecord;
  decision: PolicyDecision;
  plan?: AuthPlan;
  bundle?: AuthBundle;
  envelope?: { envelopeXdr: string; envelopeHash: string; signedEnvelopeXdr?: string };
  submit?: SubmitResult;
}

export interface ProposeInput {
  policyHash: Hex32;
  maker: PrincipalId;
  intent: { source: string; contract: string; function: string; args: ScValJson[] };
  controlKind?: ControlKind;
  /** Business reason: hashed into reasonHash, plaintext never logged (SPEC 8.4). */
  reason?: string;
  nonce?: string;
  /** Pre-rendered summary from a builder (control actions). */
  summary?: ClearSigningSummary;
}

const randomNonce = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return bytesToHex(b);
};

export function requestHash(r: Omit<ActionRequest, "id">): Hex32 {
  return canonicalTaggedHash(DOMAIN.request, r);
}

/** Serialise mutations so audit appends never interleave inside one process. */
class Mutex {
  #p: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.#p.then(fn, fn);
    this.#p = r.catch(() => undefined);
    return r;
  }
}

export class RequestService {
  readonly deps: ServiceDeps;
  readonly policies = new Map<Hex32, PolicyEntry>();
  readonly requests = new Map<Hex32, RequestState>();
  #mutex = new Mutex();

  constructor(deps: ServiceDeps) {
    this.deps = deps;
  }

  #nonce(): string {
    return this.deps.nonce ? this.deps.nonce() : randomNonce();
  }
  #now(): number {
    return this.deps.clock();
  }
  #authDeps(): AuthDeps {
    if (!this.deps.auth) throw new MkrError("MKR_E_USAGE", "no RPC configured: this service runs offline");
    return this.deps.auth;
  }

  getPolicy(hash: Hex32): PolicyEntry {
    const p = this.policies.get(hash);
    if (!p) throw new MkrError("MKR_E_POLICY_UNKNOWN", `policy ${hash} is not registered`);
    return p;
  }

  get(requestId: Hex32): RequestState {
    const r = this.requests.get(requestId);
    if (!r) throw new MkrError("MKR_E_USAGE", `unknown request ${requestId}`, { notFound: true });
    return r;
  }

  #ctx(st: RequestState, nowUnix: number): TransitionContext {
    const p = this.getPolicy(st.record.request.policyHash);
    return { policy: p.doc, decision: st.decision, nowUnix, signerPrincipal: this.deps.signerPrincipal, ...(st.plan ? { slotIds: st.plan.slots.map((s) => s.slotId) } : {}) };
  }

  legalNext(requestId: Hex32): RequestEvent["type"][] {
    const st = this.get(requestId);
    return legalNextEvents(st.record, this.#ctx(st, this.#now()));
  }

  // ---------------------------------------------------------------- policies (MKR-026)

  registerPolicy(doc: PolicyDoc | string, registeredBy: PrincipalId): Promise<PolicyEntry> {
    return this.#mutex.run(async () => {
      let d: PolicyDoc;
      if (typeof doc === "string") {
        const r = parsePolicyDoc(doc);
        if ("violations" in r) throw new MkrError("MKR_E_POLICY_INVALID", `${r.violations.length} violation(s)`, { violations: r.violations });
        d = r.doc;
      } else {
        const v = validatePolicyDoc(doc);
        if (v.length) throw new MkrError("MKR_E_POLICY_INVALID", `${v.length} violation(s)`, { violations: v });
        d = doc;
      }
      const h = hashPolicy(d);
      const existing = this.policies.get(h);
      if (existing) return existing; // idempotent
      if (d.supersedes !== undefined && !this.policies.has(d.supersedes)) {
        throw new MkrError("MKR_E_POLICY_INVALID", "supersedes an unregistered policy", { violations: [{ path: "/supersedes", code: "PD_SUPERSEDES_UNKNOWN", message: "not registered" }] });
      }
      // Registration needs the admin role: in the new document, and in the one it supersedes.
      const isAdmin = (p: PolicyDoc) => p.principals.some((x) => x.id === registeredBy && x.roles.includes("admin"));
      if (!isAdmin(d) || (d.supersedes !== undefined && !isAdmin(this.getPolicy(d.supersedes).doc))) {
        throw new MkrError("MKR_E_SOD_VIOLATION", `${registeredBy} does not hold admin`);
      }
      const e = await this.deps.audit.append({ type: "policy.registered", actor: registeredBy, policyHash: h, data: { policyHash: h, ...(d.supersedes ? { supersedes: d.supersedes } : {}), registeredBy, doc: d as unknown as Record<string, unknown> } }, this.#now());
      return this.#applyEntry(e) as PolicyEntry;
    });
  }

  listPolicies(): PolicyEntry[] {
    return [...this.policies.values()].sort((a, b) => (a.registeredAt < b.registeredAt ? -1 : 1));
  }

  // ---------------------------------------------------------------- evaluation and proposal (MKR-009)

  /** Rolling spend from the projection (SPEC 4.5): approved-or-later requests of the same policy family. */
  priorSpend(policy: PolicyDoc, nowUnix: number): { contract: string; windowSeconds: number; total: string }[] {
    const out: { contract: string; windowSeconds: number; total: string }[] = [];
    const limits = policy.rules.flatMap((r) => r.limits?.rolling ?? []);
    for (const l of limits) {
      if (out.some((o) => o.contract === l.contract && o.windowSeconds === l.windowSeconds)) continue;
      let total = 0n;
      for (const st of this.requests.values()) {
        const p = this.policies.get(st.record.request.policyHash);
        if (!p || p.doc.id !== policy.id) continue;
        if (!["approved", "signed", "submitted"].includes(st.record.state) || !st.record.thresholdMetAt) continue;
        const t = isoToUnix(st.record.thresholdMetAt)!;
        if (t <= nowUnix - l.windowSeconds || t > nowUnix) continue;
        const a = st.decision.amounts?.find((x) => x.contract === l.contract);
        if (a) total += BigInt(a.total);
      }
      out.push({ contract: l.contract, windowSeconds: l.windowSeconds, total: total.toString() });
    }
    return out;
  }

  /** Dry run: simulate the call and evaluate it, without recording anything. */
  async evaluateIntent(input: Omit<ProposeInput, "nonce" | "reason" | "summary">): Promise<{ decision: PolicyDecision; treeDigest: Hex32; tree: string[] }> {
    const p = this.getPolicy(input.policyHash);
    const sim = await simulateIntent({ ...input.intent, networkPassphrase: p.doc.network.passphrase }, this.#authDeps());
    const now = this.#now();
    const decision = evaluate({
      policy: p.doc, policyHash: p.policyHash, maker: input.maker, networkPassphrase: this.#authDeps().networkPassphrase,
      nodes: flattenTree(sim.tree, input.intent.source), ...(input.controlKind ? { controlKind: input.controlKind } : {}), nowUnix: now, priorSpend: this.priorSpend(p.doc, now),
    });
    return { decision, treeDigest: sim.digest, tree: renderTree(sim.tree) };
  }

  /** Build a SEP-57 control action and propose it in one step (records control.built first). */
  async proposeControl(input: { policyHash: Hex32; maker: PrincipalId; source: string; params: ControlActionParams; reason?: string; nonce?: string }): Promise<RequestState> {
    const built = buildControlAction(input.params);
    await this.#mutex.run(() => this.deps.audit.append({ type: "control.built", actor: input.maker, policyHash: input.policyHash, data: { controlKind: built.controlKind, contract: built.intent.contract, function: built.function } }, this.#now()));
    return this.propose({
      policyHash: input.policyHash, maker: input.maker, controlKind: built.controlKind, summary: built.summary,
      intent: { source: input.source, ...built.intent },
      ...(input.reason !== undefined ? { reason: input.reason } : {}), ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
    });
  }

  propose(input: ProposeInput): Promise<RequestState> {
    return this.#mutex.run(async () => {
      const p = this.getPolicy(input.policyHash);
      if (p.supersededBy) throw new MkrError("MKR_E_POLICY_DENIED", `policy superseded by ${p.supersededBy}; propose under the new version`);
      const deps = this.#authDeps();
      // Deny rules first, on the root call alone (SPEC 4.2 step 4 applied before simulation): a call the policy
      // forbids is refused without asking the network, and even when it would fail simulation.
      const pre = evaluate({
        policy: p.doc, policyHash: p.policyHash, maker: input.maker, networkPassphrase: deps.networkPassphrase,
        nodes: [{ depth: 0, contract: input.intent.contract, function: input.intent.function, args: input.intent.args, authorizer: input.intent.source }],
        ...(input.controlKind ? { controlKind: input.controlKind } : {}), nowUnix: this.#now(), priorSpend: [],
      });
      if (pre.outcome === "deny" && pre.reasons.some((r) => ["DENY_RULE_MATCHED", "POLICY_EXPIRED", "POLICY_NOT_YET_VALID", "NETWORK_MISMATCH", "MAKER_UNKNOWN", "MAKER_NOT_MAKER_ROLE"].includes(r))) {
        await this.deps.audit.append({ type: "request.policy_denied", actor: input.maker, policyHash: p.policyHash, data: { reasons: pre.reasons, matchedRuleIds: pre.matchedRuleIds, headline: input.summary?.headline ?? `CALL ${input.intent.function} on ${input.intent.contract}`, function: input.intent.function, contract: input.intent.contract, stage: "pre-simulation" } }, this.#now());
        throw new MkrError("MKR_E_POLICY_DENIED", `denied: ${pre.reasons.join(", ")}`, { decision: pre });
      }
      const sim = await simulateIntent({ ...input.intent, networkPassphrase: p.doc.network.passphrase }, deps);
      const now = this.#now();
      const decision = evaluate({
        policy: p.doc, policyHash: p.policyHash, maker: input.maker, networkPassphrase: deps.networkPassphrase,
        nodes: flattenTree(sim.tree, input.intent.source), ...(input.controlKind ? { controlKind: input.controlKind } : {}), nowUnix: now, priorSpend: this.priorSpend(p.doc, now),
      });
      const tree = renderTree(sim.tree);
      const summary: ClearSigningSummary = input.summary
        ? { ...input.summary, tree }
        : { headline: `CALL ${input.intent.function} on ${input.intent.contract}`, facts: [["contract", input.intent.contract], ["function", input.intent.function], ["source", input.intent.source]], tree, warnings: [] };
      const createdAt = unixToIso(now);
      const body: Omit<ActionRequest, "id"> = {
        version: 1,
        policyHash: p.policyHash,
        maker: input.maker,
        createdAt,
        expiresAt: unixToIso(now + p.doc.requestTtlSeconds),
        kind: input.controlKind ? "control" : "invoke",
        ...(input.controlKind ? { controlKind: input.controlKind } : {}),
        intent: { networkPassphrase: p.doc.network.passphrase, source: input.intent.source, contract: input.intent.contract, function: input.intent.function, args: input.intent.args, invocationTreeDigest: sim.digest },
        summary,
        unsignedTxXdr: sim.tx.toXDR(),
        ...(input.reason !== undefined ? { reasonHash: sha256Hex(input.reason) } : {}),
        nonce: input.nonce ?? this.#nonce(),
      };
      const request: ActionRequest = { id: requestHash(body), ...body };
      if (decision.outcome === "deny") {
        await this.deps.audit.append({ type: "request.policy_denied", actor: input.maker, requestId: request.id, policyHash: p.policyHash, data: { reasons: decision.reasons, matchedRuleIds: decision.matchedRuleIds, headline: summary.headline, function: input.intent.function, contract: input.intent.contract } }, now);
        throw new MkrError("MKR_E_POLICY_DENIED", `denied: ${decision.reasons.join(", ")}`, { decision });
      }
      // Dry-run the reducer before writing so the log never holds an event the projection rejects.
      applyEvent(undefined, { type: "proposed", at: createdAt, request }, { policy: p.doc, decision, nowUnix: now });
      const e = await this.deps.audit.append({ type: "request.proposed", actor: input.maker, requestId: request.id, policyHash: p.policyHash, data: { kind: request.kind, ...(request.controlKind ? { controlKind: request.controlKind } : {}), headline: summary.headline, request: request as unknown as Record<string, unknown>, decision: decision as unknown as Record<string, unknown> } }, now);
      this.#applyEntry(e);
      return this.get(request.id);
    });
  }

  // ---------------------------------------------------------------- approvals (MKR-006)

  approvalStatementFor(requestId: Hex32, approver: PrincipalId, decision: "approve" | "reject") {
    const st = this.get(requestId);
    const statement = approvalStatement({ request: st.record.request, approver, decision, at: unixToIso(this.#now()), nonce: this.#nonce() });
    return { statement, message: approvalMessage(statement), digest: approvalDigest(statement) };
  }

  recordApproval(requestId: Hex32, body: { approver: PrincipalId; decision: "approve" | "reject"; at: string; nonce: string; attestation: Attestation }): Promise<RequestState> {
    return this.#mutex.run(async () => {
      const st = this.get(requestId);
      const now = this.#now();
      const at = isoToUnix(body.at);
      const created = isoToUnix(st.record.request.createdAt)!;
      if (at === undefined || at < created || at > now + 300) throw new MkrError("MKR_E_ATTESTATION_INVALID", "statement time is outside the request lifetime");
      const statement = approvalStatement({ request: st.record.request, approver: body.approver, decision: body.decision, at: body.at, nonce: body.nonce });
      const approval: Approval = { statement, attestation: body.attestation };
      const next = applyEvent(st.record, { type: "approval_recorded", at: unixToIso(now), approval }, this.#ctx(st, now));
      const e = await this.deps.audit.append({
        type: "approval.recorded", actor: body.approver, requestId, policyHash: st.record.request.policyHash,
        data: { approver: body.approver, decision: body.decision, scheme: body.attestation.scheme, statementDigest: approvalDigest(statement), approval: approval as unknown as Record<string, unknown> },
      }, now);
      this.#applyEntry(e);
      if (next.state === "approved") await this.deps.audit.append({ type: "request.threshold_met", actor: "system", requestId, policyHash: st.record.request.policyHash, data: { thresholdMetAt: next.thresholdMetAt!, signingEligibleAt: next.signingEligibleAt! } }, now);
      if (next.state === "rejected") await this.deps.audit.append({ type: "request.rejected", actor: body.approver, requestId, policyHash: st.record.request.policyHash, data: {} }, now);
      return this.get(requestId);
    });
  }

  cancel(requestId: Hex32, by: PrincipalId): Promise<RequestState> {
    return this.#mutex.run(async () => {
      const st = this.get(requestId);
      const now = this.#now();
      applyEvent(st.record, { type: "cancelled", at: unixToIso(now), by }, this.#ctx(st, now));
      this.#applyEntry(await this.deps.audit.append({ type: "request.cancelled", actor: by, requestId, policyHash: st.record.request.policyHash, data: {} }, now));
      return this.get(requestId);
    });
  }

  /** Append request.expired for every non-terminal request past expiresAt. */
  expireSweep(): Promise<Hex32[]> {
    return this.#mutex.run(async () => {
      const now = this.#now();
      const out: Hex32[] = [];
      for (const [id, st] of this.requests) {
        if (TERMINAL_STATES.includes(st.record.state) || now < isoToUnix(st.record.request.expiresAt)!) continue;
        this.#applyEntry(await this.deps.audit.append({ type: "request.expired", actor: "system", requestId: id, policyHash: st.record.request.policyHash, data: {} }, now));
        out.push(id);
      }
      return out;
    });
  }

  // ---------------------------------------------------------------- auth entries (MKR-010..015)

  plan(requestId: Hex32): Promise<{ plan: AuthPlan; bundle: AuthBundle }> {
    return this.#mutex.run(async () => {
      const st = this.get(requestId);
      if (st.record.state !== "approved") throw new MkrError("MKR_E_TRANSITION_ILLEGAL", `auth is planned only when approved (state ${st.record.state})`);
      const p = this.getPolicy(st.record.request.policyHash);
      const plan = await planAuth(st.record.request, this.#authDeps(), { authEntryTtlLedgers: p.doc.authEntryTtlLedgers });
      const e = await this.deps.audit.append({
        type: "auth.planned", actor: "system", requestId, policyHash: p.policyHash,
        data: { planId: plan.planId, reason: st.plan ? "replan" : "initial", slots: plan.slots.map((s) => ({ slotId: s.slotId, address: s.address, nonce: s.nonce, validUntil: s.signatureExpirationLedger })), plan: plan as unknown as Record<string, unknown> },
      }, this.#now());
      this.#applyEntry(e);
      return { plan, bundle: this.get(requestId).bundle! };
    });
  }

  addAuthShare(requestId: Hex32, share: { slotId: string; signerId: string; signedEntryXdr: string; nodePath?: string }): Promise<{ slotId: string; status: "collected"; complete: boolean }> {
    return this.#mutex.run(async () => {
      const st = this.get(requestId);
      if (!st.plan || !st.bundle) throw new MkrError("MKR_E_TRANSITION_ILLEGAL", "no auth plan yet");
      const now = this.#now();
      const full: CollectedShare = { slotId: share.slotId, signerId: share.signerId, nodePath: share.nodePath ?? "0", signedEntryXdr: share.signedEntryXdr, collectedAt: unixToIso(now) };
      // Reducer guards first (state, cooldown, window, S3), then cryptographic verification of the share.
      applyEvent(st.record, { type: "signature_collected", at: unixToIso(now), slotId: full.slotId, signerId: full.signerId }, this.#ctx(st, now));
      verifyCollectedShare(st.plan, full, await this.#authDeps().getLatestLedger());
      const merged = mergeBundles(st.bundle, { ...st.bundle, collected: [full] });
      const e = await this.deps.audit.append({ type: "auth.slot_collected", actor: this.deps.signerPrincipal(full.signerId) ?? "system", requestId, policyHash: st.record.request.policyHash, data: { slotId: full.slotId, nodePath: full.nodePath, signerId: full.signerId, signatureDigest: sha256Hex(full.signedEntryXdr) } }, now);
      this.#applyEntry(e);
      this.get(requestId).bundle = merged;
      return { slotId: full.slotId, status: "collected", complete: isComplete(st.plan, merged) };
    });
  }

  assemble(requestId: Hex32): Promise<{ envelopeXdr: string; envelopeHash: string }> {
    return this.#mutex.run(async () => {
      const st = this.get(requestId);
      if (st.record.state !== "approved" || !st.plan || !st.bundle) throw new MkrError("MKR_E_TRANSITION_ILLEGAL", "assemble needs an approved request with an auth plan");
      const r = await assembleForEnvelopeSigning(st.plan, st.bundle, this.#authDeps());
      st.envelope = { envelopeXdr: r.envelopeXdr, envelopeHash: r.envelopeHash };
      return { envelopeXdr: r.envelopeXdr, envelopeHash: r.envelopeHash };
    });
  }

  /** Envelope signature from the transaction source's signer; moves the request to signed (SPEC 7.9, S3). */
  addEnvelopeSignature(requestId: Hex32, body: { signerId: string; signedEnvelopeXdr: string }): Promise<RequestState> {
    return this.#mutex.run(async () => {
      const st = this.get(requestId);
      if (!st.envelope) throw new MkrError("MKR_E_TRANSITION_ILLEGAL", "assemble first");
      const p = this.getPolicy(st.record.request.policyHash);
      const now = this.#now();
      if (p.doc.separation.makerCannotSign) {
        const who = this.deps.signerPrincipal(body.signerId);
        if (who === undefined) throw new MkrError("MKR_E_SOD_VIOLATION", "S3: envelope signer is not mapped to a principal");
        if (who === st.record.request.maker) throw new MkrError("MKR_E_SOD_VIOLATION", "S3: the maker may not sign the envelope");
      }
      const source = st.record.request.intent.source;
      const allowed = st.plan?.txSigners.read && st.plan.txSigners.signers.length ? st.plan.txSigners.signers.map((s) => s.key) : [source];
      const merged = addEnvelopeSignature(st.envelope.envelopeXdr, body.signedEnvelopeXdr, p.doc.network.passphrase, allowed);
      // Weight: single-key source accounts need the source key's signature. Multisig sources: spike MKR-016.
      const tx = new Transaction(merged, p.doc.network.passphrase);
      const kp = Keypair.fromPublicKey(source);
      const hasSource = tx.signatures.some((s) => bytesToHex(s.hint.value) === bytesToHex(kp.signatureHint()) && kp.verify(tx.hash(), s.signature.value));
      if (!hasSource) throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", "the transaction source has not signed the envelope");
      const signedTxXdrHash = sha256Hex(base64ToBytes(merged));
      applyEvent(st.record, { type: "signing_completed", at: unixToIso(now), signedTxXdrHash }, this.#ctx(st, now));
      st.envelope.signedEnvelopeXdr = merged;
      this.#applyEntry(await this.deps.audit.append({ type: "request.signed", actor: this.deps.signerPrincipal(body.signerId) ?? "system", requestId, policyHash: p.policyHash, data: { signedTxXdrHash, envelopeHash: st.envelope.envelopeHash, signerId: body.signerId } }, now));
      return this.get(requestId);
    });
  }

  submit(requestId: Hex32): Promise<RequestState> {
    return this.#mutex.run(async () => {
      const st = this.get(requestId);
      const p = this.getPolicy(st.record.request.policyHash);
      if (p.doc.network.name === "mainnet" && !this.deps.allowMainnetSubmit) throw new MkrError("MKR_E_MAINNET_SUBMIT_BLOCKED", "mainnet submission is blocked (G-VALUE)");
      if (st.record.state === "submitted" && st.submit) return st; // idempotent
      if (!st.envelope?.signedEnvelopeXdr || !this.deps.submitter) throw new MkrError("MKR_E_TRANSITION_ILLEGAL", "nothing signed to submit, or no submitter configured");
      const now = this.#now();
      const txHash = st.envelope.envelopeHash;
      applyEvent(st.record, { type: "submitted", at: unixToIso(now), txHash, signedTxXdrHash: st.record.signedTxXdrHash! }, this.#ctx(st, now));
      let res: SubmitResult;
      try {
        res = await this.deps.submitter.submit(st.envelope.signedEnvelopeXdr);
      } catch (e) {
        const code = e instanceof MkrError ? e.code : "MKR_E_SIMULATION_FAILED";
        await this.deps.audit.append({ type: "request.submit_failed", actor: "system", requestId, policyHash: p.policyHash, data: { code, message: String((e as Error).message).slice(0, 300) } }, this.#now());
        throw e;
      }
      if (res.status !== "SUCCESS") {
        await this.deps.audit.append({ type: "request.submit_failed", actor: "system", requestId, policyHash: p.policyHash, data: { code: res.status, txHash: res.txHash } }, this.#now());
        throw new MkrError("MKR_E_SIMULATION_FAILED", `transaction ${res.txHash} ended ${res.status}`, { result: res });
      }
      this.#applyEntry(await this.deps.audit.append({ type: "request.submitted", actor: "system", requestId, policyHash: p.policyHash, data: { txHash: res.txHash, ...(res.ledger !== undefined ? { ledger: res.ledger } : {}) } }, this.#now()));
      this.get(requestId).submit = res;
      return this.get(requestId);
    });
  }

  // ---------------------------------------------------------------- projection

  /** Apply one audit entry to the in-memory projection. Used both live and by rebuild(). */
  #applyEntry(e: AuditEntry): unknown {
    const t = isoToUnix(e.at)!;
    const d = e.data as Record<string, unknown>;
    switch (e.type) {
      case "policy.registered": {
        const doc = d.doc as unknown as PolicyDoc;
        const entry: PolicyEntry = { doc, policyHash: String(d.policyHash), registeredAt: e.at, registeredBy: String(d.registeredBy) };
        this.policies.set(entry.policyHash, entry);
        if (typeof d.supersedes === "string") {
          const old = this.policies.get(d.supersedes);
          if (old) old.supersededBy = entry.policyHash;
        }
        return entry;
      }
      case "request.proposed": {
        const request = d.request as unknown as ActionRequest;
        const decision = d.decision as unknown as PolicyDecision;
        const policy = this.getPolicy(request.policyHash).doc;
        const record = applyEvent(undefined, { type: "proposed", at: e.at, request }, { policy, decision, nowUnix: t });
        this.requests.set(request.id, { record, decision });
        return record;
      }
      case "approval.recorded":
        return this.#step(e, { type: "approval_recorded", at: e.at, approval: d.approval as unknown as Approval });
      case "auth.planned": {
        const st = this.get(e.requestId!);
        st.plan = d.plan as unknown as AuthPlan;
        st.bundle = toBundle(st.plan);
        delete st.envelope;
        return st.plan;
      }
      case "auth.slot_collected":
        return this.#step(e, { type: "signature_collected", at: e.at, slotId: String(d.slotId), signerId: String(d.signerId) });
      case "request.signed":
        return this.#step(e, { type: "signing_completed", at: e.at, signedTxXdrHash: String(d.signedTxXdrHash) });
      case "request.submitted":
        return this.#step(e, { type: "submitted", at: e.at, txHash: String(d.txHash) });
      case "request.cancelled":
        return this.#step(e, { type: "cancelled", at: e.at, by: e.actor });
      case "request.expired":
        return this.#step(e, { type: "expired", at: e.at });
      default:
        return undefined; // informational entries (threshold_met, rejected, policy_denied, control.built, ...)
    }
  }

  #step(e: AuditEntry, ev: RequestEvent): RequestRecord {
    const st = this.get(e.requestId!);
    // Attestation signatures are kept in full in the log, so replay re-verifies them (default verifier).
    st.record = applyEvent(st.record, ev, this.#ctx(st, isoToUnix(e.at)!));
    return st.record;
  }

  /** Rebuild every policy and request record from the audit log alone (ARCHITECTURE D1). */
  async rebuild(): Promise<void> {
    this.policies.clear();
    this.requests.clear();
    const all = await this.deps.audit.readAll();
    for (const e of all) this.#applyEntry(e);
  }
}
