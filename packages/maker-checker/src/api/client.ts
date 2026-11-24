// SPDX-License-Identifier: Apache-2.0
// Tiny fetch client for the HTTP API. Browser- and Node-safe (no node: imports). Used by the e2e script and
// the web console. Errors keep the server's stable code.

export interface ApiErrorBody {
  code: string;
  message: string;
  [k: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(`${status} ${body.code}: ${body.message}`);
    this.status = status;
    this.body = body;
  }
}

export interface ApiCall {
  method: "GET" | "POST";
  path: string;
  status: number;
  ok: boolean;
  body: unknown;
}

export function createClient(baseUrl: string, opts: { token?: () => string | undefined; onCall?: (c: ApiCall) => void } = {}) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const t = opts.token?.();
    if (t) headers.authorization = `Bearer ${t}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(baseUrl + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const ct = r.headers.get("content-type") ?? "";
    const parsed: unknown = ct.includes("application/json") ? await r.json() : await r.text();
    opts.onCall?.({ method, path, status: r.status, ok: r.ok, body: parsed });
    if (!r.ok) throw new ApiError(r.status, parsed as ApiErrorBody);
    return parsed as T;
  }
  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body: unknown = {}) => call<T>("POST", path, body),
  };
}
export type ApiClient = ReturnType<typeof createClient>;
