// SPDX-License-Identifier: Apache-2.0
// Offline stand-in for Soroban RPC (AuthDeps): record-mode simulation returns SDK-built auth entries derived
// from the call; enforce mode checks every address entry is signed by its address over the right preimage,
// which is what the host's built-in account check does for single-key G accounts.
import { Address, buildAuthorizationEntryPreimage, inspectAuthEntry, Keypair, SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";
import type { rpc, Transaction } from "@stellar/stellar-sdk";
import type { AuthDeps } from "../../src/auth/plan.ts";

/** Which argument of a call names the address that must authorise it (null: the tx source). */
export const AUTHORIZER_ARG: Record<string, number | null> = { set_address_frozen: 2, freeze_partial_tokens: 2, forced_transfer: 3, pause: 0, unpause: 0, transfer: 0, mint: 2, noop: null };

export function unsignedEntry(opts: { address: string | null; contract: string; fn: string; args: xdr.ScVal[]; nonce?: bigint; sub?: xdr.SorobanAuthorizedInvocation[] }): xdr.SorobanAuthorizationEntry {
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: new Address(opts.contract).toScAddress(), functionName: opts.fn, args: opts.args })),
    subInvocations: opts.sub ?? [],
  });
  const credentials = opts.address === null
    ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
    : xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({ address: new Address(opts.address).toScAddress(), nonce: opts.nonce ?? 42n, signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() }));
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

export interface FakeNet extends AuthDeps {
  ledger: number;
  /** Override the record-mode result (e.g. a nested sub-invocation appearing after approval). */
  mutate?: (entries: xdr.SorobanAuthorizationEntry[]) => xdr.SorobanAuthorizationEntry[];
  failRecord?: string;
  failEnforce?: string;
  simulations: { mode: string }[];
}

function success(latestLedger: number, auth: xdr.SorobanAuthorizationEntry[]): rpc.Api.SimulateTransactionSuccessResponse {
  return { id: "1", latestLedger, events: [], _parsed: true, transactionData: new SorobanDataBuilder().setResourceFee(1000n), minResourceFee: "1000", result: { auth, retval: xdr.ScVal.scvVoid() } } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

export function fakeNet(opts: { passphrase: string; now: () => number; ledger?: number }): FakeNet {
  const net: FakeNet = {
    networkPassphrase: opts.passphrase,
    ledger: opts.ledger ?? 1000,
    simulations: [],
    async getAccountSequence() {
      return "100";
    },
    async getLatestLedger() {
      return net.ledger;
    },
    nowUnix: opts.now,
    async simulate(tx: Transaction, authMode) {
      net.simulations.push({ mode: authMode });
      const op = tx.operations[0] as { func: xdr.HostFunction; auth?: xdr.SorobanAuthorizationEntry[] };
      const f = (op.func as unknown as { invokeContract: xdr.InvokeContractArgs }).invokeContract;
      const contract = Address.fromScAddress(f.contractAddress).toString();
      const fn = String(f.functionName);
      if (authMode === "enforce") {
        if (net.failEnforce) return { id: "1", latestLedger: net.ledger, events: [], _parsed: true, error: net.failEnforce } as unknown as rpc.Api.SimulateTransactionErrorResponse;
        for (const e of op.auth ?? []) {
          const info = inspectAuthEntry(e);
          if (info.credentialType === "sourceAccount") continue;
          const sig = info.signers[0]?.signatures?.[0];
          if (!sig) return { id: "1", latestLedger: net.ledger, events: [], _parsed: true, error: "HostError: Error(Auth, InvalidAction) missing signature" } as never;
          const payload = buildAuthorizationEntryPreimage(e, info.signatureExpirationLedger!, opts.passphrase).toXdr();
          const { sha256 } = await import("@noble/hashes/sha2.js");
          if (sig.publicKey !== info.address || !Keypair.fromPublicKey(sig.publicKey).verify(sha256(payload), sig.signature)) return { id: "1", latestLedger: net.ledger, events: [], _parsed: true, error: "HostError: Error(Auth, InvalidInput) signature check failed" } as never;
          if (net.ledger >= info.signatureExpirationLedger!) return { id: "1", latestLedger: net.ledger, events: [], _parsed: true, error: "HostError: Error(Auth, InvalidInput) signature expired" } as never;
        }
        return success(net.ledger, op.auth ?? []);
      }
      if (net.failRecord) return { id: "1", latestLedger: net.ledger, events: [], _parsed: true, error: net.failRecord } as never;
      const idx = AUTHORIZER_ARG[fn];
      let entries: xdr.SorobanAuthorizationEntry[];
      if (idx === undefined) return { id: "1", latestLedger: net.ledger, events: [], _parsed: true, error: `HostError: no function ${fn}` } as never;
      if (idx === null) entries = [unsignedEntry({ address: null, contract, fn, args: f.args })];
      else entries = [unsignedEntry({ address: Address.fromScVal(f.args[idx]!).toString(), contract, fn, args: f.args })];
      return success(net.ledger, net.mutate ? net.mutate(entries) : entries);
    },
  };
  return net;
}
