# AGENTS (dtc-kit)

Follow `../../docs/AGENT_GUIDE.md` and `../../docs/GATES.md` first. Project specifics:

1. **Label everything.** Never write "DTC-compatible", "certified" or "DTCC requires" about a Stellar row. Use the row's status. Output that depends on `inferred`/`unknown` rows carries a `TrustLabel` (G-DTCC). Disclaimer wording is fixed: "DTC-shaped, not DTC-certified."
2. **Requirements are data.** Never hard-code hours, statuses, capture time or whole-token rules in code; read the row. To change a requirement, change the profile JSON, bump `version`, run `pnpm test`.
3. **Do not upgrade a row to `published`** without a quoted sentence from a primary source that supports every clause (DTC-006 rule). Do not mark any `dtc-stellar` row `published` before DTCC publishes Stellar requirements; a test enforces it.
4. **Do not redefine `HoldersSnapshot`.** The shape belongs to `holders-at-ledger`. Take `unknown`, validate against that project's schema.
5. **Adapters plan, never sign.** No private keys in the repo, fixtures or logs. Testnet keys are generated at runtime and discarded. No mainnet (config types forbid it).
6. **No contact.** Do not email, post, open issues/PRs, or sign up anywhere. Draft questions to `drafts/` for the user. Do not use any login-gated DTCC material; do not work around 403s.
7. **Stubs.** Every unimplemented function throws `NotImplemented("DTC-NNN")` with a real ticket from `TASKS.md`; `pnpm lint` fails otherwise. No TODO without a ticket id.
8. **Schemas are strict** (Ajv strict mode). If you add a conditional (`if/then`) keep `type` next to every `minItems`/`required` and declare the properties you require.
9. **Scenario trust tags are computed.** If you add a scenario, set `requiresRows` first; the tag must equal the weakest row (`catalogueProblems` fails otherwise). Re-run `pnpm export-pack`.
10. **Before finishing a session:** `pnpm check`, update `TASKS.md` status with date and one line, add a `docs/CHANGELOG.md` entry (programme file; if you may not edit it, put the entry in your report), and tag new doc facts [P][S][V][I][E][U] with a date.

Cross-project requests go under "Cross-project requests" in `TASKS.md`; stop and ask rather than editing another project.
