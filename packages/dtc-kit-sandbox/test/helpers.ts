// SPDX-License-Identifier: Apache-2.0
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import { MockDtcRegistry, inProcessTransport } from "../src/index.ts";
import type { Transport } from "../src/index.ts";

export const profile = resolveProfile(loadBundledProfile("dtc-stellar"));

/** A fresh registry plus a small client that logs in once per client_id. */
export function sandbox() {
  const registry = new MockDtcRegistry({ profile });
  const transport: Transport = inProcessTransport(registry);
  const tokens = new Map<string, string>();
  const token = async (clientId: string) => {
    let t = tokens.get(clientId);
    if (!t) {
      const r = await transport({ method: "POST", path: "/oauth/token", body: { grant_type: "client_credentials", client_id: clientId, client_secret: "sandbox-secret" } });
      t = (r.body as { access_token: string }).access_token;
      tokens.set(clientId, t);
    }
    return t;
  };
  const call = async (clientId: string | undefined, method: "GET" | "POST", path: string, body?: unknown, accept?: string) => {
    const headers: Record<string, string> = {};
    if (clientId) headers["authorization"] = `Bearer ${await token(clientId)}`;
    if (accept) headers["accept"] = accept;
    return transport({ method, path, headers, ...(body !== undefined ? { body } : {}) });
  };
  return { registry, transport, call };
}
