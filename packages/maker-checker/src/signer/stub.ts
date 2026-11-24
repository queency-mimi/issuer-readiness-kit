// SPDX-License-Identifier: Apache-2.0
import { authorizeEntry, buildAuthorizationEntryPreimage, inspectAuthEntry, Keypair, Transaction, xdr } from "@stellar/stellar-sdk";
import { MkrError } from "../errors.ts";
import { sha256Hex } from "../hash.ts";
import { bytesToBase64 } from "../workflow/approval.ts";
import type {
  SignAuthEntryRequest,
  SignedAuthEntry,
  SignedMessage,
  SignedTransaction,
  SignerAdapter,
  SignerCapabilities,
  SignerResult,
  SignMessageRequest,
  SignTransactionRequest,
} from "./adapter.ts";

export type StubMode = "sign" | "decline" | "pending-then-sign";

/**
 * Throwaway-key signer for tests and testnet demos. The ed25519 key is generated at runtime with
 * Keypair.random() inside the constructor and kept in a private field: it is never serialised, logged,
 * returned or written anywhere (G-SECRETS). Scripted behaviours: sign, decline, pending-then-sign.
 *
 * Before signing an auth entry it recomputes the preimage hash from the entry and the requested expiry and
 * refuses a mismatch, so a coordinator cannot ask it to sign something other than what it shows.
 */
export class StubSigner implements SignerAdapter {
  readonly id: string;
  readonly kind = "stub" as const;
  mode: StubMode;
  readonly #kp: Keypair;
  readonly #pending = new Map<string, () => Promise<SignerResult<SignedTransaction | SignedAuthEntry | SignedMessage>>>();
  #ticket = 0;

  constructor(id: string, mode: StubMode = "sign") {
    this.id = id;
    this.mode = mode;
    this.#kp = Keypair.random();
  }

  /** Public address of the runtime key. */
  get address(): string {
    return this.#kp.publicKey();
  }

  capabilities(): Promise<SignerCapabilities> {
    return Promise.resolve({ signTransaction: true, signAuthEntry: true, signMessage: true, clearSigning: "basic", asynchronous: this.mode === "pending-then-sign", contractAccounts: false });
  }

  addresses(): Promise<string[]> {
    return Promise.resolve([this.#kp.publicKey()]);
  }

  #run<T>(fn: () => Promise<SignerResult<T>>): Promise<SignerResult<T>> {
    if (this.mode === "decline") return Promise.resolve({ status: "declined", reason: "scripted decline" });
    if (this.mode === "pending-then-sign") {
      const ticket = `${this.id}-${++this.#ticket}`;
      this.#pending.set(ticket, fn as () => Promise<SignerResult<SignedTransaction | SignedAuthEntry | SignedMessage>>);
      return Promise.resolve({ status: "pending", ticket, pollAfterMs: 10 });
    }
    return fn();
  }

  #own(address: string) {
    if (address !== this.#kp.publicKey()) throw new MkrError("MKR_E_SIGNER_UNAVAILABLE", `signer ${this.id} does not hold ${address}`);
  }

  async signMessage(req: SignMessageRequest): Promise<SignerResult<SignedMessage>> {
    this.#own(req.address);
    return this.#run(async () => ({ status: "signed", signatureBase64: bytesToBase64(this.#kp.signMessage(req.message)), signerAddress: this.#kp.publicKey() }));
  }

  async signTransaction(req: SignTransactionRequest): Promise<SignerResult<SignedTransaction>> {
    this.#own(req.address);
    return this.#run(async () => {
      const tx = new Transaction(req.envelopeXdr, req.networkPassphrase);
      tx.sign(this.#kp);
      return { status: "signed", envelopeXdr: tx.toXDR(), signerAddress: this.#kp.publicKey() };
    });
  }

  async signAuthEntry(req: SignAuthEntryRequest): Promise<SignerResult<SignedAuthEntry>> {
    this.#own(req.address);
    return this.#run(async () => {
      const entry = xdr.SorobanAuthorizationEntry.fromXdr(req.entryXdr, "base64");
      const info = inspectAuthEntry(entry);
      if (info.address !== req.address && !info.signers.some((s) => s.address === req.address)) throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", "entry is not for this signer's address");
      const pre = buildAuthorizationEntryPreimage(entry, req.validUntil, req.networkPassphrase);
      if (sha256Hex(pre.toXdr()) !== req.preimageHash) throw new MkrError("MKR_E_AUTH_ENTRY_INVALID", "preimage hash does not match the entry: refusing to sign");
      const kp = this.#kp;
      const signed = await authorizeEntry(entry, async (_preimage, payload) => kp.sign(payload), req.validUntil, req.networkPassphrase, req.address);
      return { status: "signed", entryXdr: signed.toXdr("base64"), signerAddress: kp.publicKey() };
    });
  }

  async poll(ticket: string): Promise<SignerResult<SignedTransaction | SignedAuthEntry | SignedMessage>> {
    const fn = this.#pending.get(ticket);
    if (!fn) throw new MkrError("MKR_E_SIGNER_UNAVAILABLE", `unknown ticket ${ticket}`);
    this.#pending.delete(ticket);
    return fn();
  }

  /** Keep the key out of any accidental JSON/inspect output. */
  toJSON(): { id: string; kind: "stub"; address: string } {
    return { id: this.id, kind: this.kind, address: this.#kp.publicKey() };
  }
}
