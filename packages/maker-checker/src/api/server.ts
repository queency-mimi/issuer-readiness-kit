// SPDX-License-Identifier: Apache-2.0
// Minimal node:http server for openapi/openapi.yaml (SPEC 10). No framework, JSON only, binds 127.0.0.1.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { toCsv, toJsonl } from "../audit/export.ts";
import { verifyEntries } from "../audit/log.ts";
import { buildControlAction } from "../control/sep57.ts";
import type { ControlActionParams } from "../control/sep57.ts";
import { MkrError } from "../errors.ts";
import type { MkrErrorCode } from "../errors.ts";
import { evaluate } from "../policy/evaluate.ts";
import { isoToUnix } from "../policy/parse.ts";
import type { PolicyDoc } from "../policy/types.ts";
import type { RequestService, RequestState } from "../service/requests.ts";
import type { Attestation } from "../workflow/types.ts";

export const API_VERSION = "0.1.0";
const MAX_BODY = 1024 * 1024;

export interface ServerOptions {
  service: RequestService;
  port: number;
  /** Default 127.0.0.1. */
  host?: string;
  /**
   * Bearer token -> principal id (SPEC 10.1). Token issuance is the host's job. When absent the server runs
   * without caller identity (local development only) and acting-principal fields are trusted as sent.
   */
  authenticate?: (token: string) => string | undefined;
  /** Origins allowed by CORS (the web console in development). Default none. */
  corsOrigins?: string[];
  /**
   * Accepted Host header values. Default on a loopback bind: 127.0.0.1, localhost and [::1] with the listening
   * port (blocks DNS rebinding). Pass [] to disable the check on a non-loopback bind behind a trusted proxy.
   */
  allowedHosts?: string[];
  /** Called with the error behind a 500 so a host can log it. The response body stays generic. */
  onInternalError?: (e: unknown) => void;
  /** Extra routes (the demo harness mounts its wallet simulator under /demo/). Return false if not handled. */
  extraRoutes?: (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<boolean>;
}

const STATUS: Partial<Record<MkrErrorCode, number>> = {
  MKR_E_USAGE: 400,
  MKR_E_POLICY_PARSE: 400,
  MKR_E_POLICY_INVALID: 422,
  MKR_E_POLICY_UNKNOWN: 404,
  MKR_E_POLICY_DENIED: 403,
  MKR_E_MAINNET_SUBMIT_BLOCKED: 403,
  MKR_E_TRANSITION_ILLEGAL: 409,
  MKR_E_AUDIT_APPEND_CONFLICT: 409,
  MKR_E_SOD_VIOLATION: 422,
  MKR_E_ATTESTATION_INVALID: 422,
  MKR_E_REQUEST_EXPIRED: 422,
  MKR_E_PAYLOAD_MISMATCH: 422,
  MKR_E_AUTH_PLAN_STALE: 422,
  MKR_E_AUTH_ENTRY_INVALID: 422,
  MKR_E_AUTH_SLOT_UNKNOWN: 422,
  MKR_E_SIMULATION_FAILED: 502,
  MKR_E_SIGNER_UNAVAILABLE: 502,
  MKR_E_SIGNER_DECLINED: 422,
  MKR_E_AUDIT_CHAIN_BROKEN: 500,
  MKR_E_CANON_UNSUPPORTED_VALUE: 400,
};

export function view(st: RequestState, legalNext?: string[]) {
  const r = st.record;
  return {
    request: r.request,
    state: r.state,
    approvals: r.approvals,
    ...(r.thresholdMetAt ? { thresholdMetAt: r.thresholdMetAt } : {}),
    ...(r.signingEligibleAt ? { signingEligibleAt: r.signingEligibleAt } : {}),
    ...(r.txHash ? { txHash: r.txHash } : {}),
    version: r.version,
    decision: st.decision,
    collectedSlotIds: r.collectedSlotIds,
    ...(st.plan ? { plan: { planId: st.plan.planId, planLedger: st.plan.planLedger, slots: st.plan.slots.map((s) => ({ slotId: s.slotId, address: s.address, credentialType: s.credentialType, accountKind: s.accountKind, signatureExpirationLedger: s.signatureExpirationLedger, preimageHash: s.preimageHash, nodes: s.nodes, collected: r.collectedSlotIds.includes(s.slotId) })) } } : {}),
    ...(st.envelope ? { envelope: { envelopeHash: st.envelope.envelopeHash, signed: Boolean(st.envelope.signedEnvelopeXdr) } } : {}),
    ...(st.submit ? { submit: st.submit } : {}),
    ...(legalNext ? { legalNext } : {}),
  };
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  const text = type === "application/json" ? JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : String(body);
  res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(text);
}

function sendError(res: ServerResponse, e: unknown, onInternalError?: (e: unknown) => void) {
  if (e instanceof MkrError) {
    const status = e.details.notFound ? 404 : (STATUS[e.code] ?? 400);
    const { notFound: _n, ...details } = e.details;
    if (e.code === "MKR_E_POLICY_DENIED" && details.decision) return send(res, 403, { code: e.code, message: e.message, ...(details.decision as object) });
    return send(res, status, { code: e.code, message: e.message, ...(Object.keys(details).length ? { details } : {}) });
  }
  onInternalError?.(e);
  return send(res, 500, { code: "MKR_E_INTERNAL", message: "internal error" });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new MkrError("MKR_E_USAGE", "body larger than 1 MiB");
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  const ct = req.headers["content-type"] ?? "";
  if (!ct.startsWith("application/json")) throw new MkrError("MKR_E_USAGE", "content-type must be application/json");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MkrError("MKR_E_USAGE", "body is not JSON");
  }
}

