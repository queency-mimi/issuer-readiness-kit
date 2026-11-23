# dtc-kit: investor brief

<!-- SPDX-License-Identifier: Apache-2.0 -->

2026-11-08. One page. Tags: [P] primary source, [S] secondary, [I] inference, [E] estimate, [M] measured here. **DTC-shaped, not DTC-certified.**

## Problem

- DTCC runs a tokenization service in which DTC mints tokens for book-entry securities into participants' Registered Wallets. Its product page lists Stellar (token standard SEP-41) as anticipated in 2027 [P: dtcc.com tokenization product page, re-read 2026-10-31].
- The SEC staff no-action letter to DTC (2025-12-11) sets the conditions: only DTC participants register wallets, wallets are OFAC-screened before allowlisting, DTC keeps override ("root wallet") keys and reports their use quarterly, tokens move only to registered wallets [P: SEC NAL, via the discovery copy read 2026-10-29; sec.gov blocks scripted download].
- Of the 28 generic DTC rows, 25 cite a public DTCC or SEC source. **Those 25 were read on 2026-10-29 through discovery notes and only five were re-read since (2026-10-31); the SEC letter itself was not re-fetched. Full re-verification is pending (DTC-006).** [I: audit 2026-11-08]
- What DTCC requires of a Stellar wallet, token form, freeze mechanism or override mechanism is **not public**. The participant guides and readiness checklists are behind the DTCC Learning Center login [P: SOURCES.md, "Not read"]. In this kit's model, **0 of 18** Stellar requirement rows are published; 6 are our inference, 12 unknown [M: `pnpm profiles check`].
- So a bank, broker or wallet vendor preparing for Stellar either waits, or guesses without saying it is guessing.

## What dtc-kit does

A readiness toolkit that makes the guessing explicit:

1. **Requirement profiles**: every DTC dependency is a row with status `published | inferred | unknown`, source URL, date and confidence (JSON Schema, validated). When DTCC publishes, the data changes, not the code.
2. **DTC state machines** for wallet registration and controls, transfer pre-checks, conversion orders, overrides, record-date capture (DST-safe) and cash allocation, all reading the rows and labelling every output with its weakest row.
3. **Mock DTC registry** (HTTP API, fictional institutions, simulated clock) with five scripted participant journeys.
4. **Stellar adapters** that plan DTC actions as unsigned Stellar operations: classic asset + SAC (planned and run on testnet) and SEP-57 (planned only).
5. **Conformance runner**: 36 scenarios tagged by trust; unknown rules give `skipped` or `observed`, never a fake pass; JSON and JUnit reports.
6. **Participant reconciliation**: split DTC's one consolidated cash credit across client sub-ledgers in integer cents, report breaks, never fix them.

## Who it is for

Wallet and custody vendors who must support DTC-token operations on Stellar (the likely first design partner [I: discovery]); DTC participants preparing Stellar connectivity; Stellar issuers and SDF ecosystem teams who want DTCC's Stellar requirements tracked in one public, labelled place.

## Working today (all reproducible from the repo)

| Claim | Number | Tag |
|---|---|---|
| Tests passing (lint, typecheck, unit, property, fixture replay) | 260 of 260 | [M] 2026-11-08 |
| Readiness scenarios on the sandbox | 25 pass, 0 fail, 11 skipped (of 36) | [M] `pnpm demo:data` |
| Same pack with the SAC adapter and the recorded testnet run | 28 pass, 1 observed, 0 fail, 7 skipped | [M] |
| Stellar testnet transactions recorded from adapter plans | 15, ledgers 5,621,465 to 5,621,491 | [P] fixture with SHA-256 |
| Override as one transaction [clawback, issuer payment] | succeeded; with the destination deauthorised the whole transaction failed (`op_success, op_not_authorized`) and the holder kept 10 tokens | [P] ledgers 5,621,476 and 5,621,480 |
| Allocation invariants | 10,000 seeded random cases: sum equals credit, no negatives, order-independent | [M] |
| Allocation of 10,000 wallets / 500 clients | 91 to 134 ms (five cold runs, 4-core machine) | [M] |

## Why Stellar

DTCC lists SEP-41 for Stellar [P]. Stellar's classic assets already carry the controls DTC's model needs (authorisation-required trustlines as the allowlist, revocation, clawback) and the testnet run shows an override can be made atomic with them [P: fixture]. SEP-57 adds forced transfer, freeze and pause as contract functions [P: SEP-57 v0.4.0 text]. Which form DTCC will use is unknown, which is why the kit carries both adapters behind one port.

## Roadmap

1. SEP-57 token on testnet: observe freeze, pause and forced transfer interactions (DTC-024, DTC-026).
2. Event decoders and the contract-address question (DTC-027, DTC-028); wallet-vendor scenario pack (DTC-037).
3. Re-verify every published row against its source (DTC-006); publication watcher and runbook (DTC-031, DTC-040).
4. When DTCC publishes: rewrite rows, re-run the pack, publish the diff.

## Risks and gates

- **G-DTCC**: DTCC may never publish the Stellar rules openly; the kit then stays a readiness and vendor tool, never certification. Results are not evidence of DTC compatibility.
- **Demand is unproven** [I]: no buyer or price observed yet. First step is a design partner.
- **Absorb risk**: DTCC, SDF, OpenZeppelin or vendors may ship equivalents; pieces are small and upstreamable (PRIOR-ART.md, searched 2026-10-31; no novelty claim is made).
- **G-LEGAL**: no real sanctions data, no hosted screening, no custody. **G-VALUE**: no mainnet. Unaudited.

## What launch needs

Static hosting for the console; npm publication of the packages (profile-spec, core, sandbox, adapters, conformance, reconciliation); a container image of the sandbox (needs a machine with docker, DTC-017); an independent review of the reconciliation maths before any participant uses it on real books; a design partner. See DEPLOY.md.
