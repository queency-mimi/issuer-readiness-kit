# ARCHITECTURE: preflight-harness

Normative interfaces: `SPEC.md`. Status 2026-10-31: scaffold; taxonomy, library mappings, catalogue, DTC scenario definitions, schemas and the `adapters`/`taxonomy`/`catalogue` commands are real; everything else is a typed stub that throws `NotImplemented("PFH-NNN")`.

## Position

`docs/ARCHITECTURE.md` places this project as a producer of DTC registered-wallet readiness scenarios for dtc-kit's conformance runner and as a consumer of the requirements profile (by row id) and the ScenarioPack format. It depends on no project's source; it references dtc-kit data by row id and (once published) by schema (ADR-0002).

## Modules

```
src/taxonomy/      codes.ts (70 ReasonCodes, REFINES, SAME_FACT), library-maps.ts (inventories + mappings)      real
src/types.ts       CaseInput, StateSnapshot, GroundTruth, ReceiveVerdict                                          real (types)
src/verdict/       derive.ts   reasons -> class                                                                  PFH-002
src/adapters/      types.ts, probe.ts, registry.ts                                                               real
                   stellar-preflight.ts, stellagate-core.ts, stellar-check.ts   (replay)                         PFH-010/011/012
                   map-*.ts    raw library output -> ReceiveVerdict (pure)                                       PFH-004/005/009
                   feed-*.ts   StateSnapshot -> the library's injection point                                   PFH-010/011/012
src/fixtures/      catalogue.ts (32 cases, real data), load.ts (PFH-003), capture.ts + seed/ (PFH-020/021)
src/report/        diff.ts (PFH-006), render.ts (PFH-007)
src/dtc/           scenarios.ts (12, real), readiness.ts (PFH-026)
src/export/        scenario-pack.ts (builder real; CLI export-pack PFH-027)
src/cli.ts         pfh
```

## Decisions

**D1. Replay over live.** The three libraries all accept injected state (read from source: `Chain`, `AccountSource`/`ContractSource`, `PaymentProvider`). The harness feeds identical recorded state to each, so differences are the libraries' logic, not network timing, and runs are offline and deterministic. Live mode exists for spot checks and is never mixed into headline numbers.

**D2. One neutral snapshot, three feeders.** `StateSnapshot` is not shaped like any library's input; each feeder translates it. Loss is explicit: stellagate-core's trustline type has one `authorized` boolean, so the feeder collapses maintain-liabilities into it and the report attributes the resulting gap to the library, not the harness.

**D3. The harness derives the verdict class; the library's own status is recorded.** Libraries disagree on severity vocabulary (READY/WARNING/BLOCKED, ok/warn/block, no_known_issues/issues_found/incomplete). Deriving from mapped reasons gives one comparable scale (SPEC 4.1). The informational mismatch finding exposes inconsistent libraries.

**D4. Superset taxonomy with refinement relations.** Libraries name facts at different granularity (maintain-liabilities vs not-authorised; party known vs unknown). `REFINES` and `SAME_FACT` let the comparison say "agree at fact level, one is more specific" instead of counting every naming difference as a disagreement.

**D5. Three kinds of finding: disagreement, gap, error.** Reporting that merges them hides what matters to a consumer: "libraries disagree" (investigate), "one is silent" (coverage), "one contradicts the ledger" (bug).

**D6. Evidence tiers.** Ground truth is Horizon operation results (classic) or recorded simulation outcomes (contract); where neither exists the case is `undetermined` or `@not-derivable`, and the report says so instead of picking a winner. The "undeployed C address" case shows why: simulation succeeds while funds would be stranded, so a library that reads the contract instance is right and simulation is not the oracle.

**D7. Scope separation.** Sender-side reasons are kept (they are part of what libraries say) but cannot change the receive class. A dedicated case (`sender.insufficient-balance`) and a `scope_leak` finding test this.

**D8. Unsafe code stays out of the install.** Two libraries are npm packages (devDependencies, pinned exact). Stellar-Preflight is not on npm and its package exports TypeScript source; it is fetched by a user-run script into a gitignored `.competitors/` directory with `--ignore-scripts`; `pfh adapters` and the inventory check read it as text; the adapter imports it only when explicitly selected. No agent executes it unprompted.

**D9. Requirements are data.** DTC scenarios reference dtc-kit profile rows by id and carry the weakest row status as their tag; nothing here states a DTCC requirement.

**D10. Pack contract mirrored, not imported.** dtc-kit published its ScenarioPack schema while this scaffold was being written; the exporter mirrors the shape in one module and the test validates against the owner's schema file when present. A contract change touches one module.

## Data flow

See SPEC section 1. Everything before the report is a pure function of (fixtures, library versions): `replay` -> `map` -> `derive` -> `buildDiffReport` -> `render`.

## Security and safety

No keys exist except throwaway testnet keys in memory during seeding. Network access is confined to `src/fixtures/capture.ts` and `live()` methods; tests stub `fetch` and assert on methods and URLs. The loader rejects secret-seed-shaped strings; lint does too.

## Extending

New library: add an inventory and a code map in `library-maps.ts`, a mapper, a feeder and an adapter class, a line in `registry.ts`, capabilities, and a PFH-001-style inventory check. No other file changes.
