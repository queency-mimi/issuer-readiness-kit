// SPDX-License-Identifier: Apache-2.0
import type { AdapterId } from "../taxonomy/library-maps.ts";
import { StellagateAdapter } from "./stellagate-core.ts";
import { StellarCheckAdapter } from "./stellar-check.ts";
import { StellarPreflightAdapter } from "./stellar-preflight.ts";
import type { LibraryAdapter } from "./types.ts";

export const ADAPTER_IDS: AdapterId[] = ["stellar-preflight", "stellagate-core", "stellar-check"];

export function createAdapter(id: AdapterId): LibraryAdapter {
  switch (id) {
    case "stellar-preflight":
      return new StellarPreflightAdapter();
    case "stellagate-core":
      return new StellagateAdapter();
    case "stellar-check":
      return new StellarCheckAdapter();
  }
}

export function createAllAdapters(): LibraryAdapter[] {
  return ADAPTER_IDS.map(createAdapter);
}
