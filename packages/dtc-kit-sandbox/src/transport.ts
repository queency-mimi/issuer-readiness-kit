// SPDX-License-Identifier: Apache-2.0
import { handle } from "./app.ts";
import type { SandboxRequest, SandboxResponse } from "./app.ts";
import type { MockDtcRegistry } from "./registry.ts";

/** How a client reaches the sandbox: over HTTP, or in-process (the browser console, fast tests). */
export type Transport = (req: SandboxRequest) => Promise<SandboxResponse>;

/** In-process transport. The body goes through JSON both ways, so it sees exactly what HTTP would return. */
export function inProcessTransport(registry: MockDtcRegistry): Transport {
  return async (req) => {
    const res = handle(registry, { ...req, ...(req.body !== undefined ? { body: JSON.parse(JSON.stringify(req.body)) } : {}) });
    return { ...res, body: typeof res.body === "string" ? res.body : JSON.parse(JSON.stringify(res.body)) };
  };
}

/** HTTP transport against a running sandbox (Node server or a container). */
export function httpTransport(baseUrl: string): Transport {
  return async (req) => {
    const res = await fetch(new URL(req.path, baseUrl), {
      method: req.method,
      headers: { ...(req.body !== undefined ? { "content-type": "application/json" } : {}), ...(req.headers ?? {}) },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const text = await res.text();
    const body: unknown = (headers["content-type"] ?? "").includes("application/json") && text ? JSON.parse(text) : text;
    return { status: res.status, headers, body };
  };
}
