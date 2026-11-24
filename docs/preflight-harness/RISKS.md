# RISKS: preflight-harness

Gates: `../../docs/GATES.md`. Status date 2026-10-31. Likelihood (L) and impact (I) are judgements [I].

## Gates that apply

| Gate | Where it bites here |
|---|---|
| G-SECRETS | Testnet seeding generates throwaway keys in memory only; loader and lint reject seed-shaped strings; no key in any fixture or log. |
| G-VALUE (closed) | No mainnet writes of any kind; mainnet capture is GET + unsigned simulation. |
| G-DTCC | DTC scenarios rest on dtc-kit rows that are `published`, `inferred` or `unknown`; each scenario carries the weakest tag; every output carries the profile disclaimer; never "DTC-compatible". |
| G-LICENCE | Libraries are MIT/Apache-2.0; nothing copied. The demo SEP-41 token in Stellar-Preflight (`contracts/demo-token`) and OZ example contracts needed for PFH-021 are copied only after a `THIRD_PARTY.md` and `NOTICE` entry, or rebuilt from public examples. |
| G-NOVELTY | PRIOR-ART records the search and its gaps; no "first" claims. |
| G-OUTREACH | No contact with the three library authors, SDF or dtc-kit's owners; issue texts are drafts only. |
| G-LEGAL | Sanctions screening, custody and relayers are not touched; the harness checks no person. Public institutional accounts only in mainnet fixtures. |
| G-CRYPTO, G-ZK | Not touched. |

## Risk register

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | The libraries are 3 to 8 weeks old, 0 stars, one-shot pushes; they may change, break or vanish, invalidating the baseline. | high | med | Pin versions/commits; inventory check (PFH-001); fixtures and taxonomy stay valid as a conformance set. |
| R2 | Stellar-Preflight is not installable from npm; the harness runs with two of three libraries until the user fetches it. | certain | low | Documented install script with `--ignore-scripts`; adapters report unavailable instead of failing the run. |
| R3 | Running third-party code (supply chain). | low | high | User-run fetch; `.competitors/` gitignored; `--ignore-scripts`; adapters import only when selected; mappers and inventory checks read text. |
| R4 | The harness's mapping decisions [I] bias results (for example collapsing codes). | med | med | Mapping table is data with notes and tests; reports show library codes verbatim beside canonical codes; `REFINES` is explicit; a reviewer can change one line. |
| R5 | Discovery-note simulation facts (SIM-2 to SIM-8, SIM-10) are first-hand by another agent and unpreserved; case expectations rest on them. | med | med | Tagged [S]; spikes PFH-030..032; expectations marked and corrected on evidence. SIM-1 was reproduced on testnet; mainnet reproduction failed on the network. |
| R6 | Ground truth is thin: many cases have no Horizon result or are `undetermined`/out-of-band. | high | med | Report says so; `@not-derivable` cases excluded from contradiction checks; PFH-022 captures what is capturable. |
| R7 | Testnet fixtures go stale on network reset; Friendbot/RPC rate limits. | med | low | Fixtures are dated snapshots; PFH-025 detects staleness; seeding is scripted and repeatable. |
| R8 | Non-atomic reads (Horizon vs RPC) produce racy snapshots. | med | low | `readsAreAtomic:false` in provenance; seeded testnet states are quiescent; mainnet cases use accounts whose state is stable (institutional, rarely changing). |
| R9 | dtc-kit's `ScenarioPack` contract may change or constrain us (the `ticket` mismatch of 2026-10-31 was resolved when dtc-kit widened the pattern to `^[A-Z]{3}-[0-9]{3}$`; the pack validates with 0 errors as of 2026-11-08 [P]). | med | med | Exporter mirrors the shape in one module; test validates against the owner's schema; PFH-028 done; no runner defined here. |
| R10 | Readers treat the DTC pack as DTCC conformance. | med | high | Weakest-status tags, disclaimer in every output, README banner, G-DTCC. |
| R11 | SDF ships `preflightPayment` (Q4 milestone) and the libraries' relevance drops. | med | med | Add it as a fourth adapter; the harness gets more useful; fixtures remain. |
| R12 | Demand is unclear: who consumes a differential report? Plausible readers are the library authors, SDF DevRel (the #1601 thread), wallet teams and dtc-kit; none was consulted. | med | med | Cheap first deliverable (the disagreement table) tests interest before M5; outreach is the user's decision (G-OUTREACH). |
| R13 | Mainnet fixtures expose individuals' accounts. | low | med | Institutional/known-exchange/issuer accounts only; review before commit (PFH-023). |
| R14 | Mainnet RPC unreachable or rate-limited (the public mainnet endpoint failed for the scaffold agent). | med | low | Provider URL is a parameter; no bypass attempts; record blocks in SOURCES. |
| R15 | Severity vocabulary mismatch makes derived classes look like findings against libraries that are internally consistent. | med | low | Derived class is the harness's scale (SPEC 4.1); `libraryStatus` is shown beside it; the informational mismatch finding is separate from disagreements. |

## Open questions for the user

1. Run `scripts/fetch-competitors.sh` now (clones third-party code into `.competitors/`), or start with the two npm libraries only?
2. Is a disagreement table useful to you before M5, as the first thing shown to SDF DevRel or the library authors (user outreach), or should it stay internal?
3. dtc-kit: will it widen the `ticket` pattern (PFH-028), or assign DTC ticket ids to scenarios produced by other projects?
4. Mainnet RPC provider URL to use for read-only captures (the public endpoint failed here).
5. Which testnet cases matter most if time is short (suggestion: the cases listed under SPEC section 7, "Required scenarios")?

## What would make us stop

- SDF ships `preflightPayment` with SAC/contract-token support and all three libraries are abandoned: keep the fixtures and taxonomy, stop new adapter work.
- The libraries agree on every captured case (then the harness has nothing to report; keep the pack).
- dtc-kit's ScenarioPack contract cannot express readiness checks (its `given/when/then` are prose strings): negotiate the contract rather than bending ours.
- A request to run the harness against anything that needs a signature on mainnet: that violates G-VALUE; stop.
