// SPDX-License-Identifier: Apache-2.0
// Bundles, share verification (SPEC 7.5) and merging (SPEC 7.6).
import { inspectAuthEntry, Keypair, xdr } from "@stellar/stellar-sdk";
import { canonicalize } from "../canonical.ts";
import { MkrError } from "../errors.ts";
import { hexToBytes } from "../hash.ts";
import type { AuthBundle, AuthPlan, CollectedShare } from "./types.ts";

/** Plan -> portable bundle with no signatures. */
export function toBundle(plan: AuthPlan): AuthBundle {
  return {
    version: 1,
    planId: plan.planId,
    requestId: plan.requestId,
    networkPassphrase: plan.networkPassphrase,
    unsignedTxXdr: plan.unsignedTxXdr,
    slots: plan.slots.map((s) => ({
      slotId: s.slotId,
      address: s.address,
      credentialType: s.credentialType,
      signerNodes: s.signerNodes,
      entryXdr: s.entryXdr,
      preimageHash: s.preimageHash,
      signatureExpirationLedger: s.signatureExpirationLedger,
      nodes: s.nodes,
    })),
    collected: [],
  };
}

const invalid = (m: string, details: Record<string, unknown> = {}): never => {
  throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", m, details);
};

/**
 * Check one returned entry against its slot: same credential type, address, nonce, expiry and
 * rootInvocation; signature present on the node; for a classic ed25519 node the signature verifies over
 * preimageHash with the node's own key (single-key accounts; multisig G accounts are spike MKR-016, U1).
 * Contract nodes get structural checks only: enforce-mode simulation at assembly is their validity check.
 * Throws MKR_E_AUTH_ENTRY_INVALID, MKR_E_AUTH_SLOT_UNKNOWN.
 */
export function verifyCollectedShare(plan: AuthPlan, share: CollectedShare, latestLedger?: number): void {
  const slot = plan.slots.find((s) => s.slotId === share.slotId);
  if (!slot) throw new MkrError("MKR_E_AUTH_SLOT_UNKNOWN", `unknown slot ${share.slotId}`);
  const node = slot.signerNodes.find((n) => n.path === share.nodePath);
  if (!node) throw new MkrError("MKR_E_AUTH_SLOT_UNKNOWN", `slot ${slot.slotId} has no node ${share.nodePath}`);
  if (latestLedger !== undefined && latestLedger >= slot.signatureExpirationLedger) invalid("slot expired: re-plan", { slotId: slot.slotId });
  let signed: xdr.SorobanAuthorizationEntry;
  try {
    signed = xdr.SorobanAuthorizationEntry.fromXdr(share.signedEntryXdr, "base64");
  } catch {
    return invalid("signed entry is not a SorobanAuthorizationEntry");
  }
  const planned = xdr.SorobanAuthorizationEntry.fromXdr(slot.entryXdr, "base64");
  const a = inspectAuthEntry(planned);
  const b = inspectAuthEntry(signed);
  if (b.credentialType !== a.credentialType) invalid("credential type changed");
  if (b.address !== a.address) invalid("entry is for another address");
  if (b.nonce !== a.nonce) invalid("nonce changed");
  if (b.signatureExpirationLedger !== slot.signatureExpirationLedger) invalid("expiry differs from the plan");
  if (!signed.rootInvocation.equals(planned.rootInvocation)) invalid("entry authorises a different invocation");
  const idx = node.path === "0" ? 0 : Number(node.path.split(".")[1]);
  const sn = b.signers[idx];
  if (!sn || sn.address !== node.address) invalid("signer node missing or reordered");
  if (!sn!.signed) invalid("node carries no signature");
  if (node.accountKind === "classic") {
    const sigs = sn!.signatures;
    if (!sigs || sigs.length === 0) invalid("classic node signature is not in the ed25519 format");
    const payload = hexToBytes(slot.preimageHash);
    for (const s of sigs!) {
      if (s.publicKey !== node.address) invalid("signature key differs from the account (multisig G accounts are spike MKR-016)");
      if (!Keypair.fromPublicKey(s.publicKey).verify(payload, s.signature)) invalid("signature does not verify over the planned preimage hash");
    }
  }
}

const shareKey = (s: CollectedShare) => `${s.slotId}|${s.nodePath}`;

/**
 * Merge two bundles for the same plan. Commutative, associative, idempotent; refuses different planId or
 * requestId; per node, identical entries merge (the lexicographically smallest share record wins, so the
 * result does not depend on order); two different signed entries for one node throw MKR_E_AUTH_ENTRY_INVALID.
 */
export function mergeBundles(a: AuthBundle, b: AuthBundle): AuthBundle {
  if (a.planId !== b.planId || a.requestId !== b.requestId) throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", "bundles are for different plans");
  const byKey = new Map<string, CollectedShare>();
  for (const s of [...a.collected, ...b.collected]) {
    const k = shareKey(s);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, s);
      continue;
    }
    if (prev.signedEntryXdr !== s.signedEntryXdr) throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", `two different signatures for ${k}`);
    if (canonicalize(s) < canonicalize(prev)) byKey.set(k, s);
  }
  const collected = [...byKey.values()].sort((x, y) => (shareKey(x) < shareKey(y) ? -1 : shareKey(x) > shareKey(y) ? 1 : 0));
  return { ...a, collected };
}

/** True when every node of every slot has a share (shares are verified when they are added). */
export function isComplete(plan: AuthPlan, bundle: AuthBundle): boolean {
  if (bundle.planId !== plan.planId) return false;
  const have = new Set(bundle.collected.map(shareKey));
  return plan.slots.every((s) => s.signerNodes.every((n) => have.has(`${s.slotId}|${n.path}`)));
}
