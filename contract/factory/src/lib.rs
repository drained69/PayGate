//! PayGate factory. Creates a customer's spending vault and its restricted agent from one
//! transaction the customer signs. The factory has no keys after setup and keeps no customer
//! funds: each deposit goes to the new accounts, or back to the customer if a step fails.
//! Vaults run the global contract pinned by code hash, so nobody can change their code later.
use near_sdk::json_types::Base58CryptoHash;
use near_sdk::serde_json::json;
use near_sdk::{
    env, near, require, AccountId, Allowance, CryptoHash, Gas, NearToken, PanicOnDefault, Promise,
    PublicKey,
};

/// Funds the agent account, which pays for its own storage and gas.
pub const AGENT_FUND: NearToken = NearToken::from_millinear(300);
/// Gas the agent key may spend before the owner has to issue a new one.
pub const AGENT_ALLOWANCE: NearToken = NearToken::from_millinear(250);
/// The vault needs a little for its own storage. Everything above it is spendable.
pub const MIN_VAULT_FUND: NearToken = NearToken::from_millinear(100);
const MAX_RECIPIENTS: usize = 20;
const INIT_GAS: Gas = Gas::from_tgas(20);
const CALLBACK_GAS: Gas = Gas::from_tgas(40);

#[near(serializers = [json])]
pub struct Limits {
    pub auto_limit: NearToken,
    pub max_payment: NearToken,
    pub daily_limit: NearToken,
}

#[near(serializers = [json])]
pub struct Config {
    pub vault_code: Base58CryptoHash,
    pub agent_fund: NearToken,
    pub min_deposit: NearToken,
}

#[near(event_json(standard = "paygate_factory"))]
pub enum Event {
    #[event_version("1.0.0")]
    VaultCreated { owner: AccountId, vault: AccountId, agent: AccountId },
    #[event_version("1.0.0")]
    VaultFailed { owner: AccountId, vault: AccountId },
    #[event_version("1.0.0")]
    AgentFailed { owner: AccountId, vault: AccountId, agent: AccountId },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    vault_code: CryptoHash,
}

#[near]
impl Factory {
    #[init]
    #[private]
    pub fn new(vault_code: Base58CryptoHash) -> Self {
        Self { vault_code: vault_code.into() }
    }

    /// Creates `<name>.<factory>` owned by the caller and `<name>-agent.<factory>`, whose only
    /// key is `agent_key`, limited to `request_payment` on the new vault.
    #[payable]
    pub fn create_vault(
        &mut self,
        name: String,
        agent_key: PublicKey,
        limits: Limits,
        recipients: Vec<AccountId>,
    ) -> Promise {
        let owner = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(
            deposit >= MIN_VAULT_FUND.saturating_add(AGENT_FUND),
            "Attach at least 0.4 NEAR: 0.3 for the agent and 0.1 for the vault"
        );
        require!(valid_name(&name), "Use 2 to 32 lowercase letters, digits or single dashes, not ending in -agent");
        require!(recipients.len() <= MAX_RECIPIENTS, "At most 20 payees at creation");
        let me = env::current_account_id();
        let vault: AccountId = format!("{name}.{me}").parse().unwrap_or_else(|_| env::panic_str("Invalid vault name"));
        let agent: AccountId = format!("{name}-agent.{me}").parse().unwrap_or_else(|_| env::panic_str("Invalid vault name"));
        let args = json!({ "owner": owner, "agent": agent, "limits": limits, "recipients": recipients });
        // Only the minimum travels with the creation. If it fails, that much is refunded to the factory
        // in a later receipt, which the factory's buffer covers; the rest of the deposit never left.
        Promise::new(vault.clone())
            .create_account()
            .transfer(MIN_VAULT_FUND)
            .use_global_contract(self.vault_code)
            .function_call("new", args.to_string().into_bytes(), NearToken::from_yoctonear(0), INIT_GAS)
            .then(Self::ext(me).with_static_gas(CALLBACK_GAS).on_vault(owner, vault, agent, agent_key, deposit))
    }

