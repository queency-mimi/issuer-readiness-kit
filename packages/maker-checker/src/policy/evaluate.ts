// SPDX-License-Identifier: Apache-2.0
// Policy evaluation (SPEC section 4). Pure, total, deterministic; deny by default. No I/O, no clock.
import type { Hex32 } from "../hash.ts";
import type { ScValJson } from "../workflow/types.ts";
import { isoToUnix } from "./parse.ts";
import type { ControlKind, DecimalString, FunctionRule, PolicyDoc, PrincipalId, Rule, StellarAddress, TimeWindow } from "./types.ts";

export type DenyReason =
  | "POLICY_NOT_YET_VALID"
  | "POLICY_EXPIRED"
  | "NETWORK_MISMATCH"
  | "MAKER_UNKNOWN"
  | "MAKER_NOT_MAKER_ROLE"
  | "NO_MATCHING_ALLOW_RULE"
  | "DENY_RULE_MATCHED"
  | "MAKER_NOT_PERMITTED_BY_RULE"
  | "CONTRACT_NOT_ALLOWED"
  | "FUNCTION_NOT_ALLOWED"
  | "RECIPIENT_NOT_ALLOWED"
  | "AMOUNT_ARG_UNDECODABLE"
  | "PER_REQUEST_LIMIT_EXCEEDED"
  | "ROLLING_LIMIT_EXCEEDED"
  | "OUTSIDE_TIME_WINDOW"
  | "CONTROL_KIND_NOT_ALLOWED"
  | "NESTED_CALL_NOT_ALLOWED";

type ContractId = string;

/** One authorised call in the invocation tree (root and every sub-invocation that needs auth). */
export interface InvocationNode {
  depth: number;
  contract: ContractId;
  function: string;
  /** Typed arguments. When present, amount and recipient are read from them per the matching FunctionRule. */
  args?: ScValJson[];
  /** Pre-decoded amount (base units), used only when `args` is absent. */
  amount?: DecimalString;
  /** Pre-decoded recipient, used only when `args` is absent. */
  recipient?: StellarAddress;
  /** Address that must authorise this node. */
  authorizer: StellarAddress;
}

export interface EvaluationInput {
  policy: PolicyDoc;
  policyHash: Hex32;
  maker: PrincipalId;
  networkPassphrase: string;
  /** Flattened tree, root first. Every node is checked (SPEC section 4.3). */
  nodes: InvocationNode[];
  controlKind?: ControlKind;
  /** Evaluation time, UTC seconds. Injected so evaluation is pure. */
  nowUnix: number;
  /** Approved-or-later spend in the rolling windows, supplied by the caller from the audit projection. */
  priorSpend: { contract: ContractId; windowSeconds: number; total: DecimalString }[];
}

export interface MergedRequirement {
  checkersMin: number;
  checkersFrom: PrincipalId[];
  adminsMin: number;
  adminsFrom: PrincipalId[];
  cooldownSeconds: number;
  /** Empty means "any time". */
  windows: { days: string[]; startUtc: string; endUtc: string }[];
}

