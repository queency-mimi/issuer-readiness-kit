// SPDX-License-Identifier: Apache-2.0
// Generates the SYNTHETIC fixtures under fixtures/synthetic/. They exist only to unit-test the loader, schemas and
// adapters offline. They are never ground truth, never appear in a diff report's headline numbers, and carry
// provenance kind "synthetic". Addresses are strkeys derived from fixed byte patterns: no private key exists.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";

const root = new URL("../../../fixtures/preflight-harness/synthetic/", import.meta.url).pathname;
const g = (label: string): string => StrKey.encodeEd25519PublicKey(Buffer.from(Array.from({ length: 32 }, (_, i) => (label.charCodeAt(i % label.length) * 7 + i * 13) & 255)));

const ISSUER = g("synthetic-issuer");
const DEST = g("synthetic-destination");
const SENDER = g("synthetic-sender");
const CAPTURED_AT = "2026-10-31T00:00:00Z";

const emptyFlags = { authRequired: false, authRevocable: false, authImmutable: false, clawbackEnabled: false };
const account = (trustlines: unknown[] = []) => ({ balance: "100000000", subentryCount: trustlines.length, numSponsoring: 0, numSponsored: 0, flags: emptyFlags, data: {}, trustlines });
const line = (balance: string, limit: string) => ({ asset: { code: "TEST", issuer: ISSUER }, balance, limit, buyingLiabilities: "0", sellingLiabilities: "0", authorized: true, authorizedToMaintainLiabilities: false, clawbackEnabled: false });

function write(caseId: string, title: string, tags: string[], destLines: unknown[], expected: Record<string, unknown>): void {
  const dir = join(root, caseId);
  mkdirSync(dir, { recursive: true });
  const testCase = {
    schema: "sik.case/1", caseId, title, tags,
    input: { network: "testnet", destination: DEST, asset: { kind: "classic", code: "TEST", issuer: ISSUER }, amount: "10", sender: SENDER },
    expected, captured: true,
  };
  const state = {
    schema: "sik.state-snapshot/1", network: "testnet", ledger: 1, capturedAt: CAPTURED_AT,
    accounts: { [ISSUER]: account(), [DEST]: account(destLines), [SENDER]: account([line("500000000", "9223372036854775807")]) },
    contracts: {}, sacBalances: {}, simulations: [],
    networkParams: { baseReserveStroops: "5000000", baseFeeStroops: "100" },
  };
  const prov = (fixture: string) => ({
    fixture, capturedAt: CAPTURED_AT, script: "scripts/make-synthetic-fixtures.ts", network: "testnet",
    source: { kind: "synthetic", urls: [] }, ledger: 1, readsAreAtomic: false, containsSecrets: false,
    notes: "Synthetic: hand-specified state for unit tests. Not captured from any network; never ground truth.",
  });
  writeFileSync(join(dir, "case.json"), JSON.stringify(testCase, null, 2) + "\n");
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2) + "\n");
  writeFileSync(join(dir, "state.provenance.json"), JSON.stringify(prov("state.json"), null, 2) + "\n");
}

write("synthetic.trustline-missing", "Synthetic: funded destination without a trustline", ["@classic", "@synthetic"], [], {
  mustReport: ["TRUSTLINE_MISSING"], verdict: "cannot_receive", rationale: "[I] Synthetic copy of classic.trustline-missing for adapter unit tests.",
});
write("synthetic.ready", "Synthetic: authorised trustline with room", ["@classic", "@synthetic"], [line("0", "10000000000")], {
  mustReport: [], mustNotReport: ["TRUSTLINE_MISSING", "TRUSTLINE_LIMIT_EXCEEDED"], verdict: "can_receive", rationale: "[I] Synthetic copy of classic.ready.",
});
process.stdout.write("wrote 2 synthetic fixtures\n");
