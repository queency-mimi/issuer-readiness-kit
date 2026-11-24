# TESTING: maker-checker

Runner: `node --test test/*.test.ts` (Node 24, type stripping, no build). Commands: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm check` (all three). Network tests are marked in their ticket and are never part of `pnpm test` unless an env var (`MKR_NETWORK=1`) is set.

## Strategy by layer

| Layer | Technique | Where |
|---|---|---|
| Canonicalisation | RFC 8785 vectors; independent reference (`scripts/jcs_reference.py`); differential fuzz | MKR-001, MKR-030 |
| Policy parse/validate | one fixture per violation code (`fixtures/policies/invalid/EXPECT.json`); multi-fault documents; schema/parser agreement | MKR-002 |
| Evaluation | table-driven (>= 30 cases), boundaries, determinism under rule shuffling, no I/O | MKR-003 |
| Workflow | transition table tests + seeded property tests of SoD invariants S1 to S4 over >= 10,000 random event sequences | MKR-004 |
| Attestation | tamper every field of `ApprovalStatement`; replay across requests | MKR-006 |
| Audit | one test per tamper class; two-process append conflict; crash-truncation | MKR-007/008 |
| Auth entries | SDK-built entries offline; merge algebra property tests; failure-mode list SPEC 7.10 | MKR-010..015 |
| Adapters | interface contract suite run against every adapter with a fake backend | MKR-005/020..022 |
| HTTP | OpenAPI conformance (every operation, every declared status) | MKR-029 |
| End to end | testnet script with throwaway keys | MKR-031 |

## Property-test conventions

A tiny seeded PRNG (xorshift128+ or mulberry32; no dependency) in `test/helpers/prng.ts`. Every property test prints its seed on failure and accepts `SEED=<n>` to replay. Generators produce events with a bias toward illegal ones (wrong actor, repeated approver, late events) so guards are exercised.

## Fixtures

- Policies: `fixtures/policies/` (valid example, 20 invalid derivatives; regenerate with `node scripts/make-invalid-fixtures.ts`).
- Auth entries: `fixtures/auth-entries/<case>/` captured on testnet by `fixtures/capture/capture-auth-entries.ts` (MKR-016). Each file has `<name>.provenance.json` (script, RPC URL, ledger, capture date, `containsSecrets:false`; schema `schemas/provenance.schema.json`).
- Addresses in fixtures are public. Synthetic strkeys derived from byte patterns have no known private key. **No seed, mnemonic or funded mainnet account may appear in any fixture**; `pnpm lint` fails on seed-shaped strings (G-SECRETS).
- Throwaway keys exist only in memory during a test or demo run.

## How to capture a new fixture

1. Write or extend the case in `fixtures/capture/capture-auth-entries.ts`.
2. Run it against testnet: `node fixtures/capture/capture-auth-entries.ts https://soroban-testnet.stellar.org fixtures/auth-entries`.
3. It generates throwaway keypairs, funds them with Friendbot, builds the transaction, simulates in the needed modes, and writes `request.json`, `simulation.json`, `entries.json` plus provenance. It does not sign anything it cannot discard and does not submit (MKR-031 is the only submitting script).
4. Run `pnpm lint` and `pnpm test`.

## What the tests must never do

Contact mainnet; write to mainnet; use a real person's address; log a signature value; depend on wall-clock time (inject `nowUnix`); depend on test order.

## Coverage expectations

No numeric coverage target (would be invented). Required: every `DenyReason`, every `PD_*` code, every row of SPEC 5.3, every failure mode of SPEC 7.10 and every tamper class of SPEC 8.6 has at least one named test; `pnpm test` lists them.
