# preflight-harness differential report

Generated 2026-11-08T00:00:00Z. Taxonomy v1. Read-only replay of recorded fixtures; nothing was signed or submitted by this run.

| Library | Version | Ran | Source |
|---|---|---|---|
| stellar-preflight | - | no | git-clone https://github.com/salkimos/Stellar-Preflight (MIT) |
| stellagate-core | 0.1.1 | yes | npm https://github.com/StellaGate/stellagate (Apache-2.0) |
| stellar-check | 0.1.1 | yes | npm https://github.com/GautamBytes/stellar-check (Apache-2.0) |

Captured cases in the headline: 0. Synthetic cases (unit-test only, not counted): 2. Catalogued but not captured: 0.

Row agreement: 0 unanimous, 0 split, 0 single-library, 0 all-unknown, 0 not compared (no library that claims the case ran). Findings: 0 disagreements, 0 gaps, 0 differ from the authored expectation, 0 contradict recorded evidence or failed.

## Matrix

| Case | Expected | Ground truth | stellar-preflight | stellagate-core | stellar-check | Agreement |
|---|---|---|---|---|---|---|
| `synthetic.ready` (synthetic) | can_receive | none | not run | can | can | unanimous |
| `synthetic.trustline-missing` (synthetic) | cannot_receive | none | not run | cannot TRUSTLINE_MISSING | cannot TRUSTLINE_MISSING | unanimous |

## Findings

No findings.

## Per-case appendix

### synthetic.ready

Synthetic: authorised trustline with room. Destination `GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P`, asset `TEST:GASVYHCTBQCHUOQ5WBQ3JQO4PHQ7KLHMEPONISQK5WADDBERVRE3DTOQ`, amount 10, sender `GASVYHCTBQCHUOQ5WCTVFHTFPHQ7KLHMEPONISQK5WAHOITOGVE3CLX5`. Snapshot ledger 1. Must report: nothing. Ground truth: none.

- stellar-preflight: not run
- stellagate-core: status `ok`, derived can_receive
- stellar-check: status `no_known_issues`, derived can_receive

### synthetic.trustline-missing

Synthetic: funded destination without a trustline. Destination `GASVYHCTBQCHUOQ5WA7FFQOVSXCXOCOJAADDM3JNMQORLC2LF3AU647P`, asset `TEST:GASVYHCTBQCHUOQ5WBQ3JQO4PHQ7KLHMEPONISQK5WADDBERVRE3DTOQ`, amount 10, sender `GASVYHCTBQCHUOQ5WCTVFHTFPHQ7KLHMEPONISQK5WAHOITOGVE3CLX5`. Snapshot ledger 1. Must report: TRUSTLINE_MISSING. Ground truth: none.

- stellar-preflight: not run
- stellagate-core: status `block`, derived cannot_receive
  - no_trustline -> TRUSTLINE_MISSING (blocking): This account has no trustline for TEST (issued by GASV...DTOQ), so it cannot receive it. The payment will fail.
- stellar-check: status `issues_found`, derived cannot_receive
  - DESTINATION_TRUSTLINE_MISSING -> TRUSTLINE_MISSING (blocking): The recipient has no trustline for this exact asset code and issuer.

## Not evaluated

Every catalogued case in this fixture set was evaluated.
