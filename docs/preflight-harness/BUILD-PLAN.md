# BUILD-PLAN: preflight-harness

Estimates [E], not measured. "Needs the user" marks steps an agent must not take alone.

| Milestone | Tickets | Exit criteria | Est. [E] | Needs the user |
|---|---|---|---|---|
| M0 Scaffold | (this state) | `pnpm install && pnpm check` green; `node src/cli.ts adapters` shows stellagate-core and stellar-check available; taxonomy, mapping tables, 32-case catalogue, 12 DTC scenarios exist and are tested for consistency | done | go/no-go on Phase 0 scope (`docs/ROADMAP.md`) |
| M1 Mapping and derivation | PFH-001..005, 009 | each library's raw output maps to `ReceiveVerdict` for every code it can emit; derivation table-tested; inventory check passes | 4-5 days | none |
| M2 Offline harness | PFH-003, 006, 007, 008, 010..013 | `pfh run` on the synthetic fixtures with all available adapters prints a matrix; report golden test; capability claims verified | 7-9 days | **run `scripts/fetch-competitors.sh` once** (installs third-party code) for the Stellar-Preflight adapter |
| M3 Real fixtures | PFH-020..023, 025 | 32 cases captured with provenance (31 on testnet, SEP-8 on mainnet read-only); ground truth for classic cases from Horizon results | 8-10 days | none (testnet writes with throwaway keys; mainnet GET only) |
| M4 Findings | PFH-024, 030..034, 035, 036 | published disagreement table; SIM facts re-tagged; drafts of upstream issues | 6-8 days | decide whether to send any draft (G-OUTREACH) |
| M5 DTC pack | PFH-026..029 | 12 scenarios evaluated; pack exported with disclaimer and weakest-status tags; refs validated against dtc-kit profile files | 4-5 days | dtc-kit widening the `ticket` pattern unblocks PFH-028 |

This matches `docs/ROADMAP.md`: Phase 0 "install and run the three existing libraries against a shared fixture set" (M1-M3, with the Stellar-Preflight install caveat) and Phase 2 "DTC registered-wallet readiness scenarios" (M5).

## Cheapest useful deliverable

The discovery note's option 1: a disagreement table across the three libraries. That is M1 + M2 + M3 + PFH-024, about 3 to 4 weeks of agent sessions on paper [E]; a first partial table over the two npm libraries and the synthetic fixtures is available after M2 (about 2 weeks [E]) without any network.

## What the plan avoids

A fourth implementation of receive checking; batch mode; remedy routing; calling SEP-8 servers. If SDF ships `preflightPayment` (js-stellar-sdk #1601, open on 2026-10-31, milestone Q4), add it as a fourth adapter (the interface is the cost, about 3 days [E]) and compare it against the three: that is a better use of the harness than competing with it.

## Calendar anchors

Protocol 30 testnet vote 2026-11-03, mainnet 2026-11-23: re-run PFH-030 and PFH-022 afterwards. The three libraries are weeks old (created 2026-09-06, 2026-10-03, 2026-10-08) and may change under the harness; the inventory check (PFH-001) and pinned versions protect the baseline.
