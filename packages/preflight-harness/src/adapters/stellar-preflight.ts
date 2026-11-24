// SPDX-License-Identifier: Apache-2.0
// Stellar-Preflight adapter (PFH-010). The library is not on npm; scripts/fetch-competitors.sh clones it into
// .competitors/. Executing downloaded third-party code needs the user's say-so (AGENTS.md rule 3), so the clone is
// imported ONLY when it exists AND the user set PFH_ALLOW_COMPETITOR_CODE=1. Otherwise every verdict carries
// error.kind "adapter_unavailable" with the reason, and reports show the column as "not run", never as a gap.
import { MuxedAccount } from "@stellar/stellar-sdk";
import type { CaseFile, ReceiveVerdict, StateSnapshot } from "../types.ts";
import type { AdapterCapabilities, AdapterInfo, LibraryAdapter } from "./types.ts";
import { PREFLIGHT_ENTRY, probe } from "./probe.ts";
import { snapshotChain } from "./feed-preflight.ts";
import { mapPreflightResult } from "./map-stellar-preflight.ts";
import type { PreflightResultLike } from "./map-stellar-preflight.ts";
import { errorVerdict } from "./map-common.ts";
import { canonicalCall, decimalToStroops } from "./canonical.ts";

/** Capabilities as read from source (SPEC section 5.2). */
const CAPS: AdapterCapabilities = {
  classicDestination: true,
  nativeDestination: true,
  muxedDestination: true,
  contractDestination: true,
  sacTransfer: true,
  sep41Token: true,
  memoRequired: true,
  federation: false,
  distinguishesMaintainLiabilities: true,
  acceptsInjectedState: true,
  requiresSender: false,
  usesSenderForSimulation: true,
};

type PreflightFn = (input: { network: "testnet" | "mainnet"; recipient: string; asset: string; amount: string; from?: string }, opts: { chain: unknown }) => Promise<PreflightResultLike>;

/** The recorded SAC transfer simulation for this case, if any: its contract error code refines TRANSFER_SIMULATION_FAILED. */
function recordedTransferError(testCase: CaseFile, state: StateSnapshot): number | undefined {
  const { sender, destination, amount, asset } = testCase.input;
  if (!sender) return undefined;
  const units = decimalToStroops(amount);
  if (units === null) return undefined;
  const token = asset.kind === "contract" ? asset.contractId : Object.entries(state.contracts).find(([, c]) => c.kind === "sac" && c.wraps && (asset.kind === "native" ? c.wraps.kind === "native" : c.wraps.kind === "classic" && c.wraps.code === asset.code && c.wraps.issuer === asset.issuer))?.[0];
  if (!token) return undefined;
  const to = destination.startsWith("M") ? MuxedAccount.fromAddress(destination, "0").baseAccount().accountId() : destination;
  const sim = state.simulations.find((s) => s.call === canonicalCall(token, "transfer", [sender, to, units]));
  return sim && !sim.result.ok ? sim.result.contractErrorCode : undefined;
}

export class StellarPreflightAdapter implements LibraryAdapter {
  readonly id = "stellar-preflight" as const;
  private fn: PreflightFn | undefined;
  info(): Promise<AdapterInfo> {
    return probe(this.id);
  }
  capabilities(): AdapterCapabilities {
    return CAPS;
  }
  private async load(): Promise<PreflightFn> {
    if (!this.fn) {
      const mod = (await import(PREFLIGHT_ENTRY)) as { preflight: PreflightFn };
      this.fn = mod.preflight;
    }
    return this.fn;
  }
  async replay(testCase: CaseFile, state: StateSnapshot): Promise<ReceiveVerdict> {
    const info = await this.info();
    if (!info.available) return errorVerdict(this.id, "", testCase.caseId, "adapter_unavailable", info.installHint);
    const input = testCase.input;
    const asset = input.asset.kind === "native" ? "XLM" : input.asset.kind === "classic" ? `${input.asset.code}:${input.asset.issuer}` : input.asset.contractId;
    try {
      const preflight = await this.load();
      const result = await preflight({ network: input.network, recipient: input.destination, asset, amount: input.amount, ...(input.sender ? { from: input.sender } : {}) }, { chain: snapshotChain(state) });
      const code = recordedTransferError(testCase, state);
      return mapPreflightResult(result, testCase, code === undefined ? {} : { simulationErrorCode: code }, info.version);
    } catch (e) {
      return errorVerdict(this.id, info.version, testCase.caseId, "threw", (e as Error).message);
    }
  }
}
