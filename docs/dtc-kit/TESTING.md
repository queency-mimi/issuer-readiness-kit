# TESTING

## Strategy

1. **Schema tests** (`packages/profile-spec/test`): both profile files validate against the schema; negative tests prove each status rule rejects what it should; `dtc-stellar` may contain no `published` row (G-DTCC).
2. **Catalogue tests** (`packages/conformance/test/catalogue.test.ts`): the pack validates against its schema; every required row exists; every trust tag equals the weakest required row; ids contiguous; implemented scenarios point at real files; exported JSON is not stale.
3. **Smoke test** (`packages/conformance/test/smoke.test.ts`, scenario SC-000): the sandbox server boots on an ephemeral port, `/v1/health` returns the profile lineage and the disclaimer header, a protected route without a token answers 401, the package graph links, both adapters' capability matrices are total, every implemented scenario has an executable implementation.
4. **Reducer tests** (DTC-003..010): table-driven over every (state, event) pair; property tests for invariants (release restores prior status; allocation conserves the credit).
5. **Sandbox scenario tests** (DTC-014, 019, 030): the five scripted scenarios, then the catalogue, run in-process against the mock registry.
6. **Adapter fixture tests** (DTC-020..027): transactions and events captured from testnet are replayed offline; no test needs the network unless tagged `@testnet`.
7. **Testnet tests** (`@testnet`): throwaway keys generated at runtime, Friendbot-funded, never written to disk or logs (G-SECRETS). Excluded by default.
8. **Slow tests** (`@slow`): performance of reconciliation on 10,000 wallets.

Runs use Node's built-in test runner (`node --test`) with type stripping; there is no test framework dependency.

## Commands

```
pnpm test                                   # everything non-network
node --test packages/core/test/<file>.test.ts
pnpm export-pack                            # then re-run catalogue.test.ts
```

## Fixtures

Captured by script (`scripts/capture-fixture.ts`: `writeFixture`, `verifyFixture`), never by hand. Each fixture has a sibling `<name>.provenance.json` (format in `fixtures/README.md` and the `FixtureProvenance` type): script, source kind, URL, capture time, ledger numbers, network, sha256. No private data, no keys, no login-gated DTCC content. Page-text fixtures of public DTCC pages (DTC-006) are allowed; the SEC PDF is fetched only if the user supplies it.

## Local Stellar network

`packages/sandbox/docker-compose.yml` has an optional `stellar` service (profile `stellar`) that needs `STELLAR_QUICKSTART_IMAGE`. The image tag and its command-line flags are **[U]**: they were not verified because docker is not installed on the scaffold machine. DTC-017 records the verified tag here:

| Item | Value |
|---|---|
| Quickstart image tag | (unverified, set by DTC-017) |
| Flags | (unverified) |
| Friendbot URL (testnet) | https://friendbot.stellar.org (used 2026-11-08; Node needs IPv4-first on this machine, set in the spike script) |
| Horizon (testnet) | https://horizon-testnet.stellar.org |

## Test files (2026-11-08: 260 tests, all passing)

| Area | Files |
|---|---|
| Profiles | `profile-spec/test/{profile-schema,diff,cli}.test.ts` |
| Core | `core/test/{trust,control-state,wallet-registration,transfer-precheck,conversion,force-transfer,record-date-capture,cash-allocation}.test.ts` |
| Sandbox | `sandbox/test/{five-scenarios,routes,corporate-actions,csv}.test.ts` (five scenarios also over HTTP) |
| Adapters | `adapter-stellar-sac/test/{plans,force-transfer.fixture}.test.ts` (fixture replay, no network), `adapter-stellar-sep57/test/plans.test.ts` |
| Conformance | `conformance/test/{catalogue,smoke,runner,scenarios}.test.ts` |
| Reconciliation | `reconciliation/test/{allocate,breaks,holders-source}.test.ts` (10,000 seeded cases; golden holders-at-ledger snapshot, skipped if that checkout is absent) |

## What is NOT tested (2026-11-08)

Docker build/compose; SEP-57 on any network; a live runner target against testnet (the spike script is run by hand); the web console has no automated UI tests (checked by hand in Chrome at 1440 px and 390 px, both themes).