const str = (o: Record<string, unknown>, k: string): string => {
  const v = o[k];
  if (typeof v !== "string" || v.length === 0) throw new MkrError("MKR_E_USAGE", `${k} is required`);
  return v;
};

export function startServer(options: ServerOptions): Promise<{ close(): Promise<void>; port: number; url: string }> {
  const svc = options.service;
  const host = options.host ?? "127.0.0.1";

  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  let listeningPort = options.port;
  const hostAllowed = (h: string | undefined): boolean => {
    const list = options.allowedHosts ?? (isLoopback ? [`127.0.0.1:${listeningPort}`, `localhost:${listeningPort}`, `[::1]:${listeningPort}`] : []);
    if (list.length === 0) return true;
    return h !== undefined && list.includes(h.toLowerCase());
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // DNS-rebinding guard: a browser page on another origin that resolves to 127.0.0.1 still sends its own Host.
    if (!hostAllowed(req.headers.host)) return send(res, 403, { code: "MKR_E_USAGE", message: "Host header not allowed" });
    const origin = req.headers.origin;
    // A browser request from an origin that is neither allow-listed nor same-origin is refused outright; the
    // CORS headers alone only stop the page from reading the answer, not the request from being processed.
    if (origin && !options.corsOrigins?.includes(origin) && origin !== `http://${req.headers.host}`) {
      return send(res, 403, { code: "MKR_E_USAGE", message: "Origin not allowed" });
    }
    if (origin && options.corsOrigins?.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
    const url = new URL(req.url ?? "/", "http://local");
    const p = url.pathname;
    const body = (await readBody(req)) as Record<string, unknown> | undefined;
    if (p === "/v1/healthz" && req.method === "GET") return send(res, 200, { ok: true, version: API_VERSION, mainnetSubmitAllowed: Boolean(svc.deps.allowMainnetSubmit), network: svc.deps.auth?.networkPassphrase ?? null });

    // Caller identity (SPEC 10.1).
    let caller: string | undefined;
    if (options.authenticate) {
      const h = req.headers.authorization ?? "";
      const m = /^Bearer (.+)$/.exec(h);
      caller = m ? options.authenticate(m[1]!) : undefined;
      if (!caller) return send(res, 401, { code: "MKR_E_USAGE", message: "missing or unknown bearer token" });
    }
    // Extra routes (the demo wallet simulator) run only after caller authentication.
    if (options.extraRoutes && (await options.extraRoutes(req, res, body))) return;
    const actingAs = (principal: string) => {
      if (caller !== undefined && caller !== principal) throw new MkrError("MKR_E_SOD_VIOLATION", `caller ${caller} cannot act as ${principal}`);
    };
    const b = body ?? {};

    if (p === "/v1/policies" && req.method === "POST") {
      const by = typeof b.registeredBy === "string" ? b.registeredBy : (caller ?? "");
      actingAs(by);
      const entry = await svc.registerPolicy(b.policy as PolicyDoc, by);
      return send(res, 201, { policyHash: entry.policyHash, id: entry.doc.id, name: entry.doc.name });
    }
    if (p === "/v1/policies" && req.method === "GET") {
      return send(res, 200, { items: svc.listPolicies().map((x) => ({ policyHash: x.policyHash, id: x.doc.id, name: x.doc.name, notBefore: x.doc.validity.notBefore, expiresAt: x.doc.validity.expiresAt, ...(x.supersededBy ? { supersededBy: x.supersededBy } : {}) })) });
    }
    let m = /^\/v1\/policies\/([0-9a-f]{64})$/.exec(p);
    if (m && req.method === "GET") {
      const e = svc.getPolicy(m[1]!);
      return send(res, 200, { policyHash: e.policyHash, policy: e.doc, registeredAt: e.registeredAt, registeredBy: e.registeredBy, ...(e.supersededBy ? { supersededBy: e.supersededBy } : {}) });
    }
    m = /^\/v1\/policies\/([0-9a-f]{64})\/evaluate$/.exec(p);
    if (m && req.method === "POST") {
      const e = svc.getPolicy(m[1]!);
      if (Array.isArray(b.nodes)) {
        const now = typeof b.now === "string" ? isoToUnix(b.now) : undefined;
        return send(res, 200, evaluate({ policy: e.doc, policyHash: e.policyHash, maker: str(b, "maker"), networkPassphrase: e.doc.network.passphrase, nodes: b.nodes as never, ...(b.controlKind ? { controlKind: b.controlKind as never } : {}), nowUnix: now ?? svc.deps.clock(), priorSpend: svc.priorSpend(e.doc, now ?? svc.deps.clock()) }));
      }
      const intent = b.intent as { source: string; contract: string; function: string; args: never[] };
      const r = await svc.evaluateIntent({ policyHash: e.policyHash, maker: str(b, "maker"), intent, ...(b.controlKind ? { controlKind: b.controlKind as never } : {}) });
      return send(res, 200, { ...r.decision, tree: r.tree, invocationTreeDigest: r.treeDigest });
    }

    if (p === "/v1/control-actions/build" && req.method === "POST") {
      try {
        return send(res, 200, buildControlAction(b as unknown as ControlActionParams));
      } catch (e) {
        if (e instanceof MkrError) return send(res, 422, { violations: [{ path: "", code: e.code, message: e.message }] });
        throw e;
      }
    }

    if (p === "/v1/requests" && req.method === "POST") {
      const maker = str(b, "maker");
      actingAs(maker);
      const policyHash = str(b, "policyHash");
      let st: RequestState;
      if (b.control !== undefined) {
        const c = b.control as Record<string, unknown>;
        st = await svc.proposeControl({ policyHash, maker, source: str(c, "source"), params: c.params as ControlActionParams, ...(typeof b.reason === "string" ? { reason: b.reason } : {}) });
      } else {
        const intent = b.intent as Record<string, unknown> | undefined;
        if (!intent) throw new MkrError("MKR_E_USAGE", "intent or control is required");
        st = await svc.propose({ policyHash, maker, intent: { source: str(intent, "source"), contract: str(intent, "contract"), function: str(intent, "function"), args: (intent.args ?? []) as never }, ...(b.controlKind ? { controlKind: b.controlKind as never } : {}), ...(typeof b.reason === "string" ? { reason: b.reason } : {}) });
      }
      return send(res, 201, view(st, svc.legalNext(st.record.request.id)));
    }
    if (p === "/v1/requests" && req.method === "GET") {
      const state = url.searchParams.get("state");
      const maker = url.searchParams.get("maker");
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
      const items = [...svc.requests.values()]
        .filter((s) => (!state || s.record.state === state) && (!maker || s.record.request.maker === maker))
        .sort((a, b2) => (a.record.request.createdAt > b2.record.request.createdAt ? -1 : 1))
        .slice(0, limit)
        .map((s) => view(s));
      return send(res, 200, { items });
    }
    m = /^\/v1\/requests\/([0-9a-f]{64})(\/[a-z-]+)?$/.exec(p);
    if (m) {
      const id = m[1]!;
      const sub = m[2] ?? "";
      if (sub === "" && req.method === "GET") return send(res, 200, view(svc.get(id), svc.legalNext(id)));
      if (sub === "/approval-statement" && req.method === "GET") {
        const approver = url.searchParams.get("approver") ?? "";
        const decision = url.searchParams.get("decision");
        if (!approver || (decision !== "approve" && decision !== "reject")) throw new MkrError("MKR_E_USAGE", "approver and decision are required");
        return send(res, 200, svc.approvalStatementFor(id, approver, decision));
      }
      if (sub === "/approvals" && req.method === "POST") {
        const approver = str(b, "approver");
        actingAs(approver);
        const decision = str(b, "decision");
        if (decision !== "approve" && decision !== "reject") throw new MkrError("MKR_E_USAGE", "decision must be approve or reject");
        const st = await svc.recordApproval(id, { approver, decision, at: str(b, "at"), nonce: str(b, "nonce"), attestation: b.attestation as Attestation });
        return send(res, 200, view(st, svc.legalNext(id)));
      }
      if (sub === "/cancel" && req.method === "POST") {
        const by = str(b, "by");
        actingAs(by);
        return send(res, 200, view(await svc.cancel(id, by), svc.legalNext(id)));
      }
      if (sub === "/auth-plan" && req.method === "POST") {
        const r = await svc.plan(id);
        return send(res, 201, r);
      }
      if (sub === "/auth-entries" && req.method === "POST") {
        const r = await svc.addAuthShare(id, { slotId: str(b, "slotId"), signerId: str(b, "signerId"), signedEntryXdr: str(b, "signedEntryXdr"), ...(typeof b.nodePath === "string" ? { nodePath: b.nodePath } : {}) });
        return send(res, 200, r);
      }
      if (sub === "/assemble" && req.method === "POST") return send(res, 200, await svc.assemble(id));
      if (sub === "/signatures" && req.method === "POST") {
        const st = await svc.addEnvelopeSignature(id, { signerId: str(b, "signerId"), signedEnvelopeXdr: str(b, "signedEnvelopeXdr") });
        return send(res, 200, view(st, svc.legalNext(id)));
      }
      if (sub === "/submit" && req.method === "POST") return send(res, 200, view(await svc.submit(id), svc.legalNext(id)));
    }

    if (p === "/v1/audit" && req.method === "GET") {
      const from = Math.max(0, Number(url.searchParams.get("from") ?? 0));
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
      const rid = url.searchParams.get("requestId");
      const all = await svc.deps.audit.readAll();
      const page = all.filter((e) => !rid || e.requestId === rid).slice(from, from + limit);
      const format = url.searchParams.get("format") ?? "json";
      if (format === "jsonl") return send(res, 200, toJsonl(page), "application/x-ndjson");
      if (format === "csv") return send(res, 200, toCsv(page), "text/csv");
      return send(res, 200, page);
    }
    if (p === "/v1/audit/head" && req.method === "GET") return send(res, 200, (await svc.deps.audit.store.head()) ?? {});
    if (p === "/v1/audit/verify" && req.method === "POST") {
      const all = await svc.deps.audit.readAll();
      const from = typeof b.fromSeq === "number" ? b.fromSeq : 0;
      return send(res, 200, verifyEntries(all.slice(from), { fromSeq: from, ...(typeof b.trustedPrevHash === "string" ? { trustedPrevHash: b.trustedPrevHash } : {}), ...(b.anchoredHead ? { anchoredHead: b.anchoredHead as never } : {}) }));
    }
    return send(res, 404, { code: "MKR_E_USAGE", message: `no route ${req.method} ${p}` });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => sendError(res, e, options.onInternalError));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : options.port;
      listeningPort = port;
      resolve({
        port,
        url: `http://${host}:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
