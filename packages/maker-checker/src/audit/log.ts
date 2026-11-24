// SPDX-License-Identifier: Apache-2.0
// Hash-chained audit log (SPEC 8). Pure parts only (browser-safe); the JSON Lines store is in file-store.ts.
import { canonicalTaggedHash } from "../canonical.ts";
import { MkrError } from "../errors.ts";
import { DOMAIN, GENESIS_HASH, isHex32 } from "../hash.ts";
import { isoToUnix, unixToIso } from "../policy/parse.ts";
import type { AuditEntry, AuditEventType, AuditStore, NewAuditEntry, VerifyReport } from "./types.ts";

export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  "policy.registered", "request.proposed", "request.policy_denied", "approval.recorded", "request.threshold_met",
  "auth.planned", "auth.slot_collected", "auth.slot_declined", "request.signed", "request.submitted",
  "request.submit_failed", "request.rejected", "request.cancelled", "request.expired", "control.built", "audit.checkpoint",
];

const KEYS = new Set(["version", "seq", "prevHash", "at", "type", "actor", "requestId", "policyHash", "data", "hash"]);

/** Hash of an entry: TAG_audit SHA-256 over JCS(entry without hash) (SPEC 8.2). */
export function auditEntryHash(entry: Omit<AuditEntry, "hash"> | AuditEntry): string {
  const { hash: _h, ...rest } = entry as AuditEntry;
  return canonicalTaggedHash(DOMAIN.audit, rest);
}

function shapeOk(e: unknown): e is AuditEntry {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
  const o = e as Record<string, unknown>;
  if (Object.keys(o).some((k) => !KEYS.has(k))) return false;
  return (
    o.version === 1 &&
    Number.isSafeInteger(o.seq) && (o.seq as number) >= 0 &&
    isHex32(o.prevHash) && isHex32(o.hash) &&
    typeof o.at === "string" && isoToUnix(o.at) !== undefined &&
    typeof o.type === "string" && (AUDIT_EVENT_TYPES as readonly string[]).includes(o.type) &&
    typeof o.actor === "string" && o.actor.length > 0 &&
    (o.requestId === undefined || isHex32(o.requestId)) &&
    (o.policyHash === undefined || isHex32(o.policyHash)) &&
    typeof o.data === "object" && o.data !== null && !Array.isArray(o.data)
  );
}

/**
 * Re-derive every hash and link (SPEC 8.6). Pure: works on any array of parsed entries, so the web console
 * verifies the same way the CLI does. Reports the first failure.
 */
export function verifyEntries(entries: unknown[], options: { fromSeq?: number; trustedPrevHash?: string; anchoredHead?: { seq: number; hash: string } } = {}): VerifyReport {
  const from = options.fromSeq ?? 0;
  let prev = options.trustedPrevHash ?? GENESIS_HASH;
  let last: AuditEntry | undefined;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const seq = from + i;
    if (!shapeOk(e)) return { ok: false, entries: i, failure: { seq, reason: "bad_shape" } };
    if (e.seq !== seq) return { ok: false, entries: i, failure: { seq, reason: "bad_seq" } };
    if (e.prevHash !== prev) return { ok: false, entries: i, failure: { seq, reason: "bad_prev" } };
    let h: string;
    try {
      h = auditEntryHash(e);
    } catch {
      return { ok: false, entries: i, failure: { seq, reason: "bad_shape" } };
    }
    if (h !== e.hash) return { ok: false, entries: i, failure: { seq, reason: "bad_hash" } };
    prev = e.hash;
    last = e;
  }
  const head = last ? { seq: last.seq, hash: last.hash } : undefined;
  if (options.anchoredHead) {
    const a = options.anchoredHead;
    const at = entries[a.seq - from] as AuditEntry | undefined;
    if (!at || at.hash !== a.hash) return { ok: false, entries: entries.length, ...(head ? { head } : {}), failure: { seq: a.seq, reason: at ? "bad_hash" : "bad_seq" } };
  }
  return { ok: true, entries: entries.length, ...(head ? { head } : {}) };
}

export class AuditLog {
  readonly store: AuditStore;
  constructor(store: AuditStore) {
    this.store = store;
  }

  /** Build the next entry from the store head, hash it, append with expectedSeq. */
  async append(entry: NewAuditEntry, nowUnix: number): Promise<AuditEntry> {
    const head = await this.store.head();
    const seq = head ? head.seq + 1 : 0;
    const base: Omit<AuditEntry, "hash"> = {
      version: 1,
      seq,
      prevHash: head ? head.hash : GENESIS_HASH,
      at: entry.at ?? unixToIso(nowUnix),
      type: entry.type,
      actor: entry.actor,
      ...(entry.requestId !== undefined ? { requestId: entry.requestId } : {}),
      ...(entry.policyHash !== undefined ? { policyHash: entry.policyHash } : {}),
      data: entry.data,
    };
    const full: AuditEntry = { ...base, hash: auditEntryHash(base) };
    await this.store.append(full, seq);
    return full;
  }

  async readAll(): Promise<AuditEntry[]> {
    const out: AuditEntry[] = [];
    for (;;) {
      const page = await this.store.read(out.length, 1000);
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  /** Re-derive every hash and link from genesis (or from a trusted checkpoint). */
  async verify(options: { fromSeq?: number; trustedPrevHash?: string; anchoredHead?: { seq: number; hash: string } } = {}): Promise<VerifyReport> {
    const all = await this.readAll();
    return verifyEntries(all.slice(options.fromSeq ?? 0), options);
  }
}

/** In-memory store (tests, browser). Entries are copied in and out so callers cannot mutate the chain. */
export class MemoryAuditStore implements AuditStore {
  readonly #entries: AuditEntry[] = [];
  head(): Promise<{ seq: number; hash: string } | undefined> {
    const last = this.#entries[this.#entries.length - 1];
    return Promise.resolve(last ? { seq: last.seq, hash: last.hash } : undefined);
  }
  append(entry: AuditEntry, expectedSeq: number): Promise<void> {
    if (expectedSeq !== this.#entries.length || entry.seq !== expectedSeq) {
      return Promise.reject(new MkrError("MKR_E_AUDIT_APPEND_CONFLICT", `expected seq ${this.#entries.length}, got ${expectedSeq}`));
    }
    this.#entries.push(structuredClone(entry));
    return Promise.resolve();
  }
  read(fromSeq: number, limit: number): Promise<AuditEntry[]> {
    return Promise.resolve(structuredClone(this.#entries.slice(fromSeq, fromSeq + limit)));
  }
}
