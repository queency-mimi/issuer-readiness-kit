# @sik/dtc-kit-adapter-stellar-sac

`ChainAdapter` for a Stellar classic asset fronted by a Stellar Asset Contract (SAC). It PLANS unsigned actions; it never signs or holds keys. Network is `testnet` or `local` only (G-VALUE).

## Mapping (inferred unless noted; see `src/matrix.ts` for evidence tags)

| DTC need | Stellar primitive |
|---|---|
| Registered-wallet allowlist | `AUTH_REQUIRED` on the issuer; DTC authorises each holder trustline with `SetTrustLineFlags`. For a contract (C) holder of SAC balances, the SAC `set_authorized`. Two steps: the participant opens the trustline first. |
| Chill / lock | Revoke authorisation (needs `AUTH_REVOCABLE`) or `AUTHORIZED_TO_MAINTAIN_LIABILITIES`. Outbound-only is not exactly expressible. |
| Burn | Clawback (needs `AUTH_CLAWBACK_ENABLED`, set before trustlines exist). **A clawback is a burn.** |
| Mint | Issuer payment of its own asset (or SAC `mint`). |
| Force transfer | **Clawback from the holder plus an issuer payment of the same amount, as two operations in ONE transaction.** |
| Whole tokens | Not enforceable: 7 fixed decimals. Registry-side check only. |

## Why a force transfer needs clawback and an issuer payment in one transaction

DTC's override must move tokens without the holder's signature. No classic operation moves tokens between two holders without the source holder signing; clawback only destroys the holder's tokens. Pair it with an issuer payment of the same amount to the destination and the net effect is a transfer. Put both operations in a single transaction (both signed by the issuer, the "root wallet") so the pair is atomic: if the payment would fail (for example the destination trustline is not authorised) the clawback does not happen either. With two transactions a failure in between leaves the holder with nothing. Spike DTC-020 showed this on Stellar testnet on 2026-11-08 [P]: ledger 5,621,476 (success) and 5,621,480 (whole transaction failed, holder kept its tokens); see `fixtures/sac-force-transfer/`. Whether DTC accepts this as the NAL's "transaction reversibility" is DTC's call (profile row `authorities.force-transfer-mechanism`, unknown).

Status (2026-11-08): all seven `plan*` methods implemented (DTC-021); each plan carries an unsigned envelope built with `@stellar/stellar-sdk` 17.4.0 when every address is a valid G-address. `operationsFromPlan` turns a plan into operations. `scripts/testnet-spike.ts` (`pnpm testnet:spike` from the repo root) submits the plans on testnet with throwaway keys generated at runtime and writes `fixtures/sac-force-transfer/testnet-run.json`; `test/force-transfer.fixture.test.ts` replays it offline. Six matrix cells now carry evidence P.
