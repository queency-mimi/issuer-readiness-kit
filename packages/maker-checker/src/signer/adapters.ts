// SPDX-License-Identifier: Apache-2.0
// Real-signer adapters. Each is a separate ticket; none may import a private key.
import { NotImplemented } from "../errors.ts";

/** SEP-43 wallet interface (Freighter, xBull, Lobstr via a Wallets Kit-style bridge). MKR-020. */
export function createSep43Adapter(_options: { id: string }): never {
  throw new NotImplemented("MKR-020");
}

/** Raw ed25519 sign through a KMS/HSM client the host provides (AWS KMS ED25519, GCP KMS, PKCS#11). MKR-021. */
export function createKmsAdapter(_options: { id: string }): never {
  throw new NotImplemented("MKR-021");
}

/**
 * XDR hand-off for UI signers that expose no API (tupui/stellar-stratum): export unsigned XDR,
 * a Stratum import link / QR, and accept the signed XDR back via file, paste or Refractor poll.
 * Classic-transaction signatures only; Stratum refuses calls needing another address's
 * auth entry (src/lib/contract/invoke.ts, buildInvocationXdr). MKR-022.
 */
export function createXdrHandoffAdapter(_options: { id: string }): never {
  throw new NotImplemented("MKR-022");
}

/** Custody-vendor API co-signer (Fireblocks/BitGo/Taurus style): asynchronous, ticket-based. MKR-023, BLOCKED(vendor access). */
export function createCustodyApiAdapter(_options: { id: string }): never {
  throw new NotImplemented("MKR-023");
}
