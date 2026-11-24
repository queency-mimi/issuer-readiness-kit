# DEMO: preflight-harness

<!-- SPDX-License-Identifier: Apache-2.0 -->

Written 2026-11-08. Everything below runs offline from committed fixtures, except the optional steps marked "network".

## 1. Run it from a clean checkout

Needs Node >= 22.18 (24.18.0 tested) and pnpm 10.22.0. No keys, no accounts and no network after install.

```bash
cd projects/preflight-harness
pnpm install --frozen-lockfile        # harness + the two npm libraries under test (stellagate-core 0.1.1, stellar-check 0.1.1)
pnpm check                            # typecheck + 86 tests (85 pass, 1 skipped: the Stellar-Preflight opt-in test) + lint + inventory check

# The engine, on the 29 recorded testnet cases
node src/cli.ts adapters              # which libraries are present; Stellar-Preflight shows MISSING/not opted in, with the reason
node src/cli.ts fixtures validate     # schema + provenance + secret checks over fixtures/cases
pnpm report                           # pfh run -> out/verdicts.json, out/report.json, out/report.md
node src/cli.ts report --in out/verdicts.json --check out/report.json   # determinism: rebuilt report equals the stored one
node src/cli.ts dtc run               # 12 DTC readiness scenarios against the fixtures -> out/dtc-readiness.json
pnpm export-pack                      # regenerate the golden ScenarioPack (byte-identical if nothing changed)

# The web report
pnpm demo:data                        # fixtures -> web/src/data/report.json + web/public/dtc-wallet-readiness.pack.json
cd web
pnpm install --frozen-lockfile
pnpm build                            # tsc --noEmit + vite build -> web/dist (static, no runtime fetch)
pnpm preview                          # http://localhost:4173
```

`web/dist/` is a plain static folder (`base: './'`); `python3 -m http.server -d web/dist 4173` serves it as well.

### Optional: add the third library (your decision, network)

Stellar-Preflight is not on npm. Executing it means running downloaded third-party code, which the project's rules (`AGENTS.md` rule 3) leave to you. On 2026-11-08 an agent session ran the fetch script, but the dependency install timed out (the npm registry was unreachable over IPv6). The retry was then refused by the permission system, so the column still reads "Not run".

```bash
NODE_OPTIONS=--dns-result-order=ipv4first scripts/fetch-competitors.sh   # pinned commit 4599d9c77c66, pnpm install --ignore-scripts
PFH_ALLOW_COMPETITOR_CODE=1 pnpm test                                     # runs the skipped adapter test too
PFH_ALLOW_COMPETITOR_CODE=1 pnpm report
PFH_ALLOW_COMPETITOR_CODE=1 pnpm demo:data && (cd web && pnpm build)
```

The adapter, the snapshot-to-`Chain` feeder and the result mapper are already written. Until this has run, nothing on the page or in the reports claims a Stellar-Preflight result.

### Optional: re-seed testnet (network, testnet writes)

`pnpm seed:testnet` creates fresh accounts on **testnet only** with `Keypair.random()` keys held in memory, captures read-only snapshots, submits one payment per classic case for ground truth, and writes new fixtures plus a public record in `fixtures/seed-runs/`. It refuses any non-testnet passphrase. You don't need it for the demo. Re-run it after a testnet reset if you want the explorer links to resolve again.

## 2. Investor demo script (about 4 minutes)

Open the built report (`pnpm preview`). The theme toggle is at the top right. Dark mode suits a projector.

**0:00 Overview: the question.** "Wallets and custodians ask one question before every transfer: can this address actually receive this asset? Three small open-source libraries answer it. We ran them all against the same recorded Stellar testnet states and compared their answers to what the ledger really did."
- Point at the three gate badges in the header: testnet only, not DTC-certified, unaudited. They stay on every page.
- Point at the "Stellar-Preflight: not run" notice. "There are three libraries; two ran today. The third needs an explicit opt-in to execute downloaded code, so the page says so instead of showing a column of guesses."
- The headline figure: **3 of 29 cases** where the libraries that ran give different verdicts. The chip under it reads "Testnet run, 2026-11-08, ledgers 5,622,268 to 5,622,359".

**0:45 "Where the libraries split".** Three cards, each with the real testnet result beside the two verdicts:
- Destination is the issuer: the payment succeeded on testnet (`success`). stellagate-core says "can receive", stellar-check says "unknown".
- XLM to a non-existent account: the ledger says `op_no_destination`. One library warns, the other blocks.

**1:30 Diff matrix.** Click "Open the matrix".
- Each row is a recorded case. The "Testnet evidence" column has the real Horizon result code and a transaction hash that links to stellar.expert. That link only resolves until the next testnet reset; the fixture keeps the hash either way.
- Dashed boxes mark a "left out" code: a reason the ledger state requires that the library did not report. Show `classic.trustline-maintain-liabilities-only`: both libraries block correctly but report a plain "not authorised", which loses the more specific state.
- Filters (the family row and the rows filter combine, they are ANDed): click "SAC", then "Not compared". Four SAC cases remain, all "Not compared": neither npm library claims SAC transfers to G addresses. That's a scope difference, not a defect, and the page labels it that way. "With findings" plus "SAC" is empty by design (those four rows have no findings); the empty state has a "Clear both filters" button.
- Point at the amber "differs from expected [I]" marker on the two XLM-to-new-account rows. "This is not the ledger contradicting a library. It is the case author's expectation, with its trust tag, differing from the answer. Read the evidence line before concluding anything."
- Point at `sac.c-address-undeployed`: the recorded simulation passed, and the cell says it is not decisive, because a simulation cannot see that no contract is deployed there.

**2:30 Case drill-down.** Click `classic.destination-is-issuer`. You see the recorded snapshot facts (ledger, flags, trustlines), each library's verbatim status and reasons, and the ground-truth transaction.

**3:00 Findings.** 22 findings, all generated by `pfh run`: 5 disagreements, 14 gaps (13 omitted reasons plus 1 abstention), 2 where a verdict differs from the case author's expectation (trust-tagged, not recorded evidence), 0 that contradict a recorded ledger or simulation result, and 1 informational note. "None of these is a judgement about code quality. They are the places where an integrator would get a different answer depending on the library they picked."

**3:30 DTC scenario pack.** The amber notice is the verbatim dtc-kit disclaimer: DTC-shaped, not DTC-certified. The 12 readiness scenarios each carry the weakest trust tag of the requirement rows they rest on. 11 were evaluated against the recorded cases and 1 is not evaluated, with the reason (it needs a SEP-57 token on testnet). "Download pack" gives the ScenarioPack JSON that validates against dtc-kit's published schema.

**4:00 Method and limits.** End here. "Every number came from the fixtures through one script. Here is what we did not test." That list is the roadmap.

## 3. What not to say in the demo

- Don't say "three libraries were compared". Two ran; the third is wired but not executed.
- Don't call the DTC pack "DTC-compatible" or "DTCC-approved" (gate G-DTCC).
- Don't call the harness the first of its kind. `PRIOR-ART.md` found no other differential harness among the repos it searched, and that search was bounded.
- Don't present the findings as bugs filed upstream. Nothing was posted anywhere (G-OUTREACH).
