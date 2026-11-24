// SPDX-License-Identifier: Apache-2.0
// Fail-closed PolicyDoc parser and validator (SPEC 2.4, 2.5). Pure: no I/O, no clock.
import { StrKey } from "@stellar/stellar-sdk";
import { MkrError } from "../errors.ts";
import type { ControlKind, PolicyDoc } from "./types.ts";

export interface PolicyViolation {
  /** JSON Pointer into the document. */
  path: string;
  code: string;
  message: string;
}

export const NETWORK_PASSPHRASES = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;

/** Largest i128 (2^127 - 1): the cap for every base-unit amount (SPEC 2.3). */
export const I128_MAX = (1n << 127n) - 1n;

/** SPEC 6.1: which contract functions can carry each control kind. */
export const CONTROL_KIND_FUNCTIONS: Record<ControlKind, string[]> = {
  freeze: ["freeze_partial_tokens", "set_address_frozen"],
  unfreeze: ["set_address_frozen", "unfreeze_partial_tokens"],
  forced_transfer: ["forced_transfer"],
  pause: ["pause"],
  unpause: ["unpause"],
};

const MAX_TEXT = 1024 * 1024;
const MAX_DEPTH = 32;

/** Placeholder for a value the tokenizer already rejected (null, float, unsafe integer). */
const BAD: unique symbol = Symbol("bad");

