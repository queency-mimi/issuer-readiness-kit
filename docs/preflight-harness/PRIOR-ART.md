# PRIOR-ART: preflight-harness

Searched 2026-10-31 (G-NOVELTY). Method: `npm view` for package names and versions; GitHub API metadata; shallow clones read as text (never executed) for the three libraries; installed the two npm packages here and loaded them; GitHub issue states via `gh api`; GitHub repository search (queries below; the connection dropped after four queries). The discovery note (`screen_H_P054.md`) is the base; where I re-checked something it is marked. **Nothing here supports "first", "novel" or "nobody has built"**; see section 4 for what was not searched.

## 1. Libraries (receive checks)

| Library | Repo / package | Facts re-checked 2026-10-31 [P] | Covers | Misses (from source) |
|---|---|---|---|---|
| Stellar-Preflight | https://github.com/salkimos/Stellar-Preflight | created 2026-10-08, last push 2026-10-08, 9 commits, 0 stars, MIT, commit `4599d9c77c66`. **Not on npm** (`@stellar-preflight/sdk`, `stellar-preflight`: 404). `packages/sdk` private 0.0.0, exports `./src/index.ts`. Monorepo with sdk, CLI, REST API, web demo, a demo SEP-41 token contract. | 32 codes (`packages/sdk/src/codes.ts`): input, unfunded (incl. createAccount minimum), memo, trustline missing / not authorised / maintain-liabilities-only / limit, clawback and revocable flags, issuer-is-destination, muxed, C-address existence, SAC deployed, SAC balance authorisation, SEP-41 token reads and transfer simulation with contract-error naming. Injectable `Chain`. | SEP-8, SEP-57/allowlist typed reads (generic simulation failure), batch, federation, directory memo list |
| stellagate-core | npm `stellagate-core` 0.1.1 (modified 2026-10-12); https://github.com/StellaGate/stellagate | created 2026-10-03, last push 2026-10-19, 30 commits, 0 stars, Apache-2.0, git HEAD `5cdd7cd6ce95`. Installs and loads here. | 25 codes: SEP-29 memo (+ StellarExpert directory), unfunded, trustline missing / not authorised / limit, SAC deployed, SAC balance authorisation, contract missing, contract-sender memo rules, muxed-from-contract, federation (SEP-2), directory flags. Injectable sources. | maintain-liabilities-only (single `authorized` boolean), clawback flags, SEP-41 non-SAC tokens, SAC transfer simulation, SEP-8/57; directory dependency is a closed third-party API |
| stellar-check | npm `stellar-check` 0.1.1 (modified 2026-09-06); https://github.com/GautamBytes/stellar-check | created 2026-09-06, last push 2026-09-07, 7 commits, 0 stars, Apache-2.0, git `f29a88998378`. Installs and loads here. | 18 codes, per-check `coverage`, `observation.atomic: false`, exact seven-decimal arithmetic, reserve and liabilities math, 121 tests (its docs), four live testnet scenarios; `PaymentProvider` injectable. Classic payments only. | muxed, C address, SAC, SEP-41, federation, memo identity; maintain-liabilities not distinguished |
| stellar-send-guard | https://github.com/Eldren-cmd/stellar-send-guard | created and last pushed 2026-08-27, MIT, 0 stars (metadata re-checked) | G-address only (per note [S]) | not read by me |
| stellar-address-kit | https://github.com/Boxkit-Labs/stellar-address-kit (npm 1.0.1) | created 2026-02-17, pushed 2026-10-23, MIT, 13 stars (metadata re-checked) | address parsing and deposit routing (per note [S]) | not a receivability check |
| rail402 `@rail402.dev/stellar` 0.5.1, portcullis-client | | per note [S], not re-checked | x402 diagnosis; SEP-8 client | out of scope |

Corrections to the discovery note, from source: the note says Stellar-Preflight has "about 31" codes; source has 32. It says StellaGate has "~21 codes read from the published dist"; source has 22 literals plus three dynamic `destination_*` values (25). The note's StellaGate "closed directory dependency" is confirmed (`stellarExpertDirectory` in `src/sources.ts`).

## 2. SDF and upstream (absorb risk)

- js-stellar-sdk #1624 "Money Movement Epic", #1601 "Payment preflight and reserve math", #1607 "Destination resolver for muxed, memo, and federated addresses": **all open, milestone Q4, last updated 2026-10-05, 1 comment each** [P: `gh api repos/stellar/js-stellar-sdk/issues/N`, 2026-10-31]. The installed `@stellar/stellar-sdk` 17.4.0 declarations contain no `preflightPayment` or `minimumBalance` [P: grep over `*.d.ts`, 2026-10-31]. The note's reading that #1601's v1 is classic-only with SAC/Soroban as a follow-up [S] was not re-fetched.
- SEP-41 and SEP-57 have no read-only receive hook: SEP-57 v0.3.0 removed `can_transfer`/`can_create` [P: `sep-0057.md` changelog, read 2026-10-31]; SEP-41 [S].
- SEP-61 Authline (remedy for missing/unauthorised trustlines), SEP-8, SEP-29 (Active 0.5.0 [P: header]) as context [S].
- Wallets (Freighter, SDP) do ad-hoc checks, closed to reuse [S from note; not re-checked].

## 3. Searches run

GitHub repository search, `created:>=2026-01-01`: "stellar preflight payment" 0; "stellar trustline check" 1 (`mpprouter/stellar-agent-wallet-skill`, an agent wallet skill, not read); "stellar destination check memo" 1 (StellaGate); the next three queries ("stellar can receive asset", "stellar payment readiness", "soroban sac holdability") failed with a network error and were **not** completed. The discovery note recorded wider search coverage (repo search with six formulations, readme-scoped search, nine npm queries, crates.io) as of the same day [S].

## 4. Not searched / not verified

Closed-source wallet send flows; Blockaid and custody vendors' destination validation; npm and crates.io beyond the names above; non-GitHub hosts; whether any of the three libraries has dependents; the quality or authorship of the repos (one-week-old, 0 stars, possibly AI-assisted one-shots per the note [S]); StellaGate's 107/14 SEP-29 survey; the SEP-8 portcullis server; behaviour of any library on mainnet (I ran none of them; the harness's job).

## 5. Verdict

The discovery note's verdict stands: **receive-check libraries are COVERED at v0 level (three compared here, two more in the note) and SDF has the feature queued**; the unoccupied slices are contract-token readiness as typed reasons, a real-network differential suite and DTC registered-wallet readiness [S]. This project is only the differential suite and the DTC pack; it adds no seventh library. I found no differential harness among the repos named above [I, bounded by section 4]. The harness's value is perishable: if SDF ships `preflightPayment` it should be added as an adapter, which makes the harness more useful, and if the three libraries converge or die, the fixtures and the taxonomy remain useful as a conformance set.

## 6. Re-check before relying

Re-run npm/GitHub name checks for Stellar-Preflight (an npm release would change the install method), re-read issue states #1601/#1607/#1624, and re-run the library searches; date each re-run below.
