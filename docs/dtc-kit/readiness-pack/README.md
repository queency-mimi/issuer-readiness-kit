# Readiness pack

For: a DTC participant's digital-assets/ops-tech team, a wallet or custody vendor, or a Stellar issuer that wants to know how ready it is before DTCC publishes its Stellar requirements.

**DTC-shaped, not DTC-certified.** DTCC has not published Stellar wallet, token or API requirements (gate G-DTCC). Everything below that depends on them is labelled `[inferred]` or `[unknown]`. Nothing here is legal advice or a certification. The login-gated DTCC documents (API Reference Guide, Wallet Solution Provider Connectivity Guide, Onboarding Checklist, Client Readiness Checklist) have not been read.

| Document | Use it to |
|---|---|
| [requirement-to-stellar-matrix.md](requirement-to-stellar-matrix.md) | See each DTCC requirement, its status, the Stellar primitive that could meet it, and what is still ambiguous |
| [wallet-vendor-matrix.md](wallet-vendor-matrix.md) | See what custody/wallet vendors are evidenced to support on Stellar, with trust tags and dates |
| [participant-checklist.md](participant-checklist.md) | Work through what a participant can do now, per area |
| [sep8-and-contract-wallets.md](sep8-and-contract-wallets.md) | Understand why an issuer SEP-8 approval server is a poor fit, and the open question about contract addresses |

Trust tags: [P] primary source read, [S] secondary, [V] vendor statement, [I] our inference, [E] estimate, [U] unverified. Row ids (`wallet.account-model` and so on) point into `packages/profile-spec/profiles/*.json`, which hold the sources and dates. Dates in this pack: 2026-10-31 unless shown.

How the pack stays honest: the profile files are the source of truth; DTC-036 regenerates the tables from them so a row changing from `unknown` to `published` changes the pack.