export interface PolicyDecision {
  outcome: "allow" | "deny";
  policyHash: Hex32;
  matchedRuleIds: string[];
  reasons: DenyReason[];
  /** Rule-level detail for operators: why each candidate rule was dropped. Stable codes only. */
  dropped?: { ruleId: string; reason: DenyReason }[];
  /** Per-contract amounts this request moves (base units), for rolling-spend accounting. */
  amounts?: { contract: ContractId; total: DecimalString }[];
  /** Present when outcome is allow: the merged requirement (SPEC section 4.4). */
  requirement?: MergedRequirement;
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Decode a non-negative integer amount from a typed ScVal; undefined if it is not one (fail closed). */
export function decodeAmount(v: ScValJson | undefined): bigint | undefined {
  if (!v) return undefined;
  if (v.type === "u32" || v.type === "i32") return v.value >= 0 ? BigInt(v.value) : undefined;
  if (v.type === "u64" || v.type === "i64" || v.type === "u128" || v.type === "i128" || v.type === "u256" || v.type === "i256") {
    if (!/^(0|[1-9][0-9]*)$/.test(v.value)) return undefined;
    return BigInt(v.value);
  }
  return undefined;
}

function nodeRecipient(node: InvocationNode, fr: FunctionRule): string | undefined {
  if (fr.recipientArg === undefined) return undefined;
  if (node.args) {
    const a = node.args[fr.recipientArg];
    return a && a.type === "address" ? a.value : undefined;
  }
  return node.recipient;
}

function nodeAmount(node: InvocationNode, fr: FunctionRule): bigint | undefined | "bad" {
  if (fr.amountArg === undefined) return undefined;
  if (node.args) {
    const a = decodeAmount(node.args[fr.amountArg]);
    return a === undefined ? "bad" : a;
  }
  if (node.amount === undefined || !/^(0|[1-9][0-9]*)$/.test(node.amount)) return "bad";
  return BigInt(node.amount);
}

type Cover = { ok: true; fr: FunctionRule } | { ok: false; reason: DenyReason };

function coverNode(rule: Rule, node: InvocationNode): Cover {
  const target = rule.match.targets.find((t) => t.contract === node.contract);
  if (!target) return { ok: false, reason: "CONTRACT_NOT_ALLOWED" };
  const fr = target.functions.find((f) => f.name === node.function);
  if (!fr) return { ok: false, reason: "FUNCTION_NOT_ALLOWED" };
  if (fr.recipients) {
    const r = nodeRecipient(node, fr);
    if (r === undefined || !fr.recipients.includes(r)) return { ok: false, reason: "RECIPIENT_NOT_ALLOWED" };
  }
  return { ok: true, fr };
}

function controlKindOk(rule: Rule, kind: ControlKind | undefined): boolean {
  if (!rule.match.controlKinds) return true;
  return kind !== undefined && rule.match.controlKinds.includes(kind);
}

function minutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}
function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Intersection of two window sets; undefined means "always" (a rule without windows). */
function intersectWindows(a: TimeWindow[] | undefined, b: TimeWindow[] | undefined): TimeWindow[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const out: TimeWindow[] = [];
  for (const x of a)
    for (const y of b) {
      const days = x.days.filter((d) => y.days.includes(d));
      const s = Math.max(minutes(x.startUtc), minutes(y.startUtc));
      const e = Math.min(minutes(x.endUtc), minutes(y.endUtc));
      if (days.length && s < e) out.push({ days, startUtc: hhmm(s), endUtc: hhmm(e) });
    }
  return out;
}

/** True if `nowUnix` falls inside one of the windows (start inclusive, end exclusive, UTC). Empty = always. */
export function insideWindows(windows: { days: string[]; startUtc: string; endUtc: string }[], nowUnix: number): boolean {
  if (windows.length === 0) return true;
  const d = new Date(nowUnix * 1000);
  const day = DAY_ORDER[(d.getUTCDay() + 6) % 7]!;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return windows.some((w) => w.days.includes(day) && m >= minutes(w.startUtc) && m < minutes(w.endUtc));
}

const uniqSorted = <T extends string>(xs: T[]) => [...new Set(xs)].sort();

