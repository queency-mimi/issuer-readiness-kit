// SPDX-License-Identifier: Apache-2.0
// Auth planning (SPEC 7.3): build, simulate (record), decode entries into slots, fix expiry, hash preimages.
import { Account, buildAuthorizationEntryPreimage, inspectAuthEntry, Operation, rpc, StrKey, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { canonicalTaggedHash } from "../canonical.ts";
import { MkrError } from "../errors.ts";
import { bytesToHex, DOMAIN, sha256Hex } from "../hash.ts";
import type { Hex32 } from "../hash.ts";
import type { ActionRequest, Intent } from "../workflow/types.ts";
import { jsonToScVal, renderScVal } from "./scval.ts";
import { entryToTreeJson, invocationToJson, invocationTreeDigest } from "./tree.ts";
import type { InvocationJson, TreeEntryJson } from "./tree.ts";
import type { AuthPlan, AuthSlot, InvocationNodeSummary } from "./types.ts";

/** Network and clock dependencies, injected so planning is testable offline. */
export interface AuthDeps {
  networkPassphrase: string;
  /** Current sequence number of a G account (for building the transaction). */
  getAccountSequence(address: string): Promise<string>;
  /** Soroban RPC simulateTransaction with the given auth mode (SPEC 7.3). */
  simulate(tx: Transaction, authMode: "record" | "enforce" | "record_allow_nonroot"): Promise<rpc.Api.SimulateTransactionResponse>;
  getLatestLedger(): Promise<number>;
  /** Optional: classic account signers/threshold of the tx source (SPEC 7.9). */
  getAccountSigners?(address: string): Promise<{ threshold: number; signers: { key: string; weight: number }[]; ledger: number } | undefined>;
  nowUnix(): number;
}

/** How long a planned transaction stays valid (its own max time bound). */
export const TX_VALIDITY_SECONDS = 1800;
export const BASE_FEE_STROOPS = "100000";

export function buildInvokeTx(intent: Pick<Intent, "source" | "contract" | "function" | "args" | "networkPassphrase">, sequence: string, nowUnix: number, auth: xdr.SorobanAuthorizationEntry[] = []): Transaction {
  return new TransactionBuilder(new Account(intent.source, sequence), { fee: BASE_FEE_STROOPS, networkPassphrase: intent.networkPassphrase })
    .addOperation(Operation.invokeContractFunction({ contract: intent.contract, function: intent.function, args: intent.args.map(jsonToScVal), auth }))
    .setTimebounds(0, nowUnix + TX_VALIDITY_SECONDS)
    .build();
}

function simError(sim: rpc.Api.SimulateTransactionResponse): string | undefined {
  if (rpc.Api.isSimulationError(sim)) return sim.error;
  return undefined;
}

export interface SimulatedIntent {
  tx: Transaction;
  entries: xdr.SorobanAuthorizationEntry[];
  tree: TreeEntryJson[];
  digest: Hex32;
  latestLedger: number;
  sim: rpc.Api.SimulateTransactionSuccessResponse;
}

/** Build the unsigned invocation for an intent and simulate it in record mode (proposal time and planning). */
export async function simulateIntent(intent: Pick<Intent, "source" | "contract" | "function" | "args" | "networkPassphrase">, deps: AuthDeps, authMode: "record" | "record_allow_nonroot" = "record"): Promise<SimulatedIntent> {
  if (intent.networkPassphrase !== deps.networkPassphrase) throw new MkrError("MKR_E_USAGE", "intent network differs from the RPC network");
  if (!StrKey.isValidEd25519PublicKey(intent.source)) throw new MkrError("MKR_E_USAGE", "transaction source must be a G address");
  const seq = await deps.getAccountSequence(intent.source);
  const tx = buildInvokeTx(intent, seq, deps.nowUnix());
  const sim = await deps.simulate(tx, authMode);
  const e = simError(sim);
  if (e !== undefined) throw new MkrError("MKR_E_SIMULATION_FAILED", `simulation (${authMode}) failed: ${e}`, { error: e });
  const ok = sim as rpc.Api.SimulateTransactionSuccessResponse;
  const entries = ok.result?.auth ?? [];
  const tree = entries.map(entryToTreeJson);
  return { tx, entries, tree, digest: invocationTreeDigest(tree), latestLedger: ok.latestLedger, sim: ok };
}

function summarise(inv: InvocationJson, depth: number, out: InvocationNodeSummary[]) {
  out.push({ depth, contract: inv.contract, function: inv.function, argsText: inv.args.map(renderScVal) });
  inv.subInvocations.forEach((s) => summarise(s, depth + 1, out));
}

const accountKind = (a: string): "classic" | "contract" | "unknown" => (a.startsWith("G") ? "classic" : a.startsWith("C") ? "contract" : "unknown");

/**
 * Build the unsigned tx, simulate in record mode, decode every SorobanAuthorizationEntry, create one slot per
 * address-credential entry, fix validUntil = latestLedger + authEntryTtlLedgers and hash each preimage.
 * Throws MKR_E_SIMULATION_FAILED, MKR_E_PAYLOAD_MISMATCH (tree differs from the approved intent).
 */
export async function planAuth(request: ActionRequest, deps: AuthDeps, opts: { authEntryTtlLedgers: number; authMode?: "record" | "record_allow_nonroot" }): Promise<AuthPlan> {
  const s = await simulateIntent(request.intent, deps, opts.authMode ?? "record");
  if (s.digest !== request.intent.invocationTreeDigest) {
    throw new MkrError("MKR_E_PAYLOAD_MISMATCH", "the authorised tree differs from the one approvers approved; re-propose", { approved: request.intent.invocationTreeDigest, now: s.digest });
  }
  const validUntil = s.latestLedger + opts.authEntryTtlLedgers;
  const pass = deps.networkPassphrase;
  const unsignedTxHash = bytesToHex(s.tx.hash());
  const slotsPre: Omit<AuthSlot, "slotId">[] = [];
  s.entries.forEach((entry, entryIndex) => {
    const info = inspectAuthEntry(entry);
    if (info.credentialType === "sourceAccount" || info.address === null) return;
    const nodes: InvocationNodeSummary[] = [];
    summarise(invocationToJson(entry.rootInvocation), 0, nodes);
    slotsPre.push({
      entryIndex,
      address: info.address,
      credentialType: info.credentialType,
      accountKind: accountKind(info.address),
      signerNodes: info.signers.map((n, i) => ({ address: n.address, path: i === 0 ? "0" : `0.${i}`, accountKind: accountKind(n.address), signed: false })),
      nonce: String(info.nonce ?? 0n),
      signatureExpirationLedger: validUntil,
      rootInvocationDigest: canonicalTaggedHash(DOMAIN.intent, invocationToJson(entry.rootInvocation)),
      preimageHash: sha256Hex(buildAuthorizationEntryPreimage(entry, validUntil, pass).toXdr()),
      nodes,
      entryXdr: entry.toXdr("base64"),
      status: "pending",
    });
  });
  const planId = canonicalTaggedHash(DOMAIN.authPlan, {
    requestId: request.id,
    unsignedTxHash,
    slots: slotsPre.map((x) => ({ address: x.address, nonce: x.nonce, validUntil: x.signatureExpirationLedger, digest: x.rootInvocationDigest })),
  });
  const slots: AuthSlot[] = slotsPre.map((x) => ({ slotId: `${planId.slice(0, 16)}:${x.entryIndex}`, ...x }));
  const signers = deps.getAccountSigners ? await deps.getAccountSigners(request.intent.source) : undefined;
  return {
    version: 1,
    planId,
    requestId: request.id,
    networkPassphrase: pass,
    planLedger: s.latestLedger,
    unsignedTxXdr: s.tx.toXDR(),
    unsignedTxHash,
    authEntriesXdr: s.entries.map((e) => e.toXdr("base64")),
    invocationTreeDigest: s.digest,
    slots,
    txSigners: signers
      ? { source: request.intent.source, read: true, threshold: signers.threshold, signers: signers.signers, readAtLedger: signers.ledger }
      : { source: request.intent.source, read: false, threshold: 0, signers: [], readAtLedger: 0 },
    simulation: {
      mode: opts.authMode ?? "record",
      useUpgradedAuth: false,
      minResourceFee: s.sim.minResourceFee,
      cpuInstructions: String(s.sim.transactionData.build().resources.instructions),
      latestLedger: s.latestLedger,
    },
  };
}

/** Re-plan with a new expiry and nonces. All collected shares are void (they commit to the old expiry). MKR-014 (partial). */
export async function replanAuth(previous: AuthPlan, request: ActionRequest, deps: AuthDeps, opts: { authEntryTtlLedgers: number }): Promise<AuthPlan> {
  if (previous.requestId !== request.id) throw new MkrError("MKR_E_USAGE", "plan is for another request");
  return planAuth(request, deps, opts);
}

export { Transaction };