    /// Once the vault exists, sends it the rest of the deposit and creates the agent. If the vault
    /// could not be created, refunds the whole deposit.
    #[private]
    pub fn on_vault(
        &mut self,
        owner: AccountId,
        vault: AccountId,
        agent: AccountId,
        agent_key: PublicKey,
        deposit: NearToken,
    ) -> Promise {
        if !succeeded() {
            Event::VaultFailed { owner: owner.clone(), vault }.emit();
            return Promise::new(owner).transfer(deposit);
        }
        let rest = deposit.saturating_sub(AGENT_FUND).saturating_sub(MIN_VAULT_FUND);
        if !rest.is_zero() {
            Promise::new(vault.clone()).transfer(rest).detach();
        }
        let allowance = Allowance::limited(AGENT_ALLOWANCE).unwrap_or_else(|| env::panic_str("Invalid allowance"));
        Promise::new(agent.clone())
            .create_account()
            .transfer(AGENT_FUND)
            .add_access_key_allowance(agent_key, allowance, vault.clone(), "request_payment")
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_agent(owner, vault, agent))
    }

    /// The vault is already live. If the agent could not be created, its funding goes back to
    /// the owner, who can name another agent with `set_agent`.
    #[private]
    pub fn on_agent(&mut self, owner: AccountId, vault: AccountId, agent: AccountId) -> Option<Promise> {
        if succeeded() {
            Event::VaultCreated { owner, vault, agent }.emit();
            None
        } else {
            Event::AgentFailed { owner: owner.clone(), vault, agent }.emit();
            Some(Promise::new(owner).transfer(AGENT_FUND))
        }
    }

    pub fn get_config(&self) -> Config {
        Config {
            vault_code: self.vault_code.into(),
            agent_fund: AGENT_FUND,
            min_deposit: MIN_VAULT_FUND.saturating_add(AGENT_FUND),
        }
    }
}

fn succeeded() -> bool {
    env::promise_result_checked(0, 64).is_ok()
}

pub fn valid_name(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && !name.ends_with("-agent")
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn factory(deposit: NearToken) -> Factory {
        testing_env!(VMContextBuilder::new()
            .current_account_id("factory.near".parse().unwrap())
            .predecessor_account_id("factory.near".parse().unwrap())
            .build());
        let f = Factory::new(Base58CryptoHash::from([7u8; 32]));
        testing_env!(VMContextBuilder::new()
            .current_account_id("factory.near".parse().unwrap())
            .predecessor_account_id("owner.near".parse().unwrap())
            .attached_deposit(deposit)
            .build());
        f
    }
    fn limits() -> Limits {
        Limits { auto_limit: NearToken::from_millinear(100), max_payment: NearToken::from_near(1), daily_limit: NearToken::from_near(2) }
    }
    fn key() -> PublicKey {
        "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
    }

    #[test]
    fn names_are_restricted() {
        for ok in ["ab", "acme", "acme-ops", "team42"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["a", "Acme", "-acme", "acme-", "ac--me", "acme-agent", "ac.me", "ac_me", &"a".repeat(33)] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn creating_a_vault_returns_a_promise() {
        let mut f = factory(NearToken::from_near(1));
        let _ = f.create_vault("acme".into(), key(), limits(), vec!["worker.near".parse().unwrap()]);
        assert_eq!(f.get_config().min_deposit, NearToken::from_millinear(400));
    }

    #[test]
    #[should_panic(expected = "Attach at least 0.4 NEAR")]
    fn too_small_a_deposit_is_refused() {
        let _ = factory(NearToken::from_millinear(399)).create_vault("acme".into(), key(), limits(), vec![]);
    }

    #[test]
    #[should_panic(expected = "lowercase letters")]
    fn agent_names_cannot_be_taken_as_vaults() {
        let _ = factory(NearToken::from_near(1)).create_vault("acme-agent".into(), key(), limits(), vec![]);
    }

    #[test]
    #[should_panic(expected = "At most 20 payees")]
    fn payee_list_is_bounded() {
        let many = (0..21).map(|i| format!("p{i}.near").parse().unwrap()).collect();
        let _ = factory(NearToken::from_near(1)).create_vault("acme".into(), key(), limits(), many);
    }
}
