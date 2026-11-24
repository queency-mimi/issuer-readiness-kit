// SPDX-License-Identifier: Apache-2.0
// Soroban RPC wiring for AuthDeps and the submitter. Read/simulate only here; writes go through the submitter.
import { Networks, rpc } from "@stellar/stellar-sdk";
import { MkrError } from "../errors.ts";
import type { AuthDeps } from "../auth/plan.ts";

export const TESTNET_RPC = "https://soroban-testnet.stellar.org";

/**
 * server.getAccount with a few retries. The public testnet RPC sits behind several nodes that can lag, so an
 * account that exists can briefly read as "not found" (seen on 2026-11-08 during a live demo run).
 */
export async function getAccountWithRetry(server: rpc.Server, address: string, tries = 6, delayMs = 1500) {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await server.getAccount(address);
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

export function createRpcAuthDeps(opts: { rpcUrl: string; networkPassphrase: string; clock?: () => number }): { deps: AuthDeps; server: rpc.Server } {
  const server = new rpc.Server(opts.rpcUrl, { allowHttp: opts.rpcUrl.startsWith("http://127.0.0.1") || opts.rpcUrl.startsWith("http://localhost") });
  const deps: AuthDeps = {
    networkPassphrase: opts.networkPassphrase,
    async getAccountSequence(address) {
      try {
        return (await getAccountWithRetry(server, address)).sequenceNumber();
      } catch (e) {
        throw new MkrError("MKR_E_USAGE", `cannot load account ${address}: ${(e as Error).message}`);
      }
    },
    async simulate(tx, authMode) {
      // The shared testnet RPC drops requests now and then. A thrown error (network, 5xx) is retried; a simulation
      // that ran and reported an error comes back as a normal response and is not retried.
      let last: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          return await server.simulateTransaction(tx, undefined, authMode);
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
      throw last;
    },
    async getLatestLedger() {
      return (await server.getLatestLedger()).sequence;
    },
    nowUnix: opts.clock ?? (() => Math.floor(Date.now() / 1000)),
  };
  return { deps, server };
}

/** Scripts that write call this first: testnet only (G-VALUE). */
export function assertTestnet(passphrase: string): void {
  if (passphrase !== Networks.TESTNET) throw new MkrError("MKR_E_MAINNET_SUBMIT_BLOCKED", "this script writes and runs on testnet only (G-VALUE)");
}

/** Fund with testnet friendbot, then wait until the RPC sees the account (the two can lag by a few ledgers). */
export async function friendbotFund(address: string, server?: rpc.Server, url = "https://friendbot.stellar.org"): Promise<void> {
  // Friendbot can take ~15 s to answer and Node's default connect-attempt timeout is 250 ms, so a slow link can
  // fail the first tries. Retry with backoff and a hard per-attempt timeout, then fail with a readable message.
  let lastErr = "";
  let funded = false;
  for (let attempt = 1; attempt <= 4 && !funded; attempt++) {
    try {
      const r = await fetch(`${url}?addr=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(60_000) });
      if (r.ok) {
        funded = true;
      } else {
        const body = await r.text();
        if (body.includes("createAccountAlreadyExist")) funded = true;
        else lastErr = `${r.status} ${body.slice(0, 200)}`;
      }
    } catch (e) {
      const c = (e as { cause?: { code?: string; message?: string } }).cause;
      lastErr = `${(e as Error).message}${c?.code ? ` (${c.code})` : ""}`;
    }
    if (!funded && attempt < 4) await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
  if (!funded) throw new MkrError("MKR_E_USAGE", `friendbot did not fund ${address} after 4 attempts: ${lastErr}. Check the network, or set NODE_OPTIONS=--network-family-autoselection-attempt-timeout=10000.`);
  if (!server) return;
  for (let i = 0; i < 30; i++) {
    try {
      await server.getAccount(address);
      return;
    } catch {
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  throw new MkrError("MKR_E_USAGE", `RPC never saw funded account ${address}`);
}
