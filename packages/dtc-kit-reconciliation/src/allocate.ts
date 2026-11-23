// SPDX-License-Identifier: Apache-2.0
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { AllocationInput, AllocationLine, AllocationPlan } from "./types.ts";
import { HOUSE_SUBLEDGER } from "./types.ts";

export class AllocationRefused extends Error {
  readonly code: "UNMAPPED_WALLET" | "CREDIT_WITHOUT_POSITIONS" | "CLIENT_ID_UNKNOWN";
  /** The wallet address or client id the refusal is about. */
  readonly subject: string;

  constructor(code: AllocationRefused["code"], detail: string, subject = "") {
    super(`${code}: ${detail}`);
    this.name = "AllocationRefused";
    this.code = code;
    this.subject = subject;
  }
}

/** Canonical JSON: keys sorted, bigints as decimal strings, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** SHA-256 (audited @noble/hashes, G-CRYPTO) of a string, hex. Synchronous, so it runs in Node and browsers. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/**
 * Allocate one consolidated cash credit to client sub-ledgers (SPEC 6.1, DTC-033).
 *
 *  1. Group positions by sub-ledger through the participant's WalletMapping (client wallet -> clientId,
 *     internal wallet -> HOUSE). An unmapped address with tokens refuses (UNMAPPED_WALLET); a client id
 *     absent from the books refuses (CLIENT_ID_UNKNOWN). Never guess.
 *  2. T = total tokens. T = 0: credit 0 -> empty plan; credit > 0 -> CREDIT_WITHOUT_POSITIONS.
 *  3. share_i = floor(credit * t_i / T), remainder_i = (credit * t_i) mod T, bigint only.
 *  4. leftover = credit - sum(share_i): one minor unit each to the `leftover` sub-ledgers with the largest
 *     remainder, ties by sub-ledger id ascending.
 *  5. Lines sorted by sub-ledger id; checksum = SHA-256 of canonical JSON of {eventId, credit, lines}.
 * Invariants (tested on 10,000 seeded cases): sum == credit, amounts >= 0, input order does not matter.
 */
export function allocateConsolidatedCredit(input: AllocationInput): AllocationPlan {
  const { books, credit } = input;
  const mapping = new Map(books.wallets.map((w) => [w.address, w]));
  const clients = new Set(books.clients.map((c) => c.clientId));
  const groups = new Map<string, { tokens: bigint; wallets: Set<string> }>();
  const unmapped: string[] = [];
  for (const p of input.positions) {
    if (p.tokens === 0n) continue;
    if (p.tokens < 0n) throw new Error(`negative position at ${p.address}`);
    const m = mapping.get(p.address);
    if (!m) {
      unmapped.push(p.address);
      continue;
    }
    let sub: string;
    if (m.kind === "internal") sub = HOUSE_SUBLEDGER;
    else {
      if (!m.clientId || !clients.has(m.clientId)) throw new AllocationRefused("CLIENT_ID_UNKNOWN", `wallet ${p.address} maps to client ${m.clientId ?? "(none)"} which is not in the books`, m.clientId ?? p.address);
      sub = m.clientId;
    }
    const g = groups.get(sub) ?? { tokens: 0n, wallets: new Set<string>() };
    g.tokens += p.tokens;
    g.wallets.add(p.address);
    groups.set(sub, g);
  }
  if (unmapped.length > 0) {
    const sorted = [...new Set(unmapped)].sort();
    throw new AllocationRefused("UNMAPPED_WALLET", `${sorted.join(", ")} hold tokens but are not in the participant's books`, sorted[0]);
  }
  const ids = [...groups.keys()].sort();
  const total = ids.reduce((s, id) => s + (groups.get(id)?.tokens ?? 0n), 0n);
  if (total === 0n && credit.amount > 0n) throw new AllocationRefused("CREDIT_WITHOUT_POSITIONS", `credit ${credit.amount} with no positions at capture`);
  if (credit.amount < 0n) throw new Error("negative credit");

  const work = ids.map((id) => {
    const g = groups.get(id) as { tokens: bigint; wallets: Set<string> };
    const num = credit.amount * g.tokens;
    return { id, tokens: g.tokens, wallets: [...g.wallets].sort(), share: total === 0n ? 0n : num / total, rem: total === 0n ? 0n : num % total };
  });
  let leftover = credit.amount - work.reduce((s, w) => s + w.share, 0n);
  const byRemainder = [...work].sort((a, b) => (a.rem === b.rem ? (a.id < b.id ? -1 : 1) : a.rem > b.rem ? -1 : 1));
  const bonus = new Set<string>();
  for (const w of byRemainder) {
    if (leftover <= 0n) break;
    bonus.add(w.id);
    leftover -= 1n;
  }
  const lines: AllocationLine[] = work.map((w) => ({ subLedger: w.id, tokens: w.tokens, amount: w.share + (bonus.has(w.id) ? 1n : 0n), wallets: w.wallets }));
  const checksum = sha256Hex(canonicalJson({ eventId: credit.eventId, credit: credit.amount, lines }));
  return { eventId: credit.eventId, credit: credit.amount, totalTokens: total, rounding: "largest-remainder", lines, unmappedWallets: [], checksum, trust: input.trust };
}
