// SPDX-License-Identifier: Apache-2.0
// Normative shapes: SPEC.md section 7. JSON Schema: schemas/auth-bundle.schema.json.
import type { Hex32 } from "../hash.ts";
import type { StellarAddress } from "../policy/types.ts";

export type SlotStatus = "pending" | "collected" | "declined" | "expired";

/**
 * Mirrors the credential arms the installed SDK reports (AuthEntryCredentialType in
 * @stellar/stellar-sdk 17.4.0, lib/esm/base/auth.d.ts): sourceAccount, address (legacy),
 * addressV2 (CAP-71, address bound into the signed payload), addressWithDelegates (CAP-71-01).
 */
export type AuthCredentialType = "sourceAccount" | "address" | "addressV2" | "addressWithDelegates";

/** A node that can carry a signature inside one entry: the top-level address or a (nested) delegate. */
export interface AuthSignerNode {
  address: StellarAddress;
  /** "0" for the top level, "0.1.2" style path for delegates (depth-first). */
  path: string;
  accountKind: "classic" | "contract" | "unknown";
  signed: boolean;
}

export interface InvocationNodeSummary {
  depth: number;
  contract: string;
  function: string;
  /** Rendered argument list, clear-signing form. */
  argsText: string[];
}

/**
 * One signature obligation. A Soroban auth entry with `address` credentials is one slot.
 * Entries with `sourceAccount` credentials are not slots: they are covered by the transaction
 * signature (see TxSignerRequirement).
 */
export interface AuthSlot {
  /** `${planId.slice(0,16)}:${entryIndex}` */
  slotId: string;
  entryIndex: number;
  /** Top-level credential address (the one `require_auth` was called for). */
  address: StellarAddress;
  credentialType: Exclude<AuthCredentialType, "sourceAccount">;
  accountKind: "classic" | "contract" | "unknown";
  /** Top-level node first, then delegates depth-first. Every node signs the same payload (CAP-71-01). */
  signerNodes: AuthSignerNode[];
  nonce: string;
  signatureExpirationLedger: number;
  /** Tagged hash of the canonical rootInvocation of this entry. */
  rootInvocationDigest: Hex32;
  /**
   * Hex of the 32-byte hash of buildAuthorizationEntryPreimage(entry, signatureExpirationLedger, passphrase).
   * The expiry is fixed by the plan (signatureExpirationLedger); signers pass it to authorizeEntry as validUntil,
   * so the hash is stable across signers.
   */
  preimageHash: Hex32;
  nodes: InvocationNodeSummary[];
  /** Base64 XDR of the unsigned SorobanAuthorizationEntry. */
  entryXdr: string;
  status: SlotStatus;
}

export interface TxSignerRequirement {
  source: StellarAddress;
  /** False when the host gave no signer reader: then threshold/signers are not known (not "zero"). */
  read: boolean;
  /** Account medium threshold and signers read at readAtLedger. [P] only after spike MKR-016. */
  threshold: number;
  signers: { key: string; weight: number }[];
  readAtLedger: number;
}

export interface AuthPlan {
  version: 1;
  planId: Hex32;
  requestId: Hex32;
  networkPassphrase: string;
  /** Ledger sequence of the RPC latest ledger when simulation ran. */
  planLedger: number;
  /** Base64 XDR of the transaction as built for this plan, before auth entries and resources are applied. */
  unsignedTxXdr: string;
  unsignedTxHash: Hex32;
  /** Every simulated auth entry (base64 XDR, entry order), including sourceAccount ones that are not slots. */
  authEntriesXdr: string[];
  /** Tagged digest of the authorised tree this plan carries; equals the request's approved digest. */
  invocationTreeDigest: Hex32;
  slots: AuthSlot[];
  txSigners: TxSignerRequirement;
  simulation: { mode: "record" | "record_allow_nonroot"; useUpgradedAuth: boolean; minResourceFee: string; cpuInstructions: string; latestLedger: number };
}

export interface CollectedShare {
  slotId: string;
  signerId: string;
  /** Which signer node of the slot this share fills (SignerNode.path). */
  nodePath: string;
  /** Base64 XDR of the SorobanAuthorizationEntry with this node's signature filled in. */
  signedEntryXdr: string;
  collectedAt: string;
}

/** Portable hand-off document. May be moved by file, QR chunks or HTTP. Contains no secrets. */
export interface AuthBundle {
  version: 1;
  planId: Hex32;
  requestId: Hex32;
  networkPassphrase: string;
  unsignedTxXdr: string;
  slots: Pick<AuthSlot, "slotId" | "address" | "credentialType" | "signerNodes" | "entryXdr" | "preimageHash" | "signatureExpirationLedger" | "nodes">[];
  collected: CollectedShare[];
}
