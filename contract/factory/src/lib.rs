//! PayGate factory. Creates a customer's spending vault and its restricted agent from one
//! transaction the customer signs. The factory has no keys after setup and keeps no customer
//! funds: each deposit goes to the new accounts, or back to the customer if a step fails.
//! The vault code is stored once, at setup, and each vault gets a copy of exactly that code.
//! The factory has no keys and no method that changes the code, so nobody can change it later.
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
/// The vault's state storage, on top of the storage for its code. Everything above it is spendable.
pub const MIN_VAULT_FUND: NearToken = NearToken::from_millinear(100);
/// Storage key of the vault code, kept outside the contract struct so ordinary calls do not load it.
const CODE_KEY: &[u8] = b"code";
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
    /// True when vaults can hold a NEP-141 token such as USDC.
    pub tokens: bool,
    /// True when token vaults can pay an owner-confirmed address, such as a NEAR Intents deposit address.
    pub external_payouts: bool,
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
    /// Stores the vault code. Its arguments are borsh: the raw code bytes.
    #[init]
    #[private]
    pub fn new(#[serializer(borsh)] vault_code: Vec<u8>) -> Self {
        require!(!vault_code.is_empty(), "Vault code is required");
        let hash = env::sha256_array(&vault_code);
        env::storage_write(CODE_KEY, &vault_code);
        Self { vault_code: hash }
    }

    /// Creates `<name>.<factory>` owned by the caller and `<name>-agent.<factory>`, whose only
    /// key is `agent_key`, limited to `request_payment` on the new vault. With `token`, the vault
    /// holds and pays in that NEP-141 token, such as USDC, instead of NEAR.
    #[payable]
    pub fn create_vault(
        &mut self,
        name: String,
        agent_key: PublicKey,
        limits: Limits,
        recipients: Vec<AccountId>,
        token: Option<AccountId>,
    ) -> Promise {
        let owner = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let code = env::storage_read(CODE_KEY).unwrap_or_else(|| env::panic_str("Vault code missing"));
        let vault_fund = vault_fund(code.len());
        if deposit < vault_fund.saturating_add(AGENT_FUND) {
            env::panic_str(&format!(
                "Attach at least {} NEAR: 0.3 for the agent and the rest for the vault's code and storage",
                vault_fund.saturating_add(AGENT_FUND).exact_amount_display()
            ));
        }
        require!(valid_name(&name), "Use 2 to 32 lowercase letters, digits or single dashes, not ending in -agent");
        require!(recipients.len() <= MAX_RECIPIENTS, "At most 20 payees at creation");
        let me = env::current_account_id();
        let vault: AccountId = format!("{name}.{me}").parse().unwrap_or_else(|_| env::panic_str("Invalid vault name"));
        let agent: AccountId = format!("{name}-agent.{me}").parse().unwrap_or_else(|_| env::panic_str("Invalid vault name"));
        let args = json!({ "owner": owner, "agent": agent, "limits": limits, "recipients": recipients, "token": token });
        // Only what the vault's storage needs travels with the creation. If it fails, that much is refunded
        // to the factory in a later receipt, which the factory's buffer covers; the rest never left.
        Promise::new(vault.clone())
            .create_account()
            .transfer(vault_fund)
            .deploy_contract(code)
            .function_call("new", args.to_string().into_bytes(), NearToken::from_yoctonear(0), INIT_GAS)
            .then(Self::ext(me).with_static_gas(CALLBACK_GAS).on_vault(owner, vault, agent, agent_key, deposit, vault_fund))
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
        vault_fund: NearToken,
    ) -> Promise {
        if !succeeded() {
            Event::VaultFailed { owner: owner.clone(), vault }.emit();
            return Promise::new(owner).transfer(deposit);
        }
        let rest = deposit.saturating_sub(AGENT_FUND).saturating_sub(vault_fund);
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
        let code_len = env::storage_read(CODE_KEY).map_or(0, |c| c.len());
        Config {
            vault_code: self.vault_code.into(),
            agent_fund: AGENT_FUND,
            min_deposit: vault_fund(code_len).saturating_add(AGENT_FUND),
            tokens: true,
            external_payouts: true,
        }
    }
}

/// What a new vault needs: storage for its code, plus `MIN_VAULT_FUND` for its state.
fn vault_fund(code_len: usize) -> NearToken {
    env::storage_byte_cost().saturating_mul(code_len as u128).saturating_add(MIN_VAULT_FUND)
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
        let f = Factory::new(vec![0u8; 200_000]);
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
        let mut f = factory(NearToken::from_near(3));
        let _ = f.create_vault("acme".into(), key(), limits(), vec!["worker.near".parse().unwrap()], None);
        // 200 kB of code at 0.01 NEAR per kB, plus 0.1 for the vault's state and 0.3 for the agent.
        assert_eq!(f.get_config().min_deposit, NearToken::from_millinear(2400));
        assert_eq!(f.get_config().vault_code, Base58CryptoHash::from(env::sha256_array(&[0u8; 200_000])));
    }

    #[test]
    #[should_panic(expected = "Attach at least 2.4 NEAR")]
    fn too_small_a_deposit_is_refused() {
        let _ = factory(NearToken::from_millinear(2399)).create_vault("acme".into(), key(), limits(), vec![], None);
    }

    #[test]
    #[should_panic(expected = "lowercase letters")]
    fn agent_names_cannot_be_taken_as_vaults() {
        let _ = factory(NearToken::from_near(3)).create_vault("acme-agent".into(), key(), limits(), vec![], None);
    }

    #[test]
    #[should_panic(expected = "At most 20 payees")]
    fn payee_list_is_bounded() {
        let many = (0..21).map(|i| format!("p{i}.near").parse().unwrap()).collect();
        let _ = factory(NearToken::from_near(3)).create_vault("acme".into(), key(), limits(), many, None);
    }
}
