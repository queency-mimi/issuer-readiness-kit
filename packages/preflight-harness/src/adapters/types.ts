// SPDX-License-Identifier: Apache-2.0
// Normative: SPEC.md section 5.
import type { CaseFile, ReceiveVerdict, StateSnapshot } from "../types.ts";
import type { AdapterId } from "../taxonomy/library-maps.ts";

export interface AdapterInfo {
  id: AdapterId;
  /** Version actually loaded, e.g. "0.1.1" or "git:4599d9c". Empty when unavailable. */
  version: string;
  available: boolean;
  /** Why unavailable and the exact install command, shown by `pfh adapters`. */
  installHint: string;
}

export interface AdapterCapabilities {
  classicDestination: boolean;
  nativeDestination: boolean;
  muxedDestination: boolean;
  contractDestination: boolean;
  sacTransfer: boolean;
  sep41Token: boolean;
  /** Reads SEP-29 memo requirement. */
  memoRequired: boolean;
  federation: boolean;
  /** Reports maintain-liabilities-only as a distinct state. */
  distinguishesMaintainLiabilities: boolean;
  /** Accepts injected state, so it can replay a StateSnapshot offline. All three libraries do (SPEC 5.2). */
  acceptsInjectedState: boolean;
  /** Refuses to run without a sender (stellar-check: PaymentIntent.source is required). The harness then supplies the case's referenceSender. */
  requiresSender: boolean;
  /** Uses a sender to simulate contract transfers (Stellar-Preflight). */
  usesSenderForSimulation: boolean;
}

export interface LibraryAdapter {
  readonly id: AdapterId;
  info(): Promise<AdapterInfo>;
  capabilities(): AdapterCapabilities;
  /**
   * Run the library against a case with all network reads served from `state` (offline, deterministic).
   * Never throws for library failures: return a ReceiveVerdict with `error`. Throws only for harness bugs.
   */
  replay(testCase: CaseFile, state: StateSnapshot): Promise<ReceiveVerdict>;
  /** Run against the live network, read-only. Optional; used by `pfh run --live`. */
  live?(testCase: CaseFile, options: { rpcUrl?: string; horizonUrl?: string }): Promise<ReceiveVerdict>;
}
