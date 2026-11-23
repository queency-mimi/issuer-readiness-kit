# BUILD-PLAN

Estimates are `[E]`: judgement, not measured, for ONE agent working sequentially unless stated; the programme roadmap assumes 5-15 engineers in parallel, in which case wall-clock is shorter. Calendar anchors from docs/ROADMAP.md: Protocol 30 votes 2026-11-03 (testnet) and 2026-11-23 (mainnet); DTCC lists Stellar as anticipated 2027; earliest participant testing with DTCC probably Q1 2027 [I].

## M0: scaffold (DONE 2026-10-31)

Exit: `pnpm check` green; two profiles validate; catalogue lint clean; docs written. Needs the user: go/no-go on Phase 1 scope.

## M1: core + profile tooling (tickets DTC-001..DTC-010, DTC-006) [E: 8-12 sessions]

Exit criteria:
- Every reducer implemented with table tests over all (state, event) pairs; no `NotImplemented` left in `packages/core`.
- `pnpm profiles check` works; every `published` generic row re-verified against its primary source or downgraded (DTC-006).
- Every output of core carries a `TrustLabel`.
Needs the user: for DTC-006, the SEC no-action letter PDF (403 to curl; do not bypass) if a fresh copy is wanted.

## M2: sandbox + five scenarios (DTC-011..DTC-017) [E: 7-10 sessions]

Exit criteria: the five scripted scenarios pass in CI against an in-process server; CSV exports; corporate-action event with one consolidated credit; docker-compose runs on a machine with docker (DTC-017). Needs the user: a machine with docker (not installed on the scaffold machine).

## M3: Stellar adapters on testnet (DTC-020..DTC-028) [E: 9-13 sessions]

Exit criteria: spikes DTC-020, 022, 024, 028 answered with fixtures and provenance; both adapters plan and submit on testnet or a local network with throwaway keys; capability matrices upgraded from `I`/`U` to `P` where fixtures prove them; SC-018, SC-019, SC-020, SC-029, SC-030, SC-031, SC-032 produce results. Needs the user: nothing, unless a Stellar quickstart image tag is chosen (record it in TESTING.md). G-VALUE stays closed.

## M4: conformance + reconciliation (DTC-018, 019, 030, 033..035, 037, 038) [E: 9-13 sessions]

Exit criteria: runner reports pass/fail/skipped/observed with trust labels; 30+ scenarios implemented or explicitly observation-only; allocation property tests pass 10,000 cases; reconciliation runs end to end on a sandbox corporate action; SC-035 has a measured budget. DTC-032 needs the holders-at-ledger SPEC (BLOCKED until it exists).

## M5: readiness pack and publication readiness (DTC-029, 031, 036, 039, 040) [E: 5-7 sessions]

Exit criteria: pack tables generated from data; vendor matrix refreshed with dated sources; watcher reports a diff-free run; publication runbook rehearsed. Needs the user: sending the drafted questions (vendors, DTCC/SDF) and deciding the design-partner path (a wallet/custody vendor is the scarce upstream integration point [I]).

## Phase 3 (outside events; not scheduled)

- DTCC publishes Stellar requirements: rewrite `dtc-stellar.json` rows (`unknown` -> `published` with primary URLs), re-run conformance, publish the diff. Possibly never fully public: wallet connectivity and checklists sit behind Learning Center login, so "wait for the spec" may mean "wait for a DTCC relationship" [I, from discovery].
- Protocol 30 mainnet (2026-11-23 vote): re-test muxed contract addresses (CAP-84) for `muxed-attribution` and `contract-address-holder`.
- SEP-41 / SEP-57 version bumps: re-run the matrices (the watcher, DTC-031, reports them).

## What would make us stop

See RISKS.md "Stop conditions".
