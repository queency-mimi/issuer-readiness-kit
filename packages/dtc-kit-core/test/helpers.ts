// SPDX-License-Identifier: Apache-2.0
import { loadBundledProfile, resolveProfile } from "@sik/dtc-kit-profile-spec";
import type { WalletRecord, WalletStatus } from "../src/index.ts";

export const profile = resolveProfile(loadBundledProfile("dtc-stellar"));

export function wallet(status: WalletStatus, over: Partial<WalletRecord> = {}): WalletRecord {
  const completedLike = status !== "Processing" && status !== "Failed" && status !== "Failed Compliance";
  return {
    id: "W-1",
    participant: "SBX-9002",
    ledger: "sandbox-ledger",
    address: "SBX-ADDR-1",
    kind: "internal",
    status,
    ofacCleared: completedLike,
    onChainAllowlisted: completedLike,
    ...(completedLike && status !== "Completed" ? { statusBeforeControl: "Completed" as const } : {}),
    ...over,
  };
}
