// SPDX-License-Identifier: Apache-2.0
// SEP-57 control-action builders (SPEC 6). Pure: validate, build typed args, render the clear-signing summary.
import { StrKey } from "@stellar/stellar-sdk";
import { MkrError } from "../errors.ts";
import { I128_MAX } from "../policy/parse.ts";
import type { ControlKind } from "../policy/types.ts";
import type { ClearSigningSummary, Intent, ScValJson } from "../workflow/types.ts";

/**
 * SEP-57 v0.4.0 (Draft) function names [P: stellar-protocol ecosystem/sep-0057.md, read 2026-10-31].
 * The same names and argument order are used by OpenZeppelin stellar-tokens 0.7.1 `RWAToken`
 * [P: crate source in the local cargo registry, read 2026-11-08], which the testnet demo token wraps.
 */
export const SEP57_FUNCTIONS = {
  freeze: "set_address_frozen",
  freezePartial: "freeze_partial_tokens",
  unfreeze: "set_address_frozen",
  unfreezePartial: "unfreeze_partial_tokens",
  forcedTransfer: "forced_transfer",
  pause: "pause",
  unpause: "unpause",
} as const;

export type ControlActionParams =
  | { kind: "freeze"; token: string; operator: string; userAddress: string; amount?: string; decimals?: number }
  | { kind: "unfreeze"; token: string; operator: string; userAddress: string; amount?: string; decimals?: number }
  | { kind: "forced_transfer"; token: string; operator: string; from: string; to: string; amount: string; decimals?: number; allowedRecipients?: string[] }
  | { kind: "pause" | "unpause"; token: string; caller: string };

export interface BuiltControlAction {
  controlKind: ControlKind;
  /** The contract function and typed args; the maker never supplies these directly. */
  function: string;
  args: ScValJson[];
  intent: Pick<Intent, "contract" | "function" | "args">;
  summary: ClearSigningSummary;
  /** Policy-relevant facts the evaluator needs (amount arg index etc.). */
  amountArg?: number;
  recipientArg?: number;
  /** The address whose require_auth the call triggers (operator or caller). */
  authorizer: string;
}

const usage = (m: string): never => {
  throw new MkrError("MKR_E_USAGE", m);
};

function account(a: unknown, what: string): string {
  if (typeof a !== "string" || !(StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a))) usage(`${what} must be a valid G or C address (muxed M addresses are rejected)`);
  return a as string;
}

function amountOf(a: unknown): string {
  if (typeof a !== "string" || !/^[1-9][0-9]*$/.test(a)) usage("amount must be a positive base-unit integer string");
  if (BigInt(a as string) > I128_MAX) usage("amount exceeds i128");
  return a as string;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}

export function formatUnits(base: string, decimals?: number): string {
  if (decimals === undefined) return `${base} base units`;
  const s = base.padStart(decimals + 1, "0");
  return `${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)} units`;
}

const addr = (value: string): ScValJson => ({ type: "address", value });

/**
 * Policy-checked action builder: validates addresses and amount shape, produces the typed invocation and the
 * clear-signing summary. Does not simulate and does not sign.
 */
export function buildControlAction(params: ControlActionParams): BuiltControlAction {
  if (typeof params.token !== "string" || !StrKey.isValidContract(params.token)) usage("token must be a C contract address");
  const token = params.token;
  const warnings: string[] = [];
  let fn: string;
  let args: ScValJson[];
  let headline: string;
  let authorizer: string;
  const facts: [string, string][] = [["token", token]];
  let amountArg: number | undefined;
  let recipientArg: number | undefined;

  switch (params.kind) {
    case "freeze":
    case "unfreeze": {
      const op = account(params.operator, "operator");
      const user = account(params.userAddress, "userAddress");
      authorizer = op;
      const verb = params.kind === "freeze" ? "FREEZE" : "UNFREEZE";
      if (params.amount !== undefined) {
        const amt = amountOf(params.amount);
        fn = params.kind === "freeze" ? SEP57_FUNCTIONS.freezePartial : SEP57_FUNCTIONS.unfreezePartial;
        args = [addr(user), { type: "i128", value: amt }, addr(op)];
        amountArg = 1;
        headline = `${verb} ${formatUnits(amt, params.decimals)} of ${shortAddr(user)} on token ${shortAddr(token)} (operator ${shortAddr(op)})`;
        facts.push(["amount", formatUnits(amt, params.decimals)]);
      } else {
        fn = SEP57_FUNCTIONS.freeze;
        args = [addr(user), { type: "bool", value: params.kind === "freeze" }, addr(op)];
        headline = `${verb} all balances of ${shortAddr(user)} on token ${shortAddr(token)} (operator ${shortAddr(op)})`;
      }
      facts.push(["user", user], ["operator", op]);
      if (user === op) warnings.push(`the ${params.kind} targets the operator itself`);
      break;
    }
    case "forced_transfer": {
      const op = account(params.operator, "operator");
      const from = account(params.from, "from");
      const to = account(params.to, "to");
      if (from === to) usage("forced_transfer from and to must differ");
      const amt = amountOf(params.amount);
      authorizer = op;
      fn = SEP57_FUNCTIONS.forcedTransfer;
      args = [addr(from), addr(to), { type: "i128", value: amt }, addr(op)];
      amountArg = 2;
      recipientArg = 1;
      headline = `FORCED TRANSFER ${formatUnits(amt, params.decimals)} from ${shortAddr(from)} to ${shortAddr(to)} on token ${shortAddr(token)} (operator ${shortAddr(op)})`;
      facts.push(["from", from], ["to", to], ["amount", formatUnits(amt, params.decimals)], ["operator", op]);
      if (params.allowedRecipients && !params.allowedRecipients.includes(to)) warnings.push("destination is not in the rule's recipients list");
      break;
    }
    case "pause":
    case "unpause": {
      const caller = account(params.caller, "caller");
      authorizer = caller;
      fn = params.kind;
      args = [addr(caller)];
      headline = `${params.kind.toUpperCase()} token ${shortAddr(token)} (caller ${shortAddr(caller)})`;
      facts.push(["caller", caller]);
      break;
    }
    default:
      return usage(`unknown control kind ${(params as { kind: string }).kind}`);
  }

  const controlKind: ControlKind = params.kind;
  return {
    controlKind,
    function: fn,
    args,
    intent: { contract: token, function: fn, args },
    summary: { headline, facts, tree: [`${fn}(${args.map((a) => ("value" in a ? String(a.value) : a.type)).join(", ")}) on ${token}`], warnings },
    ...(amountArg !== undefined ? { amountArg } : {}),
    ...(recipientArg !== undefined ? { recipientArg } : {}),
    authorizer,
  };
}