const ptr = (path: string, key: string | number) => `${path}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;

// ---------------------------------------------------------------------------------------------
// 1. Tokenizer: strict RFC 8259 JSON that reports duplicate keys, nulls, floats and unsafe ints.
// ---------------------------------------------------------------------------------------------

class SyntaxFail extends Error {}

function tokenize(text: string, out: PolicyViolation[]): unknown {
  let i = 0;
  const ws = () => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };
  const fail = (msg: string): never => {
    throw new SyntaxFail(`${msg} at offset ${i}`);
  };
  const value = (path: string, depth: number): unknown => {
    if (depth > MAX_DEPTH) fail("nesting too deep");
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      const seen = new Set<string>();
      ws();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail("expected string key");
        const k = str();
        ws();
        if (text[i] !== ":") fail("expected ':'");
        i++;
        const v = value(ptr(path, k), depth + 1);
        if (seen.has(k)) out.push({ path: ptr(path, k), code: "PD_DUPLICATE_KEY", message: `duplicate key "${k}"` });
        else {
          seen.add(k);
          // defineProperty so a "__proto__" key is data, never a prototype change.
          Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
        }
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return obj;
        }
        fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value(ptr(path, arr.length), depth + 1));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return arr;
        }
        fail("expected ',' or ']'");
      }
    }
    if (c === '"') return str();
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      out.push({ path, code: "PD_BAD_TYPE", message: "null is not allowed anywhere" });
      return BAD;
    }
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 400));
    if (!m) return fail("unexpected character");
    i += m[0].length;
    if (m[2] !== undefined || m[3] !== undefined) {
      out.push({ path, code: "PD_BAD_TYPE", message: "numbers must be integers (amounts are decimal strings)" });
      return BAD;
    }
    const n = Number(m[0]);
    if (!Number.isSafeInteger(n) || BigInt(m[0]) !== BigInt(n)) {
      out.push({ path, code: "PD_BAD_VALUE", message: "integer outside the safe range" });
      return BAD;
    }
    return Object.is(n, -0) ? 0 : n;
  };
  const str = (): string => {
    i++; // opening quote
    let s = "";
    for (;;) {
      if (i >= text.length) fail("unterminated string");
      const ch = text.charCodeAt(i);
      if (ch === 0x22) {
        i++;
        return s;
      }
      if (ch < 0x20) fail("control character in string");
      if (ch === 0x5c) {
        const e = text[i + 1];
        i += 2;
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e !== undefined && simple[e] !== undefined) s += simple[e];
        else if (e === "u") {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("bad \\u escape");
          s += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else fail("bad escape");
        continue;
      }
      s += text[i];
      i++;
    }
  };
  const v = value("", 0);
  ws();
  if (i !== text.length) fail("trailing characters");
  return v;
}

// ---------------------------------------------------------------------------------------------
// 2. Structural + semantic validation, collecting every violation.
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

class Checker {
  readonly v: PolicyViolation[] = [];
  add(path: string, code: string, message: string) {
    this.v.push({ path, code, message });
  }
  isBad(x: unknown) {
    return x === BAD;
  }
  obj(x: unknown, path: string, required: string[], optional: string[]): Obj | undefined {
    if (this.isBad(x)) return undefined;
    if (typeof x !== "object" || x === null || Array.isArray(x)) {
      this.add(path, "PD_BAD_TYPE", "expected an object");
      return undefined;
    }
    const o = x as Obj;
    for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) this.add(ptr(path, k), "PD_UNKNOWN_FIELD", `unknown field "${k}"`);
    for (const k of required) if (!(k in o)) this.add(ptr(path, k), "PD_MISSING_FIELD", `missing required field "${k}"`);
    return o;
  }
  arr(x: unknown, path: string, min: number, max: number): unknown[] | undefined {
    if (this.isBad(x) || x === undefined) return undefined;
    if (!Array.isArray(x)) {
      this.add(path, "PD_BAD_TYPE", "expected an array");
      return undefined;
    }
    if (x.length < min || x.length > max) this.add(path, "PD_BAD_VALUE", `expected ${min}..${max} items, got ${x.length}`);
    return x;
  }
  str(x: unknown, path: string, re?: RegExp, minLen = 0, maxLen = 1e9): string | undefined {
    if (this.isBad(x) || x === undefined) return undefined;
    if (typeof x !== "string") {
      this.add(path, "PD_BAD_TYPE", "expected a string");
      return undefined;
    }
    if (re && !re.test(x)) {
      this.add(path, "PD_BAD_VALUE", `does not match ${re.source}`);
      return undefined;
    }
    if (x.length < minLen || x.length > maxLen) {
      this.add(path, "PD_BAD_VALUE", `length must be ${minLen}..${maxLen}`);
      return undefined;
    }
    return x;
  }
  int(x: unknown, path: string, min: number, max: number): number | undefined {
    if (this.isBad(x) || x === undefined) return undefined;
    if (typeof x !== "number" || !Number.isInteger(x)) {
      this.add(path, "PD_BAD_TYPE", "expected an integer");
      return undefined;
    }
    if (x < min || x > max) {
      this.add(path, "PD_BAD_VALUE", `must be ${min}..${max}`);
      return undefined;
    }
    return x;
  }
  bool(x: unknown, path: string): boolean | undefined {
    if (this.isBad(x) || x === undefined) return undefined;
    if (typeof x !== "boolean") {
      this.add(path, "PD_BAD_TYPE", "expected a boolean");
      return undefined;
    }
    return x;
  }
  enumOf<T extends string>(x: unknown, path: string, allowed: readonly T[]): T | undefined {
    if (this.isBad(x) || x === undefined) return undefined;
    if (typeof x !== "string") {
      this.add(path, "PD_BAD_TYPE", "expected a string");
      return undefined;
    }
    if (!(allowed as readonly string[]).includes(x)) {
      this.add(path, "PD_BAD_ENUM", `"${x}" is not one of ${allowed.join(", ")}`);
      return undefined;
    }
    return x as T;
  }
  /** Sorted check. strict: also requires uniqueness (duplicates are a sort violation). */
  sorted(keys: (string | undefined)[], path: string, what: string, strict: boolean, order?: (a: string, b: string) => number) {
    const cmp = order ?? ((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1];
      const b = keys[i];
      if (a === undefined || b === undefined) continue;
      const c = cmp(a, b);
      if (c > 0 || (strict && c === 0)) {
        this.add(path, "PD_NOT_SORTED", `${what} must be sorted ascending${strict ? " and unique" : ""}`);
        return;
      }
    }
  }
}

const RE = {
  policyId: /^[a-z0-9][a-z0-9-]{1,63}$/,
  principalId: /^[a-z][a-z0-9_-]{1,63}$/,
  iso: /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/,
  fn: /^[A-Za-z_][A-Za-z0-9_]{0,31}$/,
  hhmm: /^([01][0-9]|2[0-3]):[0-5][0-9]$/,
  decimal: /^(0|[1-9][0-9]{0,38})$/,
  hex32: /^[0-9a-f]{64}$/,
  strkey: /^[A-Z2-7]{56,69}$/,
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const ROLES = ["admin", "checker", "maker"] as const;
const SCHEMES = ["host-asserted", "stellar-sep53"] as const;
const KINDS = ["forced_transfer", "freeze", "pause", "unfreeze", "unpause"] as const;

/** RFC 3339 UTC seconds -> unix seconds, or undefined if the calendar date does not exist. */
export function isoToUnix(s: string): number | undefined {
  if (!RE.iso.test(s)) return undefined;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return undefined;
  // Reject dates that Date.parse rolls over (2026-02-30 -> 2026-03-02).
  if (new Date(ms).toISOString().slice(0, 19) + "Z" !== s) return undefined;
  return ms / 1000;
}

export function unixToIso(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 19) + "Z";
}

function address(c: Checker, x: unknown, path: string, kinds: ("G" | "C")[]): string | undefined {
  const s = c.str(x, path, RE.strkey);
  if (s === undefined) return undefined;
  const ok = (kinds.includes("G") && StrKey.isValidEd25519PublicKey(s)) || (kinds.includes("C") && StrKey.isValidContract(s));
  if (!ok) {
    c.add(path, "PD_ADDRESS_INVALID", `not a valid ${kinds.join(" or ")} strkey${s.startsWith("M") ? " (muxed addresses are rejected in v1)" : ""}`);
    return undefined;
  }
  return s;
}

function decimal(c: Checker, x: unknown, path: string): string | undefined {
  const s = c.str(x, path, RE.decimal);
  if (s === undefined) return undefined;
  if (BigInt(s) > I128_MAX) {
    c.add(path, "PD_BAD_VALUE", "amount exceeds the i128 range");
    return undefined;
  }
  return s;
}

function stringList(c: Checker, x: unknown, path: string, min: number, max: number, each: (x: unknown, p: string) => string | undefined, what: string, order?: (a: string, b: string) => number): string[] {
  const a = c.arr(x, path, min, max);
  if (!a) return [];
  const vals = a.map((e, i) => each(e, ptr(path, i)));
  c.sorted(vals, path, what, true, order);
  return vals.filter((v): v is string => v !== undefined);
}

/** Semantic validation of an already-parsed value (same checks as parsePolicyDoc). */
export function validatePolicyDoc(value: unknown): PolicyViolation[] {
  const c = new Checker();
  const root = c.obj(value, "", ["version", "id", "name", "network", "validity", "principals", "separation", "requestTtlSeconds", "authEntryTtlLedgers", "rules"], ["supersedes"]);
  if (!root) return c.v;

  if (!c.isBad(root.version) && root.version !== undefined) {
    if (typeof root.version !== "number") c.add("/version", "PD_BAD_TYPE", "expected an integer");
    else if (root.version !== 1) c.add("/version", "PD_VERSION_UNSUPPORTED", `version ${root.version} is not supported (only 1)`);
  }
  c.str(root.id, "/id", RE.policyId);
  c.str(root.name, "/name", undefined, 1, 120);

  const net = c.obj(root.network, "/network", ["name", "passphrase"], []);
  if (net) {
    const name = c.enumOf(net.name, "/network/name", ["mainnet", "testnet"] as const);
    const pass = c.str(net.passphrase, "/network/passphrase", undefined, 1, 120);
    if (name && pass !== undefined && NETWORK_PASSPHRASES[name] !== pass) c.add("/network/passphrase", "PD_NETWORK_PASSPHRASE_MISMATCH", `passphrase does not match the well-known value for ${name}`);
  }

  const val = c.obj(root.validity, "/validity", ["notBefore", "expiresAt"], []);
  if (val) {
    const nb = c.str(val.notBefore, "/validity/notBefore", RE.iso);
    const ex = c.str(val.expiresAt, "/validity/expiresAt", RE.iso);
    const nbu = nb === undefined ? undefined : isoToUnix(nb);
    const exu = ex === undefined ? undefined : isoToUnix(ex);
    if (nb !== undefined && nbu === undefined) c.add("/validity/notBefore", "PD_BAD_VALUE", "not a real calendar time");
    if (ex !== undefined && exu === undefined) c.add("/validity/expiresAt", "PD_BAD_VALUE", "not a real calendar time");
    if (nbu !== undefined && exu !== undefined && exu <= nbu) c.add("/validity", "PD_VALIDITY_ORDER", "expiresAt must be after notBefore");
  }

  // Principals
  const roles = new Map<string, Set<string>>();
  const pArr = c.arr(root.principals, "/principals", 2, 200);
  if (pArr) {
    const ids: (string | undefined)[] = [];
    pArr.forEach((p, i) => {
      const path = ptr("/principals", i);
      const o = c.obj(p, path, ["id", "label", "roles", "attestation"], ["address"]);
      if (!o) {
        ids.push(undefined);
        return;
      }
      const id = c.str(o.id, path + "/id", RE.principalId);
      ids.push(id);
      c.str(o.label, path + "/label", undefined, 1, 120);
      const r = stringList(c, o.roles, path + "/roles", 1, 3, (x, pp) => c.enumOf(x, pp, ROLES), "roles");
      const att = stringList(c, o.attestation, path + "/attestation", 1, 2, (x, pp) => c.enumOf(x, pp, SCHEMES), "attestation");
      const addr = o.address === undefined ? undefined : address(c, o.address, path + "/address", ["G"]);
      if (att.includes("stellar-sep53") && o.address === undefined) c.add(path, "PD_SEP53_NEEDS_ADDRESS", "stellar-sep53 attestation requires an address");
      void addr;
      if (id !== undefined) {
        if (roles.has(id)) c.add(path + "/id", "PD_DUPLICATE_ID", `duplicate principal id "${id}"`);
        else roles.set(id, new Set(r));
      }
    });
    c.sorted(ids, "/principals", "principals (by id)", false);
  }

  const sep = c.obj(root.separation, "/separation", ["makerCannotSign"], []);
  if (sep) c.bool(sep.makerCannotSign, "/separation/makerCannotSign");
  c.int(root.requestTtlSeconds, "/requestTtlSeconds", 60, 2592000);
  c.int(root.authEntryTtlLedgers, "/authEntryTtlLedgers", 1, 17280);
  if (root.supersedes !== undefined) c.str(root.supersedes, "/supersedes", RE.hex32);

  const principalRefs = (x: unknown, path: string, role: string | undefined, min: number, max: number): string[] => {
    const ids = stringList(c, x, path, min, max, (e, p) => c.str(e, p, RE.principalId), "principal ids");
    ids.forEach((id) => {
      const r = roles.get(id);
      if (!r) c.add(path, "PD_UNKNOWN_PRINCIPAL", `"${id}" is not a declared principal`);
      else if (role && !r.has(role)) c.add(path, "PD_ROLE_MISSING", `"${id}" lacks the ${role} role`);
    });
    return ids;
  };

  // Rules
  const rArr = c.arr(root.rules, "/rules", 1, 200);
  if (rArr) {
    const ids: (string | undefined)[] = [];
    const seen = new Set<string>();
    rArr.forEach((r, i) => {
      const path = ptr("/rules", i);
      const o = c.obj(r, path, ["id", "effect", "match"], ["description", "makers", "approval", "limits", "windows", "cooldownSeconds"]);
      if (!o) {
        ids.push(undefined);
        return;
      }
      const id = c.str(o.id, path + "/id", RE.policyId);
      ids.push(id);
      if (id !== undefined) {
        if (seen.has(id)) c.add(path + "/id", "PD_DUPLICATE_ID", `duplicate rule id "${id}"`);
        seen.add(id);
      }
      const effect = c.enumOf(o.effect, path + "/effect", ["allow", "deny"] as const);
      if (o.description !== undefined) c.str(o.description, path + "/description", undefined, 0, 400);

      // match
      const targetFns = new Map<string, { names: Set<string>; amount: boolean }>();
      const m = c.obj(o.match, path + "/match", ["targets"], ["controlKinds"]);
      if (m) {
        const tArr = c.arr(m.targets, path + "/match/targets", 1, 50);
        if (tArr) {
          const contracts: (string | undefined)[] = [];
          tArr.forEach((t, ti) => {
            const tp = ptr(path + "/match/targets", ti);
            const to = c.obj(t, tp, ["contract", "functions"], []);
            if (!to) {
              contracts.push(undefined);
              return;
            }
            const contract = address(c, to.contract, tp + "/contract", ["C"]);
            contracts.push(contract);
            const info = { names: new Set<string>(), amount: false };
            const fArr = c.arr(to.functions, tp + "/functions", 1, 64);
            if (fArr) {
              const names: (string | undefined)[] = [];
              fArr.forEach((f, fi) => {
                const fp = ptr(tp + "/functions", fi);
                const fo = c.obj(f, fp, ["name"], ["amountArg", "recipientArg", "recipients"]);
                if (!fo) {
                  names.push(undefined);
                  return;
                }
                const name = c.str(fo.name, fp + "/name", RE.fn);
                names.push(name);
                if (name) info.names.add(name);
                if (fo.amountArg !== undefined && c.int(fo.amountArg, fp + "/amountArg", 0, 15) !== undefined) info.amount = true;
                if (fo.recipientArg !== undefined) c.int(fo.recipientArg, fp + "/recipientArg", 0, 15);
                if (fo.recipients !== undefined) {
                  stringList(c, fo.recipients, fp + "/recipients", 1, 500, (e, p) => address(c, e, p, ["G", "C"]), "recipients");
                  if (fo.recipientArg === undefined) c.add(fp, "PD_RECIPIENT_ARG_MISSING", "recipients requires recipientArg");
                }
              });
              c.sorted(names, tp + "/functions", "functions (by name)", true);
            }
            if (contract) targetFns.set(contract, info);
          });
          c.sorted(contracts, path + "/match/targets", "targets (by contract)", true);
        }
        if (m.controlKinds !== undefined) {
          const kinds = stringList(c, m.controlKinds, path + "/match/controlKinds", 1, 5, (e, p) => c.enumOf(e, p, KINDS), "controlKinds");
          for (const k of kinds) {
            const fns = CONTROL_KIND_FUNCTIONS[k as ControlKind];
            const has = [...targetFns.values()].some((t) => fns.some((f) => t.names.has(f)));
            if (!has) c.add(path + "/match/controlKinds", "PD_CONTROLKIND_FUNCTION_MISMATCH", `control kind ${k} needs one of ${fns.join(", ")} in targets`);
          }
        }
      }

      if (effect === "deny") {
        const extra = ["makers", "approval", "limits", "windows", "cooldownSeconds"].filter((k) => o[k] !== undefined);
        if (extra.length) c.add(path, "PD_DENY_HAS_ACTION_FIELDS", `deny rules must not carry ${extra.join(", ")}`);
        return;
      }
      if (effect === "allow" && (o.makers === undefined || o.approval === undefined)) c.add(path, "PD_ALLOW_NEEDS_APPROVAL", "allow rules need makers and approval");

      const makers = o.makers === undefined ? [] : principalRefs(o.makers, path + "/makers", "maker", 1, 100);
      if (o.approval !== undefined) {
        const ap = c.obj(o.approval, path + "/approval", ["checkers"], ["admins"]);
        if (ap) {
          const groups: { name: string; min?: number; from: string[] }[] = [];
          for (const [g, role] of [["checkers", "checker"], ["admins", "admin"]] as const) {
            if (ap[g] === undefined) continue;
            const gp = `${path}/approval/${g}`;
            const go = c.obj(ap[g], gp, ["min", "from"], []);
            if (!go) continue;
            const min = c.int(go.min, gp + "/min", 1, 50);
            const from = principalRefs(go.from, gp + "/from", role, 1, 100);
            if (min !== undefined && Array.isArray(go.from) && min > go.from.length) c.add(gp, "PD_MIN_EXCEEDS_FROM", `min ${min} exceeds the ${go.from.length} principals in from`);
            groups.push({ name: g, min, from });
          }
          if (groups.length === 2) {
            const overlap = groups[0]!.from.filter((x) => groups[1]!.from.includes(x));
            if (overlap.length) c.add(path + "/approval", "PD_GROUPS_OVERLAP", `checkers and admins share ${overlap.join(", ")}`);
          }
          // Dead rule: for every maker, the group without that maker (S1) cannot reach min.
          if (makers.length) {
            for (const g of groups) {
              if (g.min === undefined || g.from.length < g.min) continue;
              if (makers.every((mk) => g.from.filter((x) => x !== mk).length < g.min!)) c.add(`${path}/approval/${g.name}`, "PD_DEAD_RULE", `no request can reach min ${g.min} once the maker is excluded (S1)`);
            }
          }
        }
      }

      if (o.limits !== undefined) {
        const lp = path + "/limits";
        const lo = c.obj(o.limits, lp, [], ["perRequest", "rolling"]);
        if (lo) {
          const checkContract = (x: unknown, p: string) => {
            const ct = address(c, x, p, ["C"]);
            if (!ct) return;
            const t = targetFns.get(ct);
            if (!t) c.add(p, "PD_LIMIT_CONTRACT_NOT_TARGETED", "limit contract is not in match.targets");
            else if (!t.amount) c.add(p, "PD_AMOUNT_ARG_MISSING", "no function of this contract declares amountArg");
          };
          const pr = c.arr(lo.perRequest, lp + "/perRequest", 1, 50);
          pr?.forEach((e, k) => {
            const ep = ptr(lp + "/perRequest", k);
            const eo = c.obj(e, ep, ["contract", "max"], []);
            if (!eo) return;
            checkContract(eo.contract, ep + "/contract");
            decimal(c, eo.max, ep + "/max");
          });
          const ro = c.arr(lo.rolling, lp + "/rolling", 1, 50);
          ro?.forEach((e, k) => {
            const ep = ptr(lp + "/rolling", k);
            const eo = c.obj(e, ep, ["contract", "windowSeconds", "max"], []);
            if (!eo) return;
            checkContract(eo.contract, ep + "/contract");
            c.int(eo.windowSeconds, ep + "/windowSeconds", 60, 2592000);
            decimal(c, eo.max, ep + "/max");
          });
        }
      }

      if (o.windows !== undefined) {
        const wArr = c.arr(o.windows, path + "/windows", 1, 14);
        wArr?.forEach((w, wi) => {
          const wp = ptr(path + "/windows", wi);
          const wo = c.obj(w, wp, ["days", "startUtc", "endUtc"], []);
          if (!wo) return;
          stringList(c, wo.days, wp + "/days", 1, 7, (e, p) => c.enumOf(e, p, DAYS), "days (calendar order)", (a, b) => DAYS.indexOf(a as never) - DAYS.indexOf(b as never));
          const s = c.str(wo.startUtc, wp + "/startUtc", RE.hhmm);
          const e = c.str(wo.endUtc, wp + "/endUtc", RE.hhmm);
          if (s !== undefined && e !== undefined && s >= e) c.add(wp, "PD_WINDOW_ORDER", "startUtc must be before endUtc (no overnight windows in v1)");
        });
      }
      if (o.cooldownSeconds !== undefined) c.int(o.cooldownSeconds, path + "/cooldownSeconds", 0, 2592000);
    });
    c.sorted(ids, "/rules", "rules (by id)", false);
  }
  return c.v;
}

/**
 * Strict, fail-closed parse of PolicyDoc JSON text (SPEC section 2.4): rejects duplicate keys, null,
 * floats, unsafe integers, unknown fields, unknown enum values, non-canonical ordering, and every
 * semantic violation listed in SPEC section 2.5, collecting all of them.
 */
export function parsePolicyDoc(jsonText: string): { doc: PolicyDoc } | { violations: PolicyViolation[] } {
  if (jsonText.length > MAX_TEXT) return { violations: [{ path: "", code: "PD_BAD_VALUE", message: "document larger than 1 MiB" }] };
  const violations: PolicyViolation[] = [];
  let value: unknown;
  try {
    value = tokenize(jsonText.replace(/^﻿/, ""), violations);
  } catch (e) {
    if (e instanceof SyntaxFail) return { violations: [{ path: "", code: "PD_SYNTAX", message: e.message }] };
    throw e;
  }
  violations.push(...validatePolicyDoc(value));
  if (violations.length > 0) return { violations };
  return { doc: value as PolicyDoc };
}

/** Throwing convenience for callers that need a document or an MkrError. */
export function requirePolicyDoc(jsonText: string): PolicyDoc {
  const r = parsePolicyDoc(jsonText);
  if ("doc" in r) return r.doc;
  const first = r.violations[0];
  throw new MkrError("MKR_E_POLICY_INVALID", `policy invalid: ${r.violations.length} violation(s); first ${first?.code} at ${first?.path || "/"}`, { violations: r.violations });
}
