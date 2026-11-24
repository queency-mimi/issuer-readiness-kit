// SPDX-License-Identifier: Apache-2.0
// stellar-check adapter (PFH-012). Replay feeds the library's own HorizonProvider through a snapshot-backed fetch
// (its memo check runs the SDK's checkMemoRequired over the replayed account). The library requires a sender
// (PaymentIntent.source); captured classic cases always record one.
import { checkPayment, HorizonProvider } from "stellar-check";
import { PASSPHRASE } from "../types.ts";
import type { CaseFile, ReceiveVerdict, StateSnapshot } from "../types.ts";
import type { AdapterCapabilities, AdapterInfo, LibraryAdapter } from "./types.ts";
import { probe } from "./probe.ts";
import { horizonFetch, REPLAY_HORIZON_URL } from "./feed-horizon.ts";
import { mapStellarCheckReport } from "./map-stellar-check.ts";
import { errorVerdict } from "./map-common.ts";
import { stroopsToDecimal } from "./canonical.ts";

/** Capabilities as read from source on 2026-10-31 (SPEC section 5.2); checked by test/capabilities.test.ts. */
const CAPS: AdapterCapabilities = {
  classicDestination: true,
  nativeDestination: true,
  muxedDestination: false,
  contractDestination: false,
  sacTransfer: false,
  sep41Token: false,
  memoRequired: true,
  federation: false,
  distinguishesMaintainLiabilities: false,
  acceptsInjectedState: true,
  requiresSender: true,
  usesSenderForSimulation: false,
};

export class StellarCheckAdapter implements LibraryAdapter {
  readonly id = "stellar-check" as const;
  info(): Promise<AdapterInfo> {
    return probe(this.id);
  }
  capabilities(): AdapterCapabilities {
    return CAPS;
  }
  async replay(testCase: CaseFile, state: StateSnapshot): Promise<ReceiveVerdict> {
    const info = await this.info();
    if (!info.available) return errorVerdict(this.id, "", testCase.caseId, "adapter_unavailable", info.installHint);
    const input = testCase.input;
    if (!input.sender) return errorVerdict(this.id, info.version, testCase.caseId, "adapter_unavailable", "stellar-check requires a sender (PaymentIntent.source) and this case records none");
    const asset = input.asset.kind === "native" ? { type: "native" } : input.asset.kind === "classic" ? { type: "credit", code: input.asset.code, issuer: input.asset.issuer } : { type: "contract", contractId: input.asset.contractId };
    const intent = {
      networkPassphrase: PASSPHRASE[input.network],
      source: input.sender,
      destination: input.destination,
      asset,
      amount: input.amount,
      feeBudget: stroopsToDecimal(state.networkParams?.baseFeeStroops ?? "100"),
      ...(input.memo ? { memo: { type: input.memo.type, value: input.memo.value } } : {}),
    };
    try {
      const provider = new HorizonProvider(REPLAY_HORIZON_URL, { fetch: horizonFetch(state) });
      const report = await checkPayment(intent, provider);
      return mapStellarCheckReport(report, testCase, info.version);
    } catch (e) {
      return errorVerdict(this.id, info.version, testCase.caseId, "threw", (e as Error).message);
    }
  }
}
