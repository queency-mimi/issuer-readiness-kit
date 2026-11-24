// SPDX-License-Identifier: Apache-2.0
// Invocation tree rendering, digest (SPEC 7.2) and flattening for policy evaluation (SPEC 4.3).
import { Address, inspectAuthEntry, xdr } from "@stellar/stellar-sdk";
import { canonicalTaggedHash } from "../canonical.ts";
import { MkrError } from "../errors.ts";
import { DOMAIN } from "../hash.ts";
import type { Hex32 } from "../hash.ts";
import type { InvocationNode } from "../policy/evaluate.ts";
import type { ScValJson } from "../workflow/types.ts";
import { renderScVal, scValToJson } from "./scval.ts";
import type { AuthCredentialType } from "./types.ts";

export interface InvocationJson {
  contract: string;
  function: string;
  args: ScValJson[];
  subInvocations: InvocationJson[];
}

export interface TreeEntryJson {
  credentialType: AuthCredentialType;
  /** Absent for sourceAccount credentials. */
  address?: string;
  rootInvocation: InvocationJson;
}

export function invocationToJson(inv: xdr.SorobanAuthorizedInvocation): InvocationJson {
  const f = inv.function;
  if (f.type !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", `authorised host function ${f.type} is not supported in v1 (contract calls only)`);
  }
  const c = f.contractFn;
  return {
    contract: Address.fromScAddress(c.contractAddress).toString(),
    function: String(c.functionName),
    args: c.args.map(scValToJson),
    subInvocations: inv.subInvocations.map(invocationToJson),
  };
}

export function entryToTreeJson(entry: xdr.SorobanAuthorizationEntry): TreeEntryJson {
  const info = inspectAuthEntry(entry);
  const out: TreeEntryJson = { credentialType: info.credentialType, rootInvocation: invocationToJson(entry.rootInvocation) };
  if (info.address !== null) out.address = info.address;
  return out;
}

/** TAG_intent SHA-256 over JCS(tree). Nonce and expiry are excluded on purpose (SPEC 7.2). */
export function invocationTreeDigest(tree: TreeEntryJson[]): Hex32 {
  return canonicalTaggedHash(DOMAIN.intent, tree);
}

export function treeDigestOfEntries(entries: xdr.SorobanAuthorizationEntry[]): Hex32 {
  return invocationTreeDigest(entries.map(entryToTreeJson));
}

/** Flatten every entry's tree depth-first, root first. sourceAccount entries are authorised by `source`. */
export function flattenTree(tree: TreeEntryJson[], source: string): InvocationNode[] {
  const out: InvocationNode[] = [];
  const walk = (inv: InvocationJson, depth: number, authorizer: string) => {
    out.push({ depth, contract: inv.contract, function: inv.function, args: inv.args, authorizer });
    inv.subInvocations.forEach((s) => walk(s, depth + 1, authorizer));
  };
  for (const e of tree) walk(e.rootInvocation, 0, e.address ?? source);
  return out;
}

/** Indented clear-signing lines for the whole tree. */
export function renderTree(tree: TreeEntryJson[]): string[] {
  const lines: string[] = [];
  const walk = (inv: InvocationJson, depth: number) => {
    lines.push(`${"  ".repeat(depth + 1)}${inv.function}(${inv.args.map(renderScVal).join(", ")}) on ${inv.contract}`);
    inv.subInvocations.forEach((s) => walk(s, depth + 1));
  };
  for (const e of tree) {
    lines.push(e.address ? `authorised by ${e.address} (${e.credentialType})` : "authorised by the transaction source (envelope signature)");
    walk(e.rootInvocation, 0);
  }
  return lines;
}
