// SPDX-License-Identifier: Apache-2.0
import { MkrError } from "./errors.ts";
import { taggedHash } from "./hash.ts";
import type { Hex32 } from "./hash.ts";

/**
 * RFC 8785 (JCS) canonical JSON for the value subset the kit produces
 * (SPEC section 3.1): objects, arrays, strings, booleans, safe integers.
 * Rejects floats, NaN/Infinity, undefined, null, bigint, symbols, functions,
 * lone surrogates and exotic prototypes (fail closed, MKR_E_CANON_UNSUPPORTED_VALUE).
 * Ordering and escaping are done here; JSON.stringify is not used.
 */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out, "");
  return out.join("");
}

/** UTF-8 bytes of `canonicalize(value)`. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

/** Tagged SHA-256 of the canonical bytes (SPEC 3.3). */
export function canonicalTaggedHash(tag: string, value: unknown): Hex32 {
  return taggedHash(tag, canonicalBytes(value));
}

function fail(path: string, what: string): never {
  throw new MkrError("MKR_E_CANON_UNSUPPORTED_VALUE", `unsupported value at ${path || "/"}: ${what}`, { path });
}

function write(v: unknown, out: string[], path: string): void {
  switch (typeof v) {
    case "boolean":
      out.push(v ? "true" : "false");
      return;
    case "number":
      if (!Number.isSafeInteger(v)) fail(path, Number.isFinite(v) ? (Number.isInteger(v) ? "integer beyond 2^53-1" : "non-integer number") : String(v));
      // Safe integers: decimal digits with optional minus; -0 is written as 0 (RFC 8785 / ECMAScript).
      out.push(Object.is(v, -0) ? "0" : String(v));
      return;
    case "string":
      out.push(quote(v, path));
      return;
    case "object": {
      if (v === null) fail(path, "null");
      if (Array.isArray(v)) {
        out.push("[");
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out.push(",");
          if (!(i in v)) fail(`${path}/${i}`, "array hole");
          write(v[i], out, `${path}/${i}`);
        }
        out.push("]");
        return;
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) fail(path, "object with a non-plain prototype");
      const obj = v as Record<string, unknown>;
      if (Object.getOwnPropertySymbols(obj).length > 0) fail(path, "symbol key");
      const keys = Object.keys(obj);
      for (const k of keys) checkString(k, `${path}/${k}`);
      // Sort by UTF-16 code units (RFC 8785 3.2.3): plain < / > comparison of JS strings does exactly that.
      keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      out.push("{");
      keys.forEach((k, i) => {
        if (i > 0) out.push(",");
        const val = obj[k];
        if (val === undefined) fail(`${path}/${k}`, "undefined");
        out.push(quote(k, path), ":");
        write(val, out, `${path}/${k}`);
      });
      out.push("}");
      return;
    }
    default:
      fail(path, typeof v);
  }
}

function checkString(s: string, path: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) fail(path, "lone high surrogate");
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) fail(path, "lone low surrogate");
  }
}

const SHORT: Record<number, string> = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r", 0x22: '\\"', 0x5c: "\\\\" };

/** RFC 8785 3.2.2.2: escape only `"`, `\` and C0 controls; everything else literal. */
function quote(s: string, path: string): string {
  checkString(s, path);
  let r = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const short = SHORT[c];
    if (short !== undefined) r += short;
    else if (c < 0x20) r += "\\u" + c.toString(16).padStart(4, "0");
    else r += s[i];
  }
  return r + '"';
}
