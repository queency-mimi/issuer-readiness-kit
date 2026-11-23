// SPDX-License-Identifier: Apache-2.0
import type { RowStatus } from "@sik/dtc-kit-profile-spec/pure";

export type TrustTag = "@published" | "@inferred" | "@unknown";
export type AdapterTag = "@stellar-sac" | "@stellar-sep57";
export type RunTag = "@testnet" | "@slow";
export type ScenarioTag = TrustTag | AdapterTag | RunTag;

export const TRUST_TAGS: readonly TrustTag[] = ["@published", "@inferred", "@unknown"];
export const ADAPTER_TAGS: readonly AdapterTag[] = ["@stellar-sac", "@stellar-sep57"];

export type ScenarioArea =
  | "infrastructure"
  | "wallet"
  | "transfer"
  | "conversion"
  | "control"
  | "override"
  | "corporate-action"
  | "stellar"
  | "vendor";

export interface Scenario {
  id: string;
  title: string;
  area: ScenarioArea;
  tags: ScenarioTag[];
  /** Profile rows whose VALUE the scenario asserts. Weakest status decides the trust tag. */
  requiresRows: string[];
  onUnknown: "skip" | "run-and-label";
  given: string[];
  when: string;
  /** Expected results. */
  then: string[];
  status: "catalogue" | "implemented";
  /** Implementing ticket. */
  ticket: string;
  testFile?: string;
}

/** Contract shared with token-invariants and preflight-harness. Schema: schema/scenario-pack.schema.json. */
export interface ScenarioPack {
  packFormat: "1";
  packId: string;
  version: string;
  title: string;
  profile: string;
  disclaimer: string;
  scenarios: Scenario[];
}

export const TRUST_TAG_FOR: Record<RowStatus, TrustTag> = {
  published: "@published",
  inferred: "@inferred",
  unknown: "@unknown",
};
