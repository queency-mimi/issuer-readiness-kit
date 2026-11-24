// SPDX-License-Identifier: Apache-2.0
// stellagate-core adapter (PFH-011). Replay feeds the library's own Horizon reader (horizonAccountSource) through a
// snapshot-backed fetch, and a snapshot-backed ContractSource; directory lookups are off unless recorded.
import { check, horizonAccountSource } from "stellagate-core";
import type { ContractSource, DirectorySource, FederationResolver } from "stellagate-core";
import type { CaseFile, ReceiveVerdict, StateSnapshot } from "../types.ts";
import type { AdapterCapabilities, AdapterInfo, LibraryAdapter } from "./types.ts";
import { probe } from "./probe.ts";
import { horizonFetch, REPLAY_HORIZON_URL } from "./feed-horizon.ts";
import { mapStellagateVerdict } from "./map-stellagate.ts";
import { errorVerdict } from "./map-common.ts";

/** Capabilities as read from source on 2026-10-31 (SPEC section 5.2); checked by test/capabilities.test.ts. */
const CAPS: AdapterCapabilities = {
  classicDestination: true,
  nativeDestination: true,
  muxedDestination: true,
  contractDestination: true,
  sacTransfer: false,
  sep41Token: false,
  memoRequired: true,
  federation: true,
  distinguishesMaintainLiabilities: false,
  acceptsInjectedState: true,
  requiresSender: false,
  usesSenderForSimulation: false,
};

function contractSource(state: StateSnapshot): ContractSource {
  return {
    async contractExists(id) {
      const c = state.contracts[id];
      if (!c) throw new Error(`contract ${id} not recorded in this snapshot`);
      return c.exists;
    },
    async sacBalance(sacId, holder) {
      const key = `${sacId}:${holder}`;
      if (!(key in state.sacBalances)) throw new Error(`SAC balance ${key} not recorded in this snapshot`);
      const b = state.sacBalances[key];
      return b ? { amount: BigInt(b.amount), authorized: b.authorized } : null;
    },
  };
}

function directorySource(state: StateSnapshot): DirectorySource | null {
  const dir = state.directory;
  if (!dir) return null;
  return {
    async lookup(address) {
      if (!(address in dir)) throw new Error(`directory entry for ${address} not recorded`);
      const e = dir[address];
      return e ? { tags: e.tags, ...(e.name ? { name: e.name } : {}) } : null;
    },
  };
}

function federation(state: StateSnapshot): FederationResolver {
  return {
    async resolve(address) {
      const r = state.federation?.[address];
      if (!r) throw new Error(`federation answer for ${address} not recorded`);
      return r;
    },
  };
}

export function stellagateAssetString(testCase: CaseFile): string | null {
  const a = testCase.input.asset;
  if (a.kind === "native") return "native";
  if (a.kind === "classic") return `${a.code}:${a.issuer}`;
  return null;
}

export class StellagateAdapter implements LibraryAdapter {
  readonly id = "stellagate-core" as const;
  info(): Promise<AdapterInfo> {
    return probe(this.id);
  }
  capabilities(): AdapterCapabilities {
    return CAPS;
  }
  async replay(testCase: CaseFile, state: StateSnapshot): Promise<ReceiveVerdict> {
    const info = await this.info();
    if (!info.available) return errorVerdict(this.id, "", testCase.caseId, "adapter_unavailable", info.installHint);
    const asset = stellagateAssetString(testCase);
    if (asset === null) return errorVerdict(this.id, info.version, testCase.caseId, "adapter_unavailable", "stellagate-core takes native or CODE:ISSUER assets only; contract token ids are out of its scope");
    const input = testCase.input;
    try {
      const verdict = await check({
        to: input.destination,
        ...(input.sender ? { from: input.sender } : {}),
        ...(input.memo ? { memo: input.memo.value } : {}),
        asset,
        amount: input.amount,
        network: input.network === "mainnet" ? "public" : "testnet",
        accounts: horizonAccountSource(REPLAY_HORIZON_URL, horizonFetch(state)),
        contracts: contractSource(state),
        federation: federation(state),
        directory: directorySource(state),
      });
      return mapStellagateVerdict(verdict, testCase, info.version);
    } catch (e) {
      return errorVerdict(this.id, info.version, testCase.caseId, "threw", (e as Error).message);
    }
  }
}
