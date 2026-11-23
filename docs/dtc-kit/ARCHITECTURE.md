# ARCHITECTURE

Principles (from docs/ARCHITECTURE.md): chain-neutral core with Stellar adapters; requirements are data; evidence over claims; conformance as code; no custody; testnet first; upstreamable by construction.

## Layout

```
dtc-kit/
  pnpm-workspace.yaml   packages/*  (this project is its own workspace; docs/decisions/ADR-0002 allows it: no ROOT workspace across projects)
  packages/
    profile-spec/       schema/*.schema.json, profiles/{dtc-generic,dtc-stellar}.json, loader, validator, resolve, weakestStatus
    core/               reducers (wallet, precheck, conversion, control, force-transfer, capture, cash allocation), ChainAdapter port
    sandbox/            mock DTC registry + HTTP shell + fake institutions + five scripted scenarios + docker-compose
    adapter-stellar-sac/    ChainAdapter for classic asset + SAC; capability matrix
    adapter-stellar-sep57/  ChainAdapter for SEP-57; capability matrix
    conformance/        ScenarioPack schema/types, catalogue (36), lint, runner stub, exported pack JSON
    reconciliation/     allocation of DTC's consolidated cash credit; holders-source seam; breaks
  readiness-pack/       documents
  scripts/              lint.ts, capture-fixture.ts (stub)
  fixtures/             captured data + *.provenance.json (none yet)
```

## Dependency graph (packages)

```
profile-spec ──► core ──► sandbox ──┐
     │            ├──► adapter-stellar-sac ──┤
     │            ├──► adapter-stellar-sep57 ┼──► conformance
     │            └──► reconciliation ───────┘ (test only)
     └─────────────────────────────────────────► conformance (lint, runner)
```

Rules: packages depend only on packages to their left; adapters depend on core's `ChainAdapter` port, never on each other or on the sandbox; the sandbox depends on the port, not on an adapter (the adapter is injected). Cross-package imports go through `exports` in `package.json` (`./src/index.ts`), run directly by Node 24 type stripping with no build step. `@sik/dtc-kit-*` names, private, unpublished.

External contracts (docs/ARCHITECTURE.md contract table):

| Artefact | Direction | File |
|---|---|---|
| `requirements-profile.schema.json` | owned here; consumed by core, sandbox, conformance, preflight-harness | `packages/profile-spec/schema/` |
| `ScenarioPack` | owned here; consumed by token-invariants, preflight-harness | `packages/conformance/schema/scenario-pack.schema.json` |
| `HoldersSnapshot` | consumed here, owned by holders-at-ledger; NOT redefined | `positionsFromHoldersSnapshot(unknown)` in reconciliation; shape per the holders-at-ledger SPEC referenced by the docs/ARCHITECTURE.md contract table |
| `NormalizedEvent` (Orbital) | adapt, do not redefine | event decoders (DTC-027) |

## Data flow

```
profile JSON ─► resolveProfile ─► ResolvedProfile ─► reducers read rows ─► Reduction{next, effects, trust}
                                          │                                   │
                                          └─► weakestStatus ─► TrustLabel ◄───┘
effects ─► sandbox registry ─► (optional) ChainAdapter.plan* ─► ChainActionPlan (unsigned)
                                                               └─► testnet submit (DTC-023/026, throwaway keys)
conformance: ScenarioPack + profile ─► gate on rows ─► run on sandbox/testnet ─► RunReport (labelled)
reconciliation: HoldersSnapshot(unknown) ─► positions ─► allocate(credit) ─► plan ─► breaks ─► report
```

## Decisions

1. **Reducers are pure, effects are data.** The sandbox and a real participant system execute the same effects differently; the adapter turns effects into chain plans. Keeps the state machines identical across chains and testable without a network.
2. **Profile rows, not constants.** Hours, statuses, whole-token rule, capture time are read from rows. A scenario's trust tag is computed from its rows, and a unit test enforces it, so a scenario cannot claim more certainty than the profile allows.
3. **Adapters plan, never sign.** `ChainActionPlan` is an unsigned description with signers and an `atomic` flag. Submission (testnet only) lives in a separate, later layer with runtime-generated throwaway keys.
4. **Own HTTP shape for the sandbox.** DTCC's API is login-gated and unread; copying its shape would be a guess presented as fact. The sandbox publishes `ROUTES` and says so in a header on every response.
5. **Two Stellar adapters because the token form is unknown.** `token.form` is a profile row with three candidates; the capability matrices make the trade-offs explicit (whole-token enforcement favours a contract token; Fireblocks custody favours classic).
6. **Reconciliation consumes, never redefines.** It takes `unknown` and validates against the producing project's schema.
7. **Strict schemas.** Ajv strict mode on 2020-12; `additionalProperties: false`; conditional rules for status via `if/then`. Strict mode caught three schema defects during scaffolding (missing `type` beside `minItems`, `required` without a declared property), which is why it stays on.
8. **No ESLint at scaffold.** `scripts/lint.ts` checks SPDX headers, ticket references and ticket-less TODOs; TypeScript strict flags (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`) do the rest. A formatter/linter may be added by a ticket if the user wants one.
9. **Time and money.** Instants are ISO strings with offset; business-day logic uses `Intl` with `America/New_York` (never a fixed offset); tokens and cents are `bigint`; fractional quantity input is a string that is rejected.

## Failure model

- Unknown profile row: reported as `unknown`; scenarios gated on it are SKIPPED, never failed.
- Stub reached: `NotImplemented("DTC-NNN")`; the HTTP shell answers 501 with the ticket.
- Illegal transition: `InvalidTransition`, never a silent no-op.
- Allocation that cannot be done safely (unmapped wallet, credit without positions): refuse, do not guess.
