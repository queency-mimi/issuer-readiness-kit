// SPDX-License-Identifier: Apache-2.0
// StateSnapshot -> Stellar-Preflight `Chain` (packages/sdk/src/chain.ts at the pinned commit, read as text).
// The interface is mirrored structurally here; nothing from the clone is imported. Reads the capture never made
// throw "not recorded" (the library then fails visibly) instead of guessing.
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { PASSPHRASE } from "../types.ts";
import type { StateSnapshot } from "../types.ts";
import { canonicalCall, readKey } from "./canonical.ts";
import type { CallArg } from "./canonical.ts";

export interface AccountInfoLike { balance: bigint; authRequired: boolean; authRevocable: boolean; clawbackEnabled: boolean; memoRequired: boolean }
export interface TrustlineInfoLike { balance: bigint; limit: bigint; buyingLiabilities: bigint; authorized: boolean; authorizedToMaintainLiabilities: boolean }
export type CallResultLike = { ok: true; value: unknown } | { ok: false; error: string };
/** Only what the library calls on its Asset argument. */
export interface AssetLike { getCode(): string; getIssuer(): string }
/** Only what is needed to read an ScVal from the library's own copy of stellar-sdk (crossed via XDR). */
export interface ScValLike { toXDR(format: "base64"): string }

export interface SnapshotChain {
  passphrase: string;
  account(id: string): Promise<AccountInfoLike | null>;
  trustline(id: string, asset: AssetLike): Promise<TrustlineInfoLike | null>;
  contract(id: string): Promise<{ kind: "sac" | "wasm" } | null>;
  sacBalance(sacId: string, holder: string): Promise<{ amount: bigint; authorized: boolean } | null>;
  call(contractId: string, fn: string, args: ScValLike[], source?: string): Promise<CallResultLike>;
}

const MEMO_REQUIRED_KEY = "config.memo_required";

function toArg(v: ScValLike): CallArg {
  const x = xdr.ScVal.fromXDR(v.toXDR("base64"), "base64");
  const n = scValToNative(x) as unknown;
  if (typeof n === "bigint" || typeof n === "number" || typeof n === "boolean" || typeof n === "string") return n;
  return JSON.stringify(n, (_k, val: unknown) => (typeof val === "bigint" ? val.toString() : val));
}

function notRecorded(what: string): Error {
  return new Error(`${what} not recorded in this snapshot`);
}

export function snapshotChain(state: StateSnapshot): SnapshotChain {
  const account = (id: string) => {
    if (!(id in state.accounts)) throw notRecorded(`account ${id}`);
    return state.accounts[id] ?? null;
  };
  return {
    passphrase: PASSPHRASE[state.network],
    async account(id) {
      const a = account(id);
      if (!a) return null;
      const memo = a.data[MEMO_REQUIRED_KEY];
      return {
        balance: BigInt(a.balance),
        authRequired: a.flags.authRequired,
        authRevocable: a.flags.authRevocable,
        clawbackEnabled: a.flags.clawbackEnabled,
        memoRequired: memo !== undefined && Buffer.from(memo, "base64").toString("utf8") === "1",
      };
    },
    async trustline(id, asset) {
      const a = account(id);
      if (!a) return null;
      const t = a.trustlines.find((l) => l.asset.code === asset.getCode() && l.asset.issuer === asset.getIssuer());
      if (!t) return null;
      return { balance: BigInt(t.balance), limit: BigInt(t.limit), buyingLiabilities: BigInt(t.buyingLiabilities), authorized: t.authorized, authorizedToMaintainLiabilities: t.authorizedToMaintainLiabilities };
    },
    async contract(id) {
      const c = state.contracts[id];
      if (!c) throw notRecorded(`contract ${id}`);
      return c.exists && c.kind ? { kind: c.kind } : null;
    },
    async sacBalance(sacId, holder) {
      const key = `${sacId}:${holder}`;
      if (!(key in state.sacBalances)) throw notRecorded(`SAC balance ${key}`);
      const b = state.sacBalances[key];
      return b ? { amount: BigInt(b.amount), authorized: b.authorized } : null;
    },
    async call(contractId, fn, args) {
      const plain = args.map(toArg);
      const reads = state.contracts[contractId]?.reads;
      const key = readKey(fn, plain);
      if (reads && key in reads) return { ok: true, value: reads[key] };
      const call = canonicalCall(contractId, fn, plain);
      const sim = state.simulations.find((s) => s.call === call);
      if (!sim) return { ok: false, error: `no recorded simulation for ${call}` };
      return sim.result.ok ? { ok: true, value: undefined } : { ok: false, error: sim.result.error };
    },
  };
}
