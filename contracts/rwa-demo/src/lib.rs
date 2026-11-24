// SPDX-License-Identifier: Apache-2.0
//! DEMO-ONLY testnet token for the maker-checker demo (MKR-036). A thin wrapper over OpenZeppelin
//! `stellar-tokens` 0.7.1 `RWAToken` (SEP-57) + `Pausable`, used as a dependency (MIT), not copied.
//!
//! One operator (set at construction) may freeze, unfreeze, pause and unpause. The identity verifier
//! and compliance addresses are set to the operator because the demo only exercises the control path
//! (`set_address_frozen`, `pause`); mint/transfer/forced_transfer need real identity and compliance
//! contracts and are not part of the demo (they would fail here). **Not audited. Never for value.**
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, symbol_short, Address, Env,
    MuxedAddress, String, Symbol,
};
use stellar_contract_utils::pausable::{self, Pausable};
use stellar_tokens::{
    fungible::{Base, FungibleToken},
    rwa::{RWAToken, RWA},
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DemoError {
    /// `operator` / `caller` is not the operator recorded at construction.
    NotOperator = 900,
}

const OPERATOR: Symbol = symbol_short!("operator");

fn only_operator(e: &Env, who: &Address) {
    who.require_auth();
    let op: Address = e
        .storage()
        .instance()
        .get(&OPERATOR)
        .expect("operator set in constructor");
    if *who != op {
        panic_with_error!(e, DemoError::NotOperator);
    }
}

#[contract]
pub struct RwaDemo;

#[contractimpl]
impl RwaDemo {
    pub fn __constructor(e: &Env, operator: Address, decimals: u32, name: String, symbol: String) {
        e.storage().instance().set(&OPERATOR, &operator);
        Base::set_metadata(e, decimals, name, symbol);
        RWA::set_identity_verifier(e, &operator);
        RWA::set_compliance(e, &operator);
        RWA::set_onchain_id(e, &operator);
    }

    pub fn operator(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&OPERATOR)
            .expect("operator set in constructor")
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for RwaDemo {
    type ContractType = RWA;
}

#[contractimpl(contracttrait)]
impl Pausable for RwaDemo {
    fn pause(e: &Env, caller: Address) {
        only_operator(e, &caller);
        pausable::pause(e);
    }

    fn unpause(e: &Env, caller: Address) {
        only_operator(e, &caller);
        pausable::unpause(e);
    }
}

#[contractimpl(contracttrait)]
impl RWAToken for RwaDemo {
    fn forced_transfer(e: &Env, from: Address, to: Address, amount: i128, operator: Address) {
        only_operator(e, &operator);
        RWA::forced_transfer(e, &from, &to, amount);
    }

    fn mint(e: &Env, to: Address, amount: i128, operator: Address) {
        only_operator(e, &operator);
        RWA::mint(e, &to, amount);
    }

    fn burn(e: &Env, user_address: Address, amount: i128, operator: Address) {
        only_operator(e, &operator);
        RWA::burn(e, &user_address, amount);
    }

    fn recover_balance(
        e: &Env,
        old_account: Address,
        new_account: Address,
        operator: Address,
    ) -> bool {
        only_operator(e, &operator);
        RWA::recover_balance(e, &old_account, &new_account)
    }

    fn set_address_frozen(e: &Env, user_address: Address, freeze: bool, operator: Address) {
        only_operator(e, &operator);
        RWA::set_address_frozen(e, &user_address, freeze);
    }

    fn freeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        only_operator(e, &operator);
        RWA::freeze_partial_tokens(e, &user_address, amount);
    }

    fn unfreeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        only_operator(e, &operator);
        RWA::unfreeze_partial_tokens(e, &user_address, amount);
    }

    fn set_compliance(e: &Env, compliance: Address, operator: Address) {
        only_operator(e, &operator);
        RWA::set_compliance(e, &compliance);
    }

    fn set_identity_verifier(e: &Env, identity_verifier: Address, operator: Address) {
        only_operator(e, &operator);
        RWA::set_identity_verifier(e, &identity_verifier);
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, Address, RwaDemoClient<'static>) {
        let e = Env::default();
        let op = Address::generate(&e);
        let id = e.register(
            RwaDemo,
            (
                op.clone(),
                7u32,
                String::from_str(&e, "Demo RWA"),
                String::from_str(&e, "DRWA"),
            ),
        );
        let c = RwaDemoClient::new(&e, &id);
        (e, op, c)
    }

    #[test]
    fn operator_freezes_and_unfreezes() {
        let (e, op, c) = setup();
        e.mock_all_auths();
        let user = Address::generate(&e);
        assert!(!c.is_frozen(&user));
        c.set_address_frozen(&user, &true, &op);
        assert!(c.is_frozen(&user));
        c.set_address_frozen(&user, &false, &op);
        assert!(!c.is_frozen(&user));
    }

    #[test]
    fn non_operator_cannot_freeze() {
        let (e, _op, c) = setup();
        e.mock_all_auths();
        let user = Address::generate(&e);
        let other = Address::generate(&e);
        assert!(c.try_set_address_frozen(&user, &true, &other).is_err());
    }

    #[test]
    fn freeze_requires_operator_auth() {
        let (e, op, c) = setup();
        let user = Address::generate(&e);
        assert!(c.try_set_address_frozen(&user, &true, &op).is_err());
    }

    #[test]
    fn pause_and_unpause() {
        let (e, op, c) = setup();
        e.mock_all_auths();
        c.pause(&op);
        assert!(c.paused());
        c.unpause(&op);
        assert!(!c.paused());
    }
}
