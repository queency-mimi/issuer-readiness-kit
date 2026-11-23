# dtc-kit: demo

<!-- SPDX-License-Identifier: Apache-2.0 -->

Date: 2026-11-08. **DTC-shaped, not DTC-certified.** Fictional institutions. Stellar testnet only. Not legal advice.

## 1. Run it from a clean checkout

Needs Node 24 (checked with v24.18.0) and pnpm 10.22.0. No docker, no keys, no account anywhere.

```sh
cd projects/dtc-kit

# 1. Kit packages (one pnpm workspace: packages/*)
pnpm install

# 2. Checks: SPDX/ticket lint, typecheck, 260 tests (needs no network)
pnpm check

# 3. Demo data: runs the sandbox over HTTP, the conformance runner, the corporate action,
#    and replays the recorded testnet fixture into web/src/data/demo.json (no network)
pnpm demo:data

# 4. The console (its own package and lockfile; not part of the kit workspace)
cd web
pnpm install --ignore-workspace
pnpm build              # tsc --noEmit + vite build -> web/dist (static, works offline)
pnpm preview            # http://localhost:4173
```

`web/src/data/demo.json` is committed, so step 3 is only needed to refresh it. `pnpm dev` in `web/` serves the same app with hot reload.

Other entry points:

```sh
pnpm sandbox                                   # HTTP sandbox on 127.0.0.1:8080 (curl -i localhost:8080/v1/health; HOST=0.0.0.0 to expose)
pnpm profiles check                            # 28 = 25 published + 3 inferred; 18 = 6 inferred + 12 unknown
pnpm profiles table dtc-stellar                # every resolved row with status, confidence, source count
pnpm conformance run                           # pack against the in-memory sandbox; exit 0 if no fail
pnpm conformance run --adapter stellar-sac --target testnet-recorded --include @testnet --json out.json --junit out.xml
pnpm testnet:spike                             # LIVE: re-runs the Stellar testnet spike (network; ~2 min; throwaway keys)
```

`pnpm testnet:spike` writes a new `fixtures/sac-force-transfer/testnet-run.json` (and its provenance). Run `pnpm demo:data` afterwards so the console shows the new ledgers. Do not run it during a pitch: Friendbot or testnet may be slow, and the recorded run is what the console is built from.

## 2. Investor demo script (4 minutes)

Open the console (`pnpm preview`). Dark or light theme both work (toggle top right).

**0:00 Overview.** "DTCC's tokenization service lists Stellar as anticipated for 2027. A bank or broker that wants to hold DTC tokens on Stellar has to register wallets, pass screening, convert, survive chills and overrides, and reconcile cash, and DTCC has not published the Stellar rules." Point at the hero figure: **0 of 18** Stellar requirement rows published, with the fixture chip (profile `dtc-stellar` v2026-10-31). "The kit says that out loud. Every rule is a row with a status, a source and a date; when DTCC publishes, the data changes, not the code." Point at the G-DTCC notice and the badges: DTC-shaped, not DTC-certified; testnet only; unaudited.

**0:40 Requirements.** Click *Requirements*. Filter **Unknown (12)**, open `token.form`: no value, no source, "unblocked by" and the open candidates (classic asset with SAC, SEP-57, bespoke). Then filter **Published (25)**, open any row: the DTCC or SEC URL and the date it was read. Say plainly that these 25 are generic DTC rows inherited by the Stellar profile (Stellar-specific: 0 published), and that they were read on 2026-10-29 and are not yet re-verified (DTC-006). "Nothing here is asserted without a label."

**1:10 Sandbox scenarios.** Click *Sandbox scenarios*, then **Run in browser**. "This is the mock DTC registry, the same TypeScript the Node server runs, compiled into the page: fictional participants SBX-9001 to 9004, a simulated clock." All five scenarios pass (26 steps). Open the chill scenario: the refusal is `SOURCE_RESTRICTED` and the scenario is labelled **Inferred**, because what a chill blocks is our reading, not DTCC's text. Open the force transfer: a participant gets 403, DTC moves 10 tokens without the holder, an unregistered destination is refused, the use is counted for the quarterly SEC report.

**2:00 Readiness report.** Click *Readiness report*. Default report: recorded testnet run with the SAC adapter: **28 pass, 0 fail, 1 observed, 7 skipped**. "Observed means the kit ran it but refuses to call it pass or fail, because the rule it would judge against is unknown." Scroll to *What DTCC publication would change*: the unpublished rows and the scenarios that rest on each. Optionally press **Run in browser** (sandbox: 25 pass, 0 fail, 11 skipped) and download the JUnit file a CI system can read.

**2:50 Stellar testnet.** Click *Stellar testnet*. "On a classic Stellar asset no operation moves tokens between two holders without the sender's signature, and clawback only burns. The adapter plans a DTC override as clawback plus issuer payment in one transaction." Scroll the recorded transactions: the force transfer succeeded (ledger 5,621,476); with the destination deauthorised the same transaction was **rejected as a whole**, `op_success, op_not_authorized`, and the holder kept 10 tokens (ledger 5,621,480). Each line links to the testnet explorer. Point at SEP-57: plans only, **not yet run on testnet**.

**3:30 Reconciliation.** Click *Reconciliation*. "DTC pays one consolidated cash credit per participant. Birch Prime Brokerage (fictional) gets $37.81 for 121 tokens and must split it across three clients." The allocation sums to the cent; the checksum matches the recorded run. Press **One cent short**: a `CREDIT_MISMATCH` break, nothing allocated. "It reports breaks; it never fixes them."

**4:00 Close.** "What is real today: the requirement model, the state machines, the sandbox, the runner, the reconciliation, and a recorded testnet proof of the override mechanism. What is not: anything DTCC has certified, SEP-57 on testnet, a hosted service. Next: DTCC publication or a design partner (a wallet or custody vendor)."

## 3. Where each number on screen comes from

| On screen | Source | How to regenerate |
|---|---|---|
| 0 of 18, 25 of 28, row statuses | `packages/profile-spec/profiles/*.json` (committed, each row with its own source date) | `pnpm profiles check` |
| Scenario steps and pass counts | `pnpm demo:data` run (HTTP against the Node server; runner) on the build machine | `pnpm demo:data` |
| "Run in browser" results | computed in the page by the compiled packages | press the button |
| Testnet transactions, ledgers, hashes | `fixtures/sac-force-transfer/testnet-run.json` + `.provenance.json` (SHA-256 checked by `pnpm demo:data` and by the replay test) | `pnpm testnet:spike` then `pnpm demo:data` |
| Corporate action, credits, allocation | sandbox run inside `pnpm demo:data`; fictional CUSIP `SBX000AA0` and rate 31.25 cents per token | `pnpm demo:data` |
| SC-035 timing | measured at run time; budget 1,000 ms set from five measured runs (91-134 ms, 2026-11-08) | `pnpm conformance run --include @slow --exclude @testnet` |

## 4. Known rough edges

- The sandbox clock starts at a fixed instant (2027-01-13 10:00 ET) so runs are reproducible; dates on sandbox events are simulated, not real.
- Address text in the sandbox is fake on purpose (`SBX-ADDR-...`); the registry does not validate address text, as DTC does not.
- The console's in-browser runs do not touch any network. The only network the kit ever writes to is Stellar testnet, and only through `pnpm testnet:spike`.
