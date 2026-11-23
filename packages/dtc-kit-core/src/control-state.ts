// SPDX-License-Identifier: Apache-2.0
import type { ResolvedProfile } from "@sik/dtc-kit-profile-spec/pure";
import { trustLabel } from "./trust.ts";
import type { TrustLabel } from "./types.ts";
import type { WalletStatus } from "./wallet-registration.ts";

/** What a wallet status does to traffic. Row wallet.control-state-semantics is `inferred`; results carry that label. */
export interface Restriction {
  blocksInbound: boolean;
  blocksOutbound: boolean;
  trust: TrustLabel;
}

export const CONTROL_ROW = "wallet.control-state-semantics";
export const TAXONOMY_ROW = "wallet.registration-status-taxonomy";
export const REGISTERED_ONLY_ROW = "token.transfer-only-to-registered-wallets";

/** The DTC control states (chill and locks). Their effects come from CONTROL_ROW. */
export const CONTROL_STATES = ["Delivery Order Chill", "Global Lock", "Compliance Lock"] as const satisfies readonly WalletStatus[];
export const isControlState = (s: WalletStatus): s is (typeof CONTROL_STATES)[number] => (CONTROL_STATES as readonly string[]).includes(s);

type ControlSemantics = Partial<Record<string, { blocksInbound?: boolean; blocksOutbound?: boolean }>>;

/**
 * Map a wallet status to its traffic restriction by reading the profile, never by hard-coding (DTC-003).
 * - Control states: read CONTROL_ROW. A state missing from the row is blocked both ways and labelled unknown.
 * - Completed: nothing blocked (published taxonomy row).
 * - Processing, Failed, Failed Compliance: not allowlisted, so cannot receive (published rows: taxonomy and
 *   transfer-only-to-registered-wallets); outbound is not blocked by the status itself.
 */
export function restrictionFor(status: WalletStatus, profile: ResolvedProfile): Restriction {
  if (isControlState(status)) {
    const row = profile.rows.get(CONTROL_ROW);
    const entry = row && row.status !== "unknown" ? (row.value as ControlSemantics)[status] : undefined;
    if (!entry || typeof entry.blocksInbound !== "boolean" || typeof entry.blocksOutbound !== "boolean") {
      return { blocksInbound: true, blocksOutbound: true, trust: trustLabel(profile, [`${CONTROL_ROW}#${status}`]) };
    }
    return { blocksInbound: entry.blocksInbound, blocksOutbound: entry.blocksOutbound, trust: trustLabel(profile, [CONTROL_ROW]) };
  }
  if (status === "Completed") {
    return { blocksInbound: false, blocksOutbound: false, trust: trustLabel(profile, [TAXONOMY_ROW]) };
  }
  return { blocksInbound: true, blocksOutbound: false, trust: trustLabel(profile, [TAXONOMY_ROW, REGISTERED_ONLY_ROW]) };
}

/** Corporate-action windows during which DTC chills wallets. Rule text lives in profile rows; this is a hook. */
export interface ChillWindow {
  eventId: string;
  from: string;
  until: string;
}

/** True when `at` falls in any window, start inclusive, end exclusive. Instants compare as absolute time. */
export function isChilled(windows: readonly ChillWindow[], at: string): boolean {
  const t = Date.parse(at);
  if (Number.isNaN(t)) throw new Error(`invalid instant ${at}`);
  return windows.some((w) => Date.parse(w.from) <= t && t < Date.parse(w.until));
}
