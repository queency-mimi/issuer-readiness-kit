// SPDX-License-Identifier: Apache-2.0
// Node-only (reads the holders-at-ledger schema from disk). Browser code imports "@sik/dtc-kit-reconciliation/browser".
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { CapturedPosition, LedgerId } from "@sik/dtc-kit-core";

/**
 * CONTRACT: the HoldersSnapshot JSON shape is owned by the holders-at-ledger project
 * (docs/holders-at-ledger/SPEC.md section 3; schema schemas/holders-at-ledger/holders-snapshot.schema.json, $id
 * urn:sik:holders-at-ledger:schema:holders-snapshot:1.0.0). This package does NOT redefine it: the input is
 * `unknown` and is validated against that project's published schema, read from disk (DTC_HAL_SCHEMA, or the
 * in-repo copy under schemas/holders-at-ledger/). Only the members needed here are read after validation.
 */
export const HAL_SCHEMA_DEFAULT_PATH = fileURLToPath(new URL("../../../schemas/holders-at-ledger/holders-snapshot.schema.json", import.meta.url));

export class SnapshotRejected extends Error {
  readonly code: "SCHEMA" | "SCHEMA_UNAVAILABLE" | "ASSET_MISMATCH";
  constructor(code: SnapshotRejected["code"], message: string) {
    super(`${code}: ${message}`);
    this.name = "SnapshotRejected";
    this.code = code;
  }
}

let validator: ((d: unknown) => boolean) & { errors?: { instancePath: string; message?: string; params?: unknown }[] | null } = undefined as never;

function validate(doc: unknown, schemaPath: string): void {
  if (!validator) {
    if (!existsSync(schemaPath)) throw new SnapshotRejected("SCHEMA_UNAVAILABLE", `holders-at-ledger schema not found at ${schemaPath}; set DTC_HAL_SCHEMA`);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats.default(ajv);
    validator = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
  }
  if (!validator(doc)) {
    const problems = (validator.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"} ${JSON.stringify(e.params ?? {})}`);
    throw new SnapshotRejected("SCHEMA", problems.join("; "));
  }
}

interface ValidatedSnapshot {
  asset: { canonical: string; decimals: number };
  at: { ledgerSequence: number; closedAt: string };
  holders: { address: string; holderType: string; balance: string }[];
  reconciliation: { status: string; holdersSum: string };
  snapshotHash: string;
  holdersHash: string;
}

export interface MappedSnapshot {
  /** Balances in the asset's BASE units (lossless). For a decimals-0 DTC token these are whole tokens. */
  positions: CapturedPosition[];
  /** Claimable balances and liquidity pools: holders of supply, but not wallets a registry can register. */
  excluded: { address: string; holderType: string; balance: bigint }[];
  ledger: LedgerId;
  ledgerSeq: number;
  closedAt: string;
  decimals: number;
  /** The snapshot's own hash (sha256:...), the value to compare in a reconciliation. */
  supplyHash: string;
  holdersHash: string;
  holdersSum: bigint;
  reconciliation: string;
}

/** Map a HoldersSnapshot document to record-date positions (DTC-032). */
export function positionsFromHoldersSnapshot(snapshot: unknown, expect: { ledger: LedgerId; asset: string }, opts: { schemaPath?: string } = {}): MappedSnapshot {
  validate(snapshot, opts.schemaPath ?? process.env["DTC_HAL_SCHEMA"] ?? HAL_SCHEMA_DEFAULT_PATH);
  const s = snapshot as ValidatedSnapshot;
  if (s.asset.canonical !== expect.asset) throw new SnapshotRejected("ASSET_MISMATCH", `snapshot is for ${s.asset.canonical}, expected ${expect.asset}`);
  const positions: CapturedPosition[] = [];
  const excluded: MappedSnapshot["excluded"] = [];
  for (const h of s.holders) {
    const balance = BigInt(h.balance);
    if (h.holderType === "account" || h.holderType === "contract") positions.push({ address: h.address, tokens: balance });
    else excluded.push({ address: h.address, holderType: h.holderType, balance });
  }
  return {
    positions,
    excluded,
    ledger: expect.ledger,
    ledgerSeq: s.at.ledgerSequence,
    closedAt: s.at.closedAt,
    decimals: s.asset.decimals,
    supplyHash: s.snapshotHash,
    holdersHash: s.holdersHash,
    holdersSum: BigInt(s.reconciliation.holdersSum),
    reconciliation: s.reconciliation.status,
  };
}
