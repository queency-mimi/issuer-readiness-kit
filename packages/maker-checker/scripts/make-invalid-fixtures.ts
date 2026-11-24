// SPDX-License-Identifier: Apache-2.0
// Regenerates fixtures/policies/invalid/* from fixtures/policies/example-treasury.policy.json.
// Each case mutates a clone of the valid example so that exactly one rule in SPEC section 2.5 fails.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Doc = any; // eslint-free scaffold: the mutation targets are deliberately untyped
const root = new URL("../../../fixtures/maker-checker/policies/", import.meta.url).pathname;
const baseText = readFileSync(join(root, "example-treasury.policy.json"), "utf8");
const clone = (): Doc => JSON.parse(baseText);

const RWA = "CDTSGNX7CHP3Q67DCRIGGLB6BTS2QECBPWIFS2ZZCLKT23VKXWDJQ37D";
const cases: { name: string; code: string; mutate?: (d: Doc) => void; raw?: string }[] = [
  { name: "unknown-field", code: "PD_UNKNOWN_FIELD", mutate: (d) => { d.surprise = true; } },
  { name: "principals-unsorted", code: "PD_NOT_SORTED", mutate: (d) => { d.principals.reverse(); } },
  { name: "duplicate-principal-id", code: "PD_DUPLICATE_ID", mutate: (d) => { d.principals.splice(1, 0, structuredClone(d.principals[1])); } },
  { name: "maker-without-maker-role", code: "PD_ROLE_MISSING", mutate: (d) => { d.rules[0].makers = ["checker-bob"]; } },
  { name: "groups-overlap", code: "PD_GROUPS_OVERLAP", mutate: (d) => { d.rules[0].approval.admins.from = ["admin-dana", "checker-bob"]; d.principals[0].roles = ["admin", "checker"]; } },
  { name: "min-exceeds-from", code: "PD_MIN_EXCEEDS_FROM", mutate: (d) => { d.rules[1].approval.checkers.min = 3; } },
  { name: "allow-without-approval", code: "PD_ALLOW_NEEDS_APPROVAL", mutate: (d) => { delete d.rules[1].approval; } },
  { name: "deny-with-approval", code: "PD_DENY_HAS_ACTION_FIELDS", mutate: (d) => { d.rules[2].approval = { checkers: { min: 1, from: ["checker-bob"] } }; } },
  { name: "wildcard-function", code: "PD_BAD_VALUE", mutate: (d) => { d.rules[0].match.targets[0].functions[0].name = "*"; } },
  { name: "sep53-without-address", code: "PD_SEP53_NEEDS_ADDRESS", mutate: (d) => { delete d.principals[1].address; } },
  { name: "validity-inverted", code: "PD_VALIDITY_ORDER", mutate: (d) => { d.validity.expiresAt = "2026-10-01T00:00:00Z"; } },
  { name: "passphrase-mismatch", code: "PD_NETWORK_PASSPHRASE_MISMATCH", mutate: (d) => { d.network.passphrase = "Public Global Stellar Network ; September 2015"; } },
  { name: "limit-contract-not-targeted", code: "PD_LIMIT_CONTRACT_NOT_TARGETED", mutate: (d) => { d.rules[1].limits.perRequest[0].contract = RWA; } },
  { name: "recipients-without-recipient-arg", code: "PD_RECIPIENT_ARG_MISSING", mutate: (d) => { delete d.rules[1].match.targets[0].functions[0].recipientArg; } },
  { name: "window-inverted", code: "PD_WINDOW_ORDER", mutate: (d) => { d.rules[0].windows[0].startUtc = "18:00"; d.rules[0].windows[0].endUtc = "08:00"; } },
  { name: "controlkind-without-function", code: "PD_CONTROLKIND_FUNCTION_MISMATCH", mutate: (d) => { d.rules[0].match.targets[0].functions = d.rules[0].match.targets[0].functions.filter((f: { name: string }) => f.name !== "pause"); } },
  { name: "address-bad-checksum", code: "PD_ADDRESS_INVALID", mutate: (d) => { const a: string = d.principals[0].address; d.principals[0].address = a.slice(0, -1) + (a.endsWith("W") ? "X" : "W"); } },
  { name: "muxed-recipient", code: "PD_ADDRESS_INVALID", mutate: (d) => { const f = d.rules[1].match.targets[0].functions[0]; f.recipients[0] = "M" + f.recipients[0].slice(1) + "AAAAAAAAAAAAA"; } },
  { name: "duplicate-key", code: "PD_DUPLICATE_KEY", raw: baseText.replace('"version": 1,', '"version": 1,\n  "version": 1,') },
  { name: "version-2", code: "PD_VERSION_UNSUPPORTED", mutate: (d) => { d.version = 2; } },
];

mkdirSync(join(root, "invalid"), { recursive: true });
const expect: Record<string, string> = {};
for (const c of cases) {
  let text = c.raw;
  if (text === undefined) {
    const d = clone();
    c.mutate?.(d);
    text = JSON.stringify(d, null, 2) + "\n";
  }
  writeFileSync(join(root, "invalid", `${c.name}.policy.json`), text);
  expect[`${c.name}.policy.json`] = c.code;
}
writeFileSync(
  join(root, "invalid", "EXPECT.json"),
  JSON.stringify({ note: "Each file must produce at least this violation code (SPEC section 2.5). Regenerate with scripts/make-invalid-fixtures.ts.", expect }, null, 2) + "\n",
);
process.stdout.write(`wrote ${cases.length} invalid fixtures\n`);
