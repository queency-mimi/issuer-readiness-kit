# @sik/dtc-kit-adapter-stellar-sep57

`ChainAdapter` for a SEP-57 (T-REX style) token: Draft v0.4.0, updated 2026-09-08 (function names read 2026-10-31 [P]). Plans unsigned single-invocation actions; never signs; `testnet`/`local` only.

| DTC need | SEP-57 function (operator argument omitted) |
|---|---|
| Force transfer | `forced_transfer(from, to, amount)` |
| Freeze address / part of a balance | `set_address_frozen(user, freeze)`, `freeze_partial_tokens(user, amount)` |
| Pause everything | `pause(caller)` / `unpause(caller)` |
| Mint / burn | `mint(to, amount)`, `burn(user, amount)` |
| Wallet recovery | `recover_balance(old, new)` |
| Allowlist | identity verifier + compliance modules (`set_identity_verifier`, `set_compliance`); no single "register wallet" call |

Behaviour not in the SEP (spike DTC-024): `forced_transfer` against a frozen/partially frozen address or while paused; whether compliance hooks run for forced transfers; failure form for an unverified recipient; whether `forced_transfer` emits a distinguishable event. Whole-token rule: deploy with decimals 0 (inference, DTC-022). SDF docs say wallets do not yet support transfers and control functions of SEP-57 tokens (per discovery notes).

Status (2026-11-08): all seven `plan*` methods implemented (DTC-025): one `invoke_contract` step each (`forced_transfer`, `set_address_frozen`, `mint`, `burn`), with an unsigned envelope when the addresses are valid strkeys; allowlist add/remove depend on the identity registry and carry no envelope. **Not yet run on testnet** (DTC-024, DTC-026).