/** Pure, total, deterministic. Deny by default (SPEC section 4). */
export function evaluate(input: EvaluationInput): PolicyDecision {
  const { policy, policyHash, nowUnix } = input;
  const deny = (reasons: DenyReason[], extra: Partial<PolicyDecision> = {}): PolicyDecision => ({
    outcome: "deny",
    policyHash,
    matchedRuleIds: [],
    reasons: uniqSorted(reasons),
    ...extra,
  });

  // 1. validity and network
  const nb = isoToUnix(policy.validity.notBefore);
  const ex = isoToUnix(policy.validity.expiresAt);
  if (nb === undefined || ex === undefined) return deny(["POLICY_NOT_YET_VALID"]);
  if (nowUnix < nb) return deny(["POLICY_NOT_YET_VALID"]);
  if (nowUnix >= ex) return deny(["POLICY_EXPIRED"]);
  if (input.networkPassphrase !== policy.network.passphrase) return deny(["NETWORK_MISMATCH"]);

  // 2. maker
  const maker = policy.principals.find((p) => p.id === input.maker);
  if (!maker) return deny(["MAKER_UNKNOWN"]);
  if (!maker.roles.includes("maker")) return deny(["MAKER_NOT_MAKER_ROLE"]);
  if (input.nodes.length === 0) return deny(["NO_MATCHING_ALLOW_RULE"]);

  // 4. deny rules: any covered node denies the whole request (order-independent).
  const denyHits = policy.rules
    .filter((r) => r.effect === "deny" && controlKindOk(r, input.controlKind) && input.nodes.some((n) => coverNode(r, n).ok))
    .map((r) => r.id)
    .sort();
  if (denyHits.length) return deny(["DENY_RULE_MATCHED"], { matchedRuleIds: denyHits });

  // 3. allow rules covering every node. When none match, report the most specific miss across rules
  // (contract < function < recipient < control kind) so the operator sees the nearest rule's reason.
  const RANK: Partial<Record<DenyReason, number>> = { CONTRACT_NOT_ALLOWED: 1, FUNCTION_NOT_ALLOWED: 2, RECIPIENT_NOT_ALLOWED: 3, CONTROL_KIND_NOT_ALLOWED: 4 };
  const dropped: { ruleId: string; reason: DenyReason }[] = [];
  let best: { reason: DenyReason; nested: boolean } | undefined;
  const candidates: { rule: Rule; covers: FunctionRule[] }[] = [];
  for (const rule of policy.rules) {
    if (rule.effect !== "allow") continue;
    const covers: FunctionRule[] = [];
    let miss: { reason: DenyReason; nested: boolean } | undefined;
    for (const n of input.nodes) {
      const c = coverNode(rule, n);
      if (c.ok) covers.push(c.fr);
      else {
        miss = { reason: c.reason, nested: n.depth > 0 && covers.length > 0 };
        break;
      }
    }
    if (!miss && !controlKindOk(rule, input.controlKind)) miss = { reason: "CONTROL_KIND_NOT_ALLOWED", nested: false };
    if (miss) {
      dropped.push({ ruleId: rule.id, reason: miss.reason });
      if (!best || (RANK[miss.reason] ?? 0) > (RANK[best.reason] ?? 0)) best = { ...miss };
      else if (RANK[miss.reason] === RANK[best.reason]) best.nested ||= miss.nested; // ties merge: order-independent
      continue;
    }
    candidates.push({ rule, covers });
  }
  if (candidates.length === 0) {
    const extra: DenyReason[] = best ? [best.reason, ...(best.nested ? (["NESTED_CALL_NOT_ALLOWED"] as DenyReason[]) : [])] : [];
    return deny(["NO_MATCHING_ALLOW_RULE", ...extra], { dropped: sortDropped(dropped) });
  }

  // 5. maker permitted by the rule
  const permitted = candidates.filter((c) => {
    const ok = (c.rule.makers ?? []).includes(input.maker);
    if (!ok) dropped.push({ ruleId: c.rule.id, reason: "MAKER_NOT_PERMITTED_BY_RULE" });
    return ok;
  });
  if (permitted.length === 0) return deny(["NO_MATCHING_ALLOW_RULE", "MAKER_NOT_PERMITTED_BY_RULE"], { dropped: sortDropped(dropped) });

  // 6. limits per rule (amounts summed per contract over all nodes, decoded by the covering FunctionRule)
  const survivors: { rule: Rule; amounts: Map<string, bigint> }[] = [];
  const limitReasons: DenyReason[] = [];
  for (const c of permitted) {
    const amounts = new Map<string, bigint>();
    let bad = false;
    input.nodes.forEach((n, i) => {
      const a = nodeAmount(n, c.covers[i]!);
      if (a === "bad") bad = true;
      else if (a !== undefined) amounts.set(n.contract, (amounts.get(n.contract) ?? 0n) + a);
    });
    let reason: DenyReason | undefined;
    if (bad) reason = "AMOUNT_ARG_UNDECODABLE";
    for (const l of c.rule.limits?.perRequest ?? []) if (!reason && (amounts.get(l.contract) ?? 0n) > BigInt(l.max)) reason = "PER_REQUEST_LIMIT_EXCEEDED";
    for (const l of c.rule.limits?.rolling ?? []) {
      if (reason) break;
      const prior = input.priorSpend.find((p) => p.contract === l.contract && p.windowSeconds === l.windowSeconds);
      const priorTotal = prior && /^(0|[1-9][0-9]*)$/.test(prior.total) ? BigInt(prior.total) : prior ? undefined : 0n;
      if (priorTotal === undefined) reason = "AMOUNT_ARG_UNDECODABLE";
      else if (priorTotal + (amounts.get(l.contract) ?? 0n) > BigInt(l.max)) reason = "ROLLING_LIMIT_EXCEEDED";
    }
    if (reason) {
      dropped.push({ ruleId: c.rule.id, reason });
      limitReasons.push(reason);
    } else survivors.push({ rule: c.rule, amounts });
  }
  if (survivors.length === 0) return deny(limitReasons, { dropped: sortDropped(dropped) });

  // 7. merge (SPEC 4.4): max of mins, union of from sets, max cooldown, intersection of windows.
  let windows: TimeWindow[] | undefined;
  let checkersMin = 0;
  let adminsMin = 0;
  let cooldownSeconds = 0;
  const checkersFrom = new Set<string>();
  const adminsFrom = new Set<string>();
  for (const s of survivors) {
    const ap = s.rule.approval!;
    checkersMin = Math.max(checkersMin, ap.checkers.min);
    ap.checkers.from.forEach((x) => checkersFrom.add(x));
    if (ap.admins) {
      adminsMin = Math.max(adminsMin, ap.admins.min);
      ap.admins.from.forEach((x) => adminsFrom.add(x));
    }
    cooldownSeconds = Math.max(cooldownSeconds, s.rule.cooldownSeconds ?? 0);
    windows = intersectWindows(windows, s.rule.windows);
  }
  const matchedRuleIds = survivors.map((s) => s.rule.id).sort();
  if (windows !== undefined && windows.length === 0) return deny(["OUTSIDE_TIME_WINDOW"], { matchedRuleIds, dropped: sortDropped(dropped) });
  // S1: the maker can never count, so the reachable set excludes them.
  const reach = (from: Set<string>) => [...from].filter((x) => x !== input.maker).length;
  if (reach(checkersFrom) < checkersMin || reach(adminsFrom) < adminsMin) return deny(["NO_MATCHING_ALLOW_RULE"], { matchedRuleIds, dropped: sortDropped(dropped) });

  const amounts = new Map<string, bigint>();
  for (const s of survivors) for (const [k, v] of s.amounts) amounts.set(k, v > (amounts.get(k) ?? 0n) ? v : (amounts.get(k) ?? 0n));
  const normWindows = (windows ?? [])
    .map((w) => ({ days: [...w.days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)), startUtc: w.startUtc, endUtc: w.endUtc }))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return {
    outcome: "allow",
    policyHash,
    matchedRuleIds,
    reasons: [],
    ...(dropped.length ? { dropped: sortDropped(dropped) } : {}),
    amounts: [...amounts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([contract, total]) => ({ contract, total: total.toString() })),
    requirement: {
      checkersMin,
      checkersFrom: [...checkersFrom].sort(),
      adminsMin,
      adminsFrom: [...adminsFrom].sort(),
      cooldownSeconds,
      windows: normWindows,
    },
  };
}

function sortDropped(d: { ruleId: string; reason: DenyReason }[]) {
  return [...d].sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : a.reason < b.reason ? -1 : 1));
}
