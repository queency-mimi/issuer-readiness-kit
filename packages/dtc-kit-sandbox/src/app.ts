// SPDX-License-Identifier: Apache-2.0
import type { ForceTransferRequest } from "./api.ts";
import { DISCLAIMER_HEADER, DISCLAIMER_TEXT, ROUTES } from "./api.ts";
import type { RouteSpec } from "./api.ts";
import { toCsv } from "./csv.ts";
import { ACTIVITY_COLUMNS, ApiFailure, DIGITAL_COLUMNS, MockDtcRegistry, ORDER_COLUMNS, WALLET_COLUMNS } from "./registry.ts";
import type { Principal } from "./registry.ts";

/** Sandbox-only shared secret for the fake service accounts (documented in the README; not a secret). */
export const SANDBOX_CLIENT_SECRET = "sandbox-secret";

export interface SandboxRequest {
  method: "GET" | "POST";
  /** Path, optionally with a query string. */
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface SandboxResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON-safe value (bigints as decimal strings) or CSV text. */
  body: unknown;
}

/** Recursively turn bigints into decimal strings so the value survives JSON (and equals what HTTP returns). */
export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, jsonSafe(x)]));
  }
  return v;
}

function match(pattern: string, path: string): Record<string, string> | undefined {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] as string;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(b[i] as string);
    else if (seg !== b[i]) return undefined;
  }
  return params;
}

const TOKEN_PREFIX = "sbx-token.";

/**
 * The sandbox HTTP API as a pure function of (registry, request). The Node server and the in-browser
 * console both call it, so the console runs exactly the code the server runs. Every response carries the
 * disclaimer header (SPEC 4).
 */
