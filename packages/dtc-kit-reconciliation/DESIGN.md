# Reconciliation design (participant side)

DTC credits ONE consolidated cash payment per event to the participant's classic account, computed from DTC's 20:00 ET position capture across all of the participant's wallets [P: help page corp_actions_workflow; row `corporate_actions.cash-credit-consolidated-classic`]. The participant must (1) know who held what at the record date, (2) split the credit across its client sub-ledgers, (3) prove the split reconciles with DTC's records and the chain. This package is that participant tool. It is not an issuer payout planner (DTC pays; the issuer sends nothing).

## Inputs

| Input | Source | Notes |
|---|---|---|
| Record-date holders per wallet | `HoldersSnapshot` JSON from `holders-at-ledger` (record-date ledger sequence, balances, supply hash) | Shape owned by that project; see the docs/ARCHITECTURE.md contract table. Not redefined here. `positionsFromHoldersSnapshot(unknown)` is the seam (DTC-032, BLOCKED) |
| Wallet-to-books mapping | The participant's own system | `ParticipantBooks` |
| The credit | DTC's classic-account credit record | `ConsolidatedCredit` (bigint cents) |
| DTC Balance/Activity CSV | DTC UI/API export | Column layout unrecorded; mapped by a thin reader in DTC-034 |
| Event rate | DTC CA Web (record date, pay date, rate) | `RatePerToken` fraction, optional |

## Flow

```
HoldersSnapshot ─► positions ─┐
ParticipantBooks ────────────┼─► allocate (largest remainder) ─► AllocationPlan ─┐
ConsolidatedCredit ──────────┘                                                    ├─► reconcile ─► ReconciliationReport
DTC balances CSV, rate, independent supply read ──────────────────────────────────┘     (breaks, never fixes)
```

## Decisions

1. **Integer arithmetic only** (bigint). Cents are the unit; no floats anywhere.
2. **Largest remainder**, ties by sub-ledger id ascending, so the allocation is deterministic and explainable to an auditor. Rounding policy (who absorbs the leftover cents) is a participant policy choice; this method is neutral and documented, and SPEC section 6.1 fixes it for the reference implementation. A participant with a different policy can swap the function; the invariants still apply.
3. **Refuse rather than guess.** Unmapped wallet with tokens, or credit with zero tokens, stops the run.
4. **Internal wallets go to `HOUSE`.** Client wallets go to their client; the mapping must name the client.
5. **Breaks are reported, not repaired.** DTC remains the record of truth; chain data is secondary (discovery note institutional_tooling_gaps.md rank 3).
6. **Position timing is `inferred`.** The 20:00 ET capture and its treatment of conversions near the cutoff are an `inferred` row; reports carry that label until a human re-reads the page (DTC-006).
7. **Maturity events** burn the tokens: after the event the on-chain supply for the CUSIP should be zero; a non-zero supply is a break.

## Edge cases to cover in tests (DTC-033, DTC-034)

Zero-token client; one client holding most tokens; a single wallet; 10,000 wallets; wallets mapped to a client absent from the books (`CLIENT_ID_UNKNOWN`); wallet in a lock at capture; tokens converted to book entry just before the cutoff (capture shows fewer); credit off by one cent; credit with no positions; two events on the same record date for the same CUSIP; snapshot taken at a ledger that is not the 20:00 ET instant (`CAPTURE_TIME_MISMATCH`).

## Not in scope

Posting to a GL, tax withholding (non-US tax-withholding participants are excluded from phase 1 [P]), elections and reorganisations (phases 2-7, 2027+), moving money.
