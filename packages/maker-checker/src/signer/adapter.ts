// SPDX-License-Identifier: Apache-2.0
// Normative: SPEC.md section 9. The kit never receives a private key through this interface.

export interface SignerCapabilities {
  signTransaction: boolean;
  signAuthEntry: boolean;
  signMessage: boolean;
  /** Can the signer show what is being signed? "none" means blind signing. */
  clearSigning: "none" | "basic" | "full-auth-tree";
  /** True if results may come back later (custody console approval, human wallet). */
  asynchronous: boolean;
  /** True if the signer can sign for a C-address account (custom __check_auth). */
  contractAccounts: boolean;
}

export interface SignTransactionRequest {
  networkPassphrase: string;
  /** Base64 XDR TransactionEnvelope, unsigned or partially signed. */
  envelopeXdr: string;
  /** The G address whose key must sign. */
  address: string;
  /** What the kit believes it is asking to sign, for display and for the signer's own check. */
  summary: string[];
  requestId: string;
}

export interface SignAuthEntryRequest {
  networkPassphrase: string;
  /** Base64 XDR SorobanAuthorizationEntry as simulated (credentials.signature empty). */
  entryXdr: string;
  /** signatureExpirationLedger fixed by the plan; the signer writes it into the entry (authorizeEntry validUntil). */
  validUntil: number;
  /**
   * Base64 XDR of the HashIdPreimage built by buildAuthorizationEntryPreimage(entry, expiry, passphrase).
   * SEP-43 v1.2.1 signAuthEntry takes "an authorization entry preimage" as its first parameter
   * (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md, read 2026-10-31), so the
   * SEP-43 adapter sends this, not entryXdr.
   */
  preimageXdr: string;
  /** Hex of the 32-byte hash the signature must cover: sha256(preimage XDR). For HSM/KMS adapters. */
  preimageHash: string;
  /** Which node of the entry this signature is for (AuthSignerNode.path). */
  nodePath: string;
  address: string;
  summary: string[];
  requestId: string;
  slotId: string;
}

export interface SignMessageRequest {
  /** UTF-8 message; SEP-53 framing is applied by the adapter or the wallet, see SPEC 5.4. */
  message: string;
  address: string;
  requestId: string;
}

export type SignerResult<T> =
  | ({ status: "signed" } & T)
  | { status: "pending"; ticket: string; pollAfterMs: number }
  | { status: "declined"; reason: string };

export interface SignedTransaction {
  /** Base64 XDR TransactionEnvelope with this signer's signature(s) added. */
  envelopeXdr: string;
  signerAddress: string;
}
export interface SignedAuthEntry {
  /** Base64 XDR SorobanAuthorizationEntry with credentials.signature filled. */
  entryXdr: string;
  signerAddress: string;
}
export interface SignedMessage {
  signatureBase64: string;
  signerAddress: string;
}

export interface SignerAdapter {
  readonly id: string;
  readonly kind: "wallet-sep43" | "kms" | "custody-api" | "xdr-handoff" | "stub";
  capabilities(): Promise<SignerCapabilities>;
  /** Addresses this adapter can sign for. */
  addresses(): Promise<string[]>;
  signTransaction(req: SignTransactionRequest): Promise<SignerResult<SignedTransaction>>;
  signAuthEntry(req: SignAuthEntryRequest): Promise<SignerResult<SignedAuthEntry>>;
  signMessage(req: SignMessageRequest): Promise<SignerResult<SignedMessage>>;
  /** Resolve a pending ticket. Adapters without asynchronous support throw MKR_E_SIGNER_UNAVAILABLE. */
  poll(ticket: string): Promise<SignerResult<SignedTransaction | SignedAuthEntry | SignedMessage>>;
}
