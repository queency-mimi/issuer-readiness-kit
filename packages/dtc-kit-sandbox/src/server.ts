// SPDX-License-Identifier: Apache-2.0
import { createServer as createHttpServer } from "node:http";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import type { ChainAdapter } from "@sik/dtc-kit-core";
import { handle } from "./app.ts";
import { DISCLAIMER_HEADER, DISCLAIMER_TEXT } from "./api.ts";
import { MockDtcRegistry } from "./registry.ts";

/**
 * Node HTTP shell around the pure handler (`app.ts`). One in-memory registry per server.
 * DTC-shaped, not DTC-certified; fictional institutions; not the DTCC API.
 */
export function createSandboxServer(profileId = "dtc-stellar", adapter?: ChainAdapter): Server {
  const profile = resolveProfile(loadBundledProfile(profileId));
  const registry = new MockDtcRegistry({ profile, ...(adapter ? { adapter } : {}) });
  return createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(422, { "content-type": "application/json", [DISCLAIMER_HEADER]: DISCLAIMER_TEXT });
        res.end(JSON.stringify({ code: "VALIDATION", message: "body is not JSON" }));
        return;
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
      const out = handle(registry, { method: req.method === "POST" ? "POST" : "GET", path: req.url ?? "/", headers, ...(body !== undefined ? { body } : {}) });
      res.writeHead(out.status, out.headers);
      res.end(typeof out.body === "string" ? out.body : JSON.stringify(out.body));
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env["PORT"] ?? 8080);
  // Loopback by default: the sandbox is a local dev tool. Set HOST=0.0.0.0 to expose it deliberately.
  const host = process.env["HOST"] ?? "127.0.0.1";
  createSandboxServer(process.env["DTC_PROFILE"] ?? "dtc-stellar").listen(port, host, () => {
    console.log(`dtc-kit sandbox listening on ${host}:${port} (${DISCLAIMER_TEXT})`);
  });
}
