// SPDX-License-Identifier: Apache-2.0
// SHA-256 from @noble/hashes (audited, no hand-written primitive; G-CRYPTO). Works in Node and browsers,
// so the pure cores (policy, workflow, audit verify) also run in the web console.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** 64 lowercase hex characters (a SHA-256 digest). */
export type Hex32 = string;

/** Domain-separation tags for every hash that is not the bare PolicyDoc hash (SPEC section 3.3). */
export const DOMAIN = {
  request: "sik-mkr/request/v1\n",
  intent: "sik-mkr/intent/v1\n",
  approval: "sik-mkr/approval/v1\n",
  audit: "sik-mkr/audit/v1\n",
  authPlan: "sik-mkr/auth-plan/v1\n",
  checkpoint: "sik-mkr/checkpoint/v1\n",
} as const;

export const GENESIS_HASH: Hex32 = "0".repeat(64);

const toBytes = (d: Uint8Array | string): Uint8Array => (typeof d === "string" ? utf8ToBytes(d) : d);

export function sha256Bytes(data: Uint8Array | string): Uint8Array {
  return sha256(toBytes(data));
}

export function sha256Hex(data: Uint8Array | string): Hex32 {
  return bytesToHex(sha256(toBytes(data)));
}

/** SHA-256 over `domainTag || bytes`, lowercase hex. */
export function taggedHash(domainTag: string, bytes: Uint8Array | string): Hex32 {
  const h = sha256.create();
  h.update(utf8ToBytes(domainTag));
  h.update(toBytes(bytes));
  return bytesToHex(h.digest());
}

export function isHex32(v: unknown): v is Hex32 {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export { bytesToHex };
