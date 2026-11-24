// SPDX-License-Identifier: Apache-2.0
// Submitter (MKR-027): sendTransaction, then poll getTransaction with a bounded timeout. Network is injected.
import { Networks, rpc, Transaction } from "@stellar/stellar-sdk";
import { MkrError } from "../errors.ts";
import { bytesToHex } from "../hash.ts";

export interface SubmitResult {
  txHash: string;
  status: "SUCCESS" | "FAILED" | "TIMEOUT";
  ledger?: number;
  /** ISO time the ledger closed, when the RPC reports it. */
  createdAt?: string;
}

export interface Submitter {
  submit(signedEnvelopeXdr: string): Promise<SubmitResult>;
}

/** RPC-backed submitter. Refuses any network but the one it was built for; the caller enforces G-VALUE. */
export function createRpcSubmitter(opts: { server: rpc.Server; networkPassphrase: string; timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; allowMainnet?: boolean }): Submitter {
  // Second G-VALUE guard: a submitter for the public network cannot even be constructed without an explicit opt-in.
  if (opts.networkPassphrase === Networks.PUBLIC && opts.allowMainnet !== true) {
    throw new MkrError("MKR_E_MAINNET_SUBMIT_BLOCKED", "refusing to build a mainnet submitter (G-VALUE); no mainnet writes");
  }
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const done = new Map<string, SubmitResult>();
  return {
    async submit(xdrB64) {
      const tx = new Transaction(xdrB64, opts.networkPassphrase);
      const hash = bytesToHex(tx.hash());
      const prior = done.get(hash);
      if (prior) return prior; // idempotent per envelope hash
      const sent = await opts.server.sendTransaction(tx);
      if (sent.status === "ERROR") throw new MkrError("MKR_E_SIMULATION_FAILED", `sendTransaction ERROR: ${sent.errorResult?.toXdr("base64") ?? "no result"}`, { hash });
      const deadline = (opts.timeoutMs ?? 60_000) / (opts.pollMs ?? 1500);
      for (let i = 0; i < deadline; i++) {
        await sleep(opts.pollMs ?? 1500);
        const r = await opts.server.getTransaction(sent.hash);
        if (r.status === "SUCCESS" || r.status === "FAILED") {
          const out: SubmitResult = { txHash: sent.hash, status: r.status, ledger: r.ledger, createdAt: new Date(Number(r.createdAt) * 1000).toISOString().slice(0, 19) + "Z" };
          done.set(hash, out);
          return out;
        }
      }
      return { txHash: sent.hash, status: "TIMEOUT" };
    },
  };
}
