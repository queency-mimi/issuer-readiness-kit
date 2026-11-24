# DEPLOY: preflight-harness (later phase)

<!-- SPDX-License-Identifier: Apache-2.0 -->

Checklist for when the owner decides to host or publish. As of 2026-11-08 nothing has been hosted, published or pushed. There is no git repository for the kit yet.

## 1. What gets shipped

| Artifact | Where | Build | Notes |
|---|---|---|---|
| Web report | Any static host (GitHub Pages, Cloudflare Pages, Netlify, S3) | `pnpm install --frozen-lockfile && pnpm demo:data && cd web && pnpm install --frozen-lockfile && pnpm build` -> `web/dist/` | Fully static, `base: './'`, no runtime network calls, no env vars. Hash routing (`#/matrix`), so no rewrite rules are needed. |
| ScenarioPack JSON | Served inside the web report (`dtc-wallet-readiness.pack.json`) and committed at `fixtures/packs/` | `pnpm export-pack` | dtc-kit consumes it. Keep the disclaimer verbatim. Never label it DTC-compatible (G-DTCC). |
| Harness CLI (optional) | npm, for example `@sik/preflight-harness` | none: Node >= 22.18 runs the TypeScript directly (type stripping) | Before publishing: remove `"private": true`, choose the final name, add `files` (src/, schemas/, fixtures/cases/, README, LICENSE), and decide whether `stellagate-core`/`stellar-check` become peer dependencies. Node refuses to strip types inside `node_modules`, so a published package must ship compiled JS (`tsc` emit). That build step is not written yet. |
| GitHub Action (optional) | A composite action that runs `pfh run --fail-on-findings` in a library's CI | `node src/cli.ts run --adapters <id> --fail-on-findings` | Not written. It would need the fixtures shipped with it, and it must not need secrets. |

No crates, no contracts and no testnet contract IDs belong to this project's MVP. The SAC contracts in the fixtures are testnet Stellar Asset Contracts created during seeding. They are recorded in `fixtures/seed-runs/2026-11-08.json` and expire on the next testnet reset.

## 2. Pre-publish checks

```bash
pnpm install --frozen-lockfile
pnpm check                                    # typecheck, tests, lint, inventory
node src/cli.ts fixtures validate             # schemas, provenance, no seed-shaped strings
node src/cli.ts report --in out/verdicts.json --check out/report.json
pnpm demo:data && git diff --exit-code web/src/data/report.json   # once a repo exists: data is current
cd web && pnpm build
```

Manual checks before going live:
- The page shows "Stellar-Preflight: not run" unless the report really includes its verdicts.
- Gate badges are visible at phone width.
- `grep -rEw 'S[A-D][A-Z2-7]{54}' fixtures web/dist` finds nothing (same pattern as `scripts/lint.ts`). Use the word-boundary form: without `-w`, the pattern also matches inside 69-character muxed `M...` addresses. The lint script checks fixtures; check the dist too.
- The explorer links resolve only until the testnet reset after 2026-11-08. If one has happened, say so on the page, or re-seed (`pnpm seed:testnet`) and regenerate.

## 3. Environment variables

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `PFH_ALLOW_COMPETITOR_CODE` | `src/adapters/probe.ts` | unset | `1` lets the harness import the cloned Stellar-Preflight SDK. Leave it unset in CI unless the owner has reviewed the pinned commit. |
| `DTC_KIT_SCENARIO_PACK_SCHEMA` | `scripts/demo-data.ts` | `../dtc-kit/packages/conformance/schema/scenario-pack.schema.json` | Path to dtc-kit's schema for pack validation, when the sibling project is not next door. |
| `NODE_OPTIONS=--dns-result-order=ipv4first` | `scripts/fetch-competitors.sh` | unset | Only on networks where IPv6 to the npm registry fails. |

The web build takes no environment variables. Nothing needs a secret.

## 4. Must never go to mainnet

- No signing or submission on mainnet, ever (G-VALUE). The capture code allow-lists Horizon GET and the RPC methods `getLatestLedger`, `getLedgerEntries`, `simulateTransaction` (unsigned), `getHealth`, `getVersionInfo` and `getNetwork` (`src/fixtures/capture.ts`). `seedTestnetCase` throws `PFH_E_CAPTURE_WRITE_ATTEMPT` for any non-testnet passphrase. Keep both guards.
- No keys in the repo or the dist (G-SECRETS). Seeding uses `Keypair.random()` in memory only.
- Never call a SEP-8 approval server (`AGENTS.md` rule 2).
- Nothing posted to library authors' repos (G-OUTREACH). Findings become `drafts/` for the owner.

## 5. Licences to carry

Apache-2.0 for this project. The libraries under test keep their own licences (Stellar-Preflight MIT; stellagate-core and stellar-check Apache-2.0). None is vendored or copied. The Geist and Geist Mono fonts are bundled from `@fontsource-variable` (SIL OFL 1.1). The OFL text must ship with any distribution of `web/dist`.
