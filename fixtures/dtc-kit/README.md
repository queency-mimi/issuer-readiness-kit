# Fixtures

Captured by script (`scripts/dtc-kit/capture-fixture.ts`), never by hand. Each fixture `<name>.json` has a sibling
`<name>.provenance.json` shaped like `FixtureProvenance` in that script:

```json
{
  "fixture": "sac-force-transfer/tx.json",
  "script": "scripts/dtc-kit/capture-fixture.ts",
  "sourceKind": "testnet-tx",
  "sourceUrl": "<horizon or rpc URL used>",
  "capturedAt": "2026-11-01T10:00:00Z",
  "ledgers": [123456],
  "network": "testnet",
  "sha256": "<hex>",
  "notes": "throwaway keys generated at runtime, not stored"
}
```

Rules: no private keys, ever (G-SECRETS). No data from login-gated DTCC documents. Mainnet fixtures, if any,
are read-only captures. Fixtures (2026-11-08): `sac-force-transfer/testnet-run.json` (15 Stellar testnet transactions built from StellarSacAdapter plans, ledgers 5,621,465-5,621,491; script `packages/dtc-kit-adapter-stellar-sac/scripts/testnet-spike.ts`; its provenance file still names the pre-merge path `packages/adapter-stellar-sac/...`, kept as recorded). Writer and verifier: `scripts/dtc-kit/capture-fixture.ts` (`writeFixture`, `verifyFixture`).
