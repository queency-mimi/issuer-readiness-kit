# Fixtures

- `policies/example-treasury.policy.json`: valid PolicyDoc. Addresses are synthetic: valid strkey checksums derived from fixed byte patterns, **no private key exists or is known** for any of them.
- `policies/invalid/*.policy.json`: one violation each; `EXPECT.json` maps file to the violation code it must produce (SPEC section 2.5). Regenerate with `node scripts/make-invalid-fixtures.ts` (MKR-002 keeps it in sync).
- `capture/capture-auth-entries.ts`: capture stub (MKR-016). Real captures land in `auth-entries/<case>/` with a `*.provenance.json` each (schema: `../schemas/provenance.schema.json`).
- Nothing here may contain a secret seed, a mnemonic or a funded mainnet account (`pnpm lint` checks seeds).