export function handle(registry: MockDtcRegistry, req: SandboxRequest): SandboxResponse {
  const headers: Record<string, string> = { "content-type": "application/json", [DISCLAIMER_HEADER]: DISCLAIMER_TEXT };
  const json = (status: number, body: unknown): SandboxResponse => ({ status, headers, body: jsonSafe(body) });
  const url = new URL(req.path, "http://sandbox.invalid");
  const path = url.pathname;
  const lower = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const wantsCsv = (lower["accept"] ?? "").includes("text/csv");
  const csv = (columns: readonly string[], rows: Record<string, unknown>[]): SandboxResponse => ({
    status: 200,
    headers: { ...headers, "content-type": "text/csv; charset=utf-8" },
    body: toCsv(columns, jsonSafe(rows) as Record<string, unknown>[]),
  });
  const body = (req.body ?? {}) as Record<string, unknown>;

  let route: RouteSpec | undefined;
  let params: Record<string, string> = {};
  for (const r of ROUTES) {
    if (r.method !== req.method) continue;
    const m = match(r.path, path);
    if (m) {
      route = r;
      params = m;
      break;
    }
  }
  if (!route) return json(404, { code: "NOT_FOUND", message: `${req.method} ${path}` });

  try {
    // Public routes.
    if (route.operationId === "health") {
      const p = registry.profile;
      return json(200, { status: "ok", profile: p.profileId, profileVersion: p.version, lineage: p.lineage, adapter: registry.adapter.id, clock: registry.nowIso() });
    }
    if (route.operationId === "token") {
      const clientId = body["client_id"];
      const secret = body["client_secret"];
      const principal = typeof clientId === "string" ? registry.principalFor(clientId) : undefined;
      if (!principal || secret !== SANDBOX_CLIENT_SECRET) return json(401, { code: "UNAUTHENTICATED", message: "unknown sandbox client_id or wrong client_secret" });
      return json(200, { access_token: `${TOKEN_PREFIX}${principal.clientId}`, token_type: "Bearer", role: principal.role, ...(principal.role === "participant" ? { participant: principal.participant } : {}) });
    }
    if (route.operationId === "profile") {
      const p = registry.profile;
      const rows = [...p.rows.values()];
      const counts = { published: 0, inferred: 0, unknown: 0 };
      for (const r of rows) counts[r.status] += 1;
      return json(200, { profile: p.profileId, version: p.version, lineage: p.lineage, disclaimers: p.disclaimers, counts, rows: rows.map((r) => ({ id: r.id, area: r.area, status: r.status, confidence: r.confidence, statement: r.statement })) });
    }

    // Authenticated routes.
    const auth = lower["authorization"] ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const principal: Principal | undefined = token.startsWith(TOKEN_PREFIX) ? registry.principalFor(token.slice(TOKEN_PREFIX.length)) : undefined;
    if (!principal) return json(401, { code: "UNAUTHENTICATED", message: "missing or invalid bearer token (POST /oauth/token)" });
    if (route.role === "participant" && principal.role !== "participant") {
      return json(403, { code: "NOT_A_PARTICIPANT", message: `${principal.clientId} is not a DTC participant service account` });
    }
    if ((route.role === "dtc-ops" || route.role === "sim") && principal.role !== route.role) {
      return json(403, { code: "FORBIDDEN_ROLE", message: `${route.operationId} needs role ${route.role}` });
    }
    const participant = principal.role === "participant" ? principal.participant : "";
    const ownAccount = (): void => {
      if (params["participant"] !== participant) throw new ApiFailure(403, "FORBIDDEN_ROLE", "a participant reads only its own account");
    };

    switch (route.operationId) {
      case "registerWallet":
        return json(202, registry.registerWallet(participant, body as never));
      case "listWallets": {
        const rows = registry.listWallets(participant);
        return wantsCsv ? csv(WALLET_COLUMNS, rows) : json(200, { wallets: rows });
      }
      case "getWallet":
        return json(200, registry.wallet(participant, params["id"] ?? ""));
      case "balances": {
        ownAccount();
        const b = registry.balancesFor(participant);
        return wantsCsv ? csv(DIGITAL_COLUMNS, b["digital"] as Record<string, unknown>[]) : json(200, b);
      }
      case "activity": {
        ownAccount();
        const rows = registry.activityFor(participant);
        return wantsCsv ? csv(ACTIVITY_COLUMNS, rows) : json(200, { participant, activity: rows });
      }
      case "listConversionOrders": {
        const rows = registry.listOrders(participant);
        return wantsCsv ? csv(ORDER_COLUMNS, rows) : json(200, { orders: rows });
      }
      case "createConversionOrder": {
        const r = registry.createConversionOrder(participant, body as never);
        return json(r.declined ? 422 : 202, { ...r.order, trust: r.trust });
      }
      case "getConversionOrder":
        return json(200, registry.order(participant, params["id"] ?? ""));
      case "approveConversionOrder":
        return json(200, registry.approveOrder(participant, params["id"] ?? "", body["checker"]));
      case "precheckTransfer": {
        const r = registry.precheck(participant, body as never);
        return json(200, { allowed: r.allowed, reasons: r.reasons, trust: r.trust });
      }
      case "transfer":
        return json(200, registry.transfer(participant, body as never));
      case "forceTransfer": {
        const t = registry.forceTransfer(body as unknown as ForceTransferRequest);
        return json(200, t);
      }
      case "rootWalletUses":
        return json(200, registry.rootWalletUses());
      case "createCorporateAction": {
        const ca = registry.createCorporateAction(body as never);
        return json(202, { id: ca.id, kind: ca.kind, recordDate: ca.recordDate, payDate: ca.payDate, captureAt: ca.captureAt, status: ca.status, trust: ca.trust });
      }
      case "getCorporateAction":
        return json(200, registry.corporateActionFor(participant, params["id"] ?? ""));
      case "captureCorporateAction":
        return json(200, registry.capture(params["id"] ?? ""));
      case "payCorporateAction":
        return json(200, registry.pay(params["id"] ?? ""));
      case "simControl":
        return json(200, registry.control(params["id"] ?? "", body["control"]));
      case "simAdvance":
        return json(200, registry.advance(body as { seconds?: number; to?: string }));
      case "simReset":
        return json(200, registry.reset((body["fixture"] as "empty" | "two-wallets-funded" | undefined) ?? "empty"));
      case "simPlans":
        return json(200, { adapter: registry.adapter.id, plans: registry.plans() });
    }
    return json(501, { code: "NOT_IMPLEMENTED", message: route.summary, ticket: route.ticket });
  } catch (e) {
    const f = MockDtcRegistry.toFailure(e);
    return json(f.status, { code: f.code, message: f.message, ...f.extra });
  }
}
