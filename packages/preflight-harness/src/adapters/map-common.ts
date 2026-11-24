// SPDX-License-Identifier: Apache-2.0
// Shared pieces of the three output mappers: code lookup with disambiguation, scope routing, verdict assembly.
import { REASON_CODES } from "../taxonomy/codes.ts";
import type { ReasonCode, Severity } from "../taxonomy/codes.ts";
import { mapLibraryCode } from "../taxonomy/library-maps.ts";
import type { AdapterId } from "../taxonomy/library-maps.ts";
import type { Party, ReasonEntry, ReceiveVerdict } from "../types.ts";
import { deriveVerdict } from "../verdict/derive.ts";

export interface LibraryReason {
  libraryCode: string;
  severity: Severity;
  party: Party;
  message?: string;
}

/**
 * Map one library reason. `choose` picks among several candidates (SPEC 3.2 disambiguation); it must return one
 * of the candidates. Returns undefined when the library code is not in the inventory (unmapped).
 */
export function mapReason(adapterId: AdapterId, reason: LibraryReason, choose?: (candidates: readonly ReasonCode[]) => ReasonCode): ReasonEntry | undefined {
  const candidates = mapLibraryCode(adapterId, reason.libraryCode);
  if (!candidates || candidates.length === 0) return undefined;
  const picked = candidates.length === 1 || !choose ? candidates[0]! : choose(candidates);
  if (!candidates.includes(picked)) throw new Error(`${adapterId}/${reason.libraryCode}: chose ${picked}, not a candidate`);
  const entry: ReasonEntry = { code: picked, severity: reason.severity, party: reason.party, libraryCode: reason.libraryCode };
  if (reason.message !== undefined) entry.message = reason.message;
  return entry;
}

/** Assemble a verdict: receive/meta reasons in `reasons`, sender-scope reasons in `senderSide`, class derived. */
export function assembleVerdict(args: {
  adapterId: AdapterId;
  adapterVersion: string;
  caseId: string;
  entries: ReasonEntry[];
  unmapped: string[];
  libraryStatus: string;
  raw: unknown;
  error?: ReceiveVerdict["error"];
}): ReceiveVerdict {
  const reasons = args.entries.filter((e) => REASON_CODES[e.code].scope !== "sender");
  const senderSide = args.entries.filter((e) => REASON_CODES[e.code].scope === "sender");
  const verdict: ReceiveVerdict = {
    schema: "sik.receive-verdict/1",
    adapterId: args.adapterId,
    adapterVersion: args.adapterVersion,
    caseId: args.caseId,
    verdict: deriveVerdict(reasons, args.error),
    reasons,
    senderSide,
    unmapped: args.unmapped,
    libraryStatus: args.libraryStatus,
    raw: args.raw,
  };
  if (args.error) verdict.error = args.error;
  return verdict;
}

/** JSON-safe deep copy: bigint -> decimal string, undefined dropped, listed keys removed at any depth. */
export function jsonSafe(value: unknown, dropKeys: ReadonlySet<string> = new Set()): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v, dropKeys));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (dropKeys.has(k) || v === undefined || typeof v === "function") continue;
      out[k] = jsonSafe(v, dropKeys);
    }
    return out;
  }
  return value;
}

/** A verdict for an adapter that could not run at all (unavailable, or the library threw). */
export function errorVerdict(adapterId: AdapterId, adapterVersion: string, caseId: string, kind: NonNullable<ReceiveVerdict["error"]>["kind"], message: string): ReceiveVerdict {
  return assembleVerdict({ adapterId, adapterVersion, caseId, entries: [], unmapped: [], libraryStatus: kind, raw: null, error: { kind, message } });
}
