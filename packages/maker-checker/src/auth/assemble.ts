// SPDX-License-Identifier: Apache-2.0
// Assembly (SPEC 7.7): signed entries in plan order, enforce-mode re-simulation, resources, envelope signatures.
import { Keypair, Operation, rpc, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { MkrError } from "../errors.ts";
import { bytesToHex } from "../hash.ts";
import { isComplete } from "./bundle.ts";
import type { AuthDeps } from "./plan.ts";
import type { AuthBundle, AuthPlan } from "./types.ts";

export const SAFETY_LEDGERS = 12;

/** Signed entries in plan order; sourceAccount entries are kept as simulated. */
export function signedEntries(plan: AuthPlan, bundle: AuthBundle): xdr.SorobanAuthorizationEntry[] {
  return plan.authEntriesXdr.map((x, i) => {
    const slot = plan.slots.find((s) => s.entryIndex === i);
    if (!slot) return xdr.SorobanAuthorizationEntry.fromXdr(x, "base64");
    const shares = bundle.collected.filter((c) => c.slotId === slot.slotId);
    if (slot.signerNodes.length !== 1 || shares.length !== 1) {
      throw new MkrError("MKR_E_USAGE", "combining shares of a multi-node (delegates) entry is not implemented in v1 (MKR-040)");
    }
    return xdr.SorobanAuthorizationEntry.fromXdr(shares[0]!.signedEntryXdr, "base64");
  });
}

/**
 * Place signed entries into the invokeHostFunction op's auth array (same order as the plan), re-simulate in
 * `enforce` mode, apply resource data and fee, and return the transaction for the source account's envelope
 * signature(s). Throws MKR_E_SIMULATION_FAILED (with the contract error), MKR_E_AUTH_PLAN_STALE.
 */
export async function assembleForEnvelopeSigning(plan: AuthPlan, bundle: AuthBundle, deps: AuthDeps): Promise<{ envelopeXdr: string; envelopeHash: string; minResourceFee: string }> {
  if (!isComplete(plan, bundle)) throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", "not every slot has a verified share");
  const latest = await deps.getLatestLedger();
  for (const s of plan.slots) {
    if (s.signatureExpirationLedger - latest <= SAFETY_LEDGERS) throw new MkrError("MKR_E_AUTH_PLAN_STALE", `slot ${s.slotId} expires at ledger ${s.signatureExpirationLedger}; latest ${latest}; re-plan`);
  }
  const raw = new Transaction(plan.unsignedTxXdr, plan.networkPassphrase);
  const op = raw.operations[0];
  if (!op || op.type !== "invokeHostFunction" || raw.operations.length !== 1) throw new MkrError("MKR_E_USAGE", "plan transaction must hold exactly one invokeHostFunction operation");
  const withAuth = TransactionBuilder.cloneFrom(raw, { fee: raw.fee })
    .clearOperations()
    .addOperation(Operation.invokeHostFunction({ func: op.func, auth: signedEntries(plan, bundle) }))
    .build();
  const sim = await deps.simulate(withAuth, "enforce");
  if (rpc.Api.isSimulationError(sim)) throw new MkrError("MKR_E_SIMULATION_FAILED", `enforce-mode simulation failed: ${sim.error}`, { error: sim.error });
  const assembled = rpc.assembleTransaction(withAuth, sim).build();
  return { envelopeXdr: assembled.toXDR(), envelopeHash: bytesToHex(assembled.hash()), minResourceFee: (sim as rpc.Api.SimulateTransactionSuccessResponse).minResourceFee };
}

/**
 * Attach the envelope signature(s) another signer added. The transaction must be byte-identical apart from
 * signatures; every new signature must verify over the transaction hash for one of `allowedSigners`.
 */
export function addEnvelopeSignature(envelopeXdr: string, signedEnvelopeXdr: string, networkPassphrase: string, allowedSigners: string[]): string {
  const base = new Transaction(envelopeXdr, networkPassphrase);
  const signed = new Transaction(signedEnvelopeXdr, networkPassphrase);
  const h = base.hash();
  if (bytesToHex(signed.hash()) !== bytesToHex(h)) throw new MkrError("MKR_E_PAYLOAD_MISMATCH", "signed envelope is a different transaction");
  const have = new Set(base.signatures.map((s) => bytesToHex(s.toXdr())));
  for (const sig of signed.signatures) {
    if (have.has(bytesToHex(sig.toXdr()))) continue;
    const signer = allowedSigners.map((a) => Keypair.fromPublicKey(a)).find((kp) => bytesToHex(kp.signatureHint()) === bytesToHex(sig.hint.value) && kp.verify(h, sig.signature.value));
    if (!signer) throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", "envelope signature does not verify for any allowed signer");
    base.signatures.push(sig);
    have.add(bytesToHex(sig.toXdr()));
  }
  return base.toXDR();
}
