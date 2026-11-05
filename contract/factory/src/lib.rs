//! PayGate factory. Creates a customer's spending vault and its restricted agent from one
//! transaction the customer signs. The factory has no keys after setup and keeps no customer
//! funds: each deposit goes to the new accounts, or back to the customer if a step fails.
//! The vault code is stored once, at setup, and each vault gets a copy of exactly that code.
//! The factory has no keys and no method that changes the code, so nobody can change it later.
//! The operator that deployed it (its parent account) can retire it: that deletes the factory and
//! returns its NEAR to the operator. Vaults already created are separate accounts and do not change.
use near_sdk::json_types::Base58CryptoHash;
use near_sdk::serde_json::json;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Allowance, CryptoHash, Gas, NearToken, PanicOnDefault, Promise,
    PublicKey,
};

/// Default funding for the agent account, which pays for its own storage and gas.
pub const AGENT_FUND: NearToken = NearToken::from_millinear(300);
/// Least an agent may be funded with: enough for its storage when a gas relayer pays its gas.
pub const MIN_AGENT_FUND: NearToken = NearToken::from_millinear(20);
pub const MAX_AGENT_FUND: NearToken = NearToken::from_near(1);
/// Storage the agent account keeps for itself; the rest of its funding is its key's gas allowance.
const AGENT_STORAGE: NearToken = NearToken::from_millinear(5);
/// The vault's state storage, on top of the storage for its code. Its state with 20 payees uses about 0.034 NEAR.
pub const MIN_VAULT_FUND: NearToken = NearToken::from_millinear(50);
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
    /// The account that can retire the factory.
    pub operator: AccountId,
    /// Default agent funding, and the least `create_vault` accepts in `agent_fund`.
    pub agent_fund: NearToken,
    pub min_agent_fund: NearToken,
    /// What the vault itself needs: storage for its code and state.
    pub vault_fund: NearToken,
    /// `vault_fund` plus the default agent funding.
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
    #[event_version("1.0.0")]
    FactoryRetired { operator: AccountId },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    vault_code: CryptoHash,
    /// The account that deployed the factory: its parent. Only it can retire the factory.
    operator: AccountId,
    /// Vault creations whose callbacks have not finished. The factory cannot retire while any are open,
    /// so a refund always has a factory to come back to.
    in_flight: u32,
}

#[near]
impl Factory {
    /// Stores the vault code. Its arguments are borsh: the raw code bytes.
    #[init]
    #[private]
    pub fn new(#[serializer(borsh)] vault_code: Vec<u8>) -> Self {
        require!(!vault_code.is_empty(), "Vault code is required");
        let hash = env::sha256_array(&vault_code);
        let me = env::current_account_id();
        let operator: AccountId = me
            .as_str()
            .split_once('.')
            .and_then(|(_, parent)| parent.parse().ok())
            .unwrap_or_else(|| env::panic_str("The factory must be a sub-account of its operator"));
        env::storage_write(CODE_KEY, &vault_code);
        Self { vault_code: hash, operator, in_flight: 0 }
    }

    /// Deletes the factory and sends all of its NEAR to the operator. Only the operator can call it,
    /// with one yoctoNEAR, and only when no vault creation is in progress. Vaults already created are
    /// separate accounts with their own code and no keys, so they keep working unchanged; new vaults
    /// can no longer be created.
    #[payable]
    pub fn retire(&mut self) -> Promise {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.operator, "Only the operator can retire the factory");
        require!(self.in_flight == 0, "A vault is being created. Try again in a moment");
        // NEAR refuses to delete an account holding more than about 10 KB of state, and the stored vault
        // code is far larger, so it is removed first. Without it, `create_vault` can no longer run.
        env::storage_remove(CODE_KEY);
        Event::FactoryRetired { operator: self.operator.clone() }.emit();
        Promise::new(env::current_account_id()).delete_account(self.operator.clone())
    }

    /// Creates `<name>.<factory>` owned by the caller and `<name>-agent.<factory>`, whose only
    /// key is `agent_key`, limited to `request_payment` on the new vault. With `token`, the vault
    /// holds and pays in that NEP-141 token, such as USDC, instead of NEAR. `agent_fund` (default
    /// 0.3 NEAR, at least 0.02) funds the agent; a small one suits agents whose gas a relayer pays.
    #[payable]
    pub fn create_vault(
        &mut self,
        name: String,
        agent_key: PublicKey,
        limits: Limits,
        recipients: Vec<AccountId>,
        token: Option<AccountId>,
        agent_fund: Option<NearToken>,
    ) -> Promise {
        let owner = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let agent_fund = agent_fund.unwrap_or(AGENT_FUND);
        require!(
            agent_fund >= MIN_AGENT_FUND && agent_fund <= MAX_AGENT_FUND,
            "Agent funding must be from 0.02 to 1 NEAR"
        );
        let code = env::storage_read(CODE_KEY).unwrap_or_else(|| env::panic_str("Vault code missing"));
        let vault_fund = vault_fund(code.len());
        if deposit < vault_fund.saturating_add(agent_fund) {
            env::panic_str(&format!(
                "Attach at least {} NEAR: {} for the agent and the rest for the vault's code and storage",
                vault_fund.saturating_add(agent_fund).exact_amount_display(),
                agent_fund.exact_amount_display()
            ));
        }
        require!(valid_name(&name), "Use 2 to 32 lowercase letters, digits or single dashes, not ending in -agent");
        require!(recipients.len() <= MAX_RECIPIENTS, "At most 20 payees at creation");
        let me = env::current_account_id();
        let vault: AccountId = format!("{name}.{me}").parse().unwrap_or_else(|_| env::panic_str("Invalid vault name"));
        let agent: AccountId = format!("{name}-agent.{me}").parse().unwrap_or_else(|_| env::panic_str("Invalid vault name"));
        self.in_flight += 1;
        let args = json!({ "owner": owner, "agent": agent, "limits": limits, "recipients": recipients, "token": token });
        // Only what the vault's storage needs travels with the creation. If it fails, that much is refunded
        // to the factory in a later receipt, which the factory's buffer covers; the rest never left.
        Promise::new(vault.clone())
            .create_account()
            .transfer(vault_fund)
            .deploy_contract(code)
            .function_call("new", args.to_string().into_bytes(), NearToken::from_yoctonear(0), INIT_GAS)
            .then(Self::ext(me).with_static_gas(CALLBACK_GAS).on_vault(owner, vault, agent, agent_key, deposit, vault_fund, agent_fund))
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
        agent_fund: NearToken,
    ) -> Promise {
        if !succeeded() {
            self.in_flight = self.in_flight.saturating_sub(1);
            Event::VaultFailed { owner: owner.clone(), vault }.emit();
            return Promise::new(owner).transfer(deposit);
        }
        let rest = deposit.saturating_sub(agent_fund).saturating_sub(vault_fund);
        if !rest.is_zero() {
            Promise::new(vault.clone()).transfer(rest).detach();
        }
        let allowance = Allowance::limited(agent_fund.saturating_sub(AGENT_STORAGE))
            .unwrap_or_else(|| env::panic_str("Invalid allowance"));
        Promise::new(agent.clone())
            .create_account()
            .transfer(agent_fund)
            .add_access_key_allowance(agent_key, allowance, vault.clone(), "request_payment")
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_agent(owner, vault, agent, agent_fund))
    }

    /// The vault is already live. If the agent could not be created, its funding goes back to
    /// the owner, who can name another agent with `set_agent`.
    #[private]
    pub fn on_agent(&mut self, owner: AccountId, vault: AccountId, agent: AccountId, agent_fund: NearToken) -> Option<Promise> {
        self.in_flight = self.in_flight.saturating_sub(1);
        if succeeded() {
            Event::VaultCreated { owner, vault, agent }.emit();
            None
        } else {
            Event::AgentFailed { owner: owner.clone(), vault, agent }.emit();
            Some(Promise::new(owner).transfer(agent_fund))
        }
    }

    pub fn get_config(&self) -> Config {
        let code_len = env::storage_read(CODE_KEY).map_or(0, |c| c.len());
        Config {
            vault_code: self.vault_code.into(),
            operator: self.operator.clone(),
            agent_fund: AGENT_FUND,
            min_agent_fund: MIN_AGENT_FUND,
            vault_fund: vault_fund(code_len),
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
        let _ = f.create_vault("acme".into(), key(), limits(), vec!["worker.near".parse().unwrap()], None, None);
        // 200 kB of code at 0.01 NEAR per kB, plus 0.05 for the vault's state and 0.3 for the agent.
        assert_eq!(f.get_config().min_deposit, NearToken::from_millinear(2350));
        assert_eq!(f.get_config().vault_fund, NearToken::from_millinear(2050));
        assert_eq!(f.get_config().vault_code, Base58CryptoHash::from(env::sha256_array(&[0u8; 200_000])));
    }

    #[test]
    #[should_panic(expected = "Attach at least 2.35 NEAR")]
    fn too_small_a_deposit_is_refused() {
        let _ = factory(NearToken::from_millinear(2349)).create_vault("acme".into(), key(), limits(), vec![], None, None);
    }

    fn as_caller(who: &str, yocto: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("factory.near".parse().unwrap())
            .predecessor_account_id(who.parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(yocto))
            .build());
    }

    #[test]
    fn the_operator_is_the_parent_and_can_retire() {
        let mut f = factory(NearToken::from_near(3));
        assert_eq!(f.get_config().operator.as_str(), "near");
        as_caller("near", 1);
        let _ = f.retire();
    }

    #[test]
    #[should_panic(expected = "Only the operator can retire the factory")]
    fn only_the_operator_can_retire() {
        let mut f = factory(NearToken::from_near(3));
        as_caller("owner.near", 1);
        let _ = f.retire();
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn retiring_needs_a_full_access_key() {
        let mut f = factory(NearToken::from_near(3));
        as_caller("near", 0);
        let _ = f.retire();
    }

    #[test]
    #[should_panic(expected = "A vault is being created")]
    fn retiring_waits_for_vault_creations_in_flight() {
        let mut f = factory(NearToken::from_near(3));
        let _ = f.create_vault("acme".into(), key(), limits(), vec![], None, None);
        as_caller("near", 1);
        let _ = f.retire();
    }

    #[test]
    fn finished_creations_leave_nothing_in_flight() {
        let mut f = factory(NearToken::from_near(3));
        let _ = f.create_vault("acme".into(), key(), limits(), vec![], None, None);
        let _ = f.create_vault("beta".into(), key(), limits(), vec![], None, None);
        assert_eq!(f.in_flight, 2);
        testing_env!(
            VMContextBuilder::new()
                .current_account_id("factory.near".parse().unwrap())
                .predecessor_account_id("factory.near".parse().unwrap())
                .build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Successful(vec![])]
        );
        let _ = f.on_agent("owner.near".parse().unwrap(), "acme.factory.near".parse().unwrap(), "acme-agent.factory.near".parse().unwrap(), AGENT_FUND);
        assert_eq!(f.in_flight, 1);
    }

    #[test]
    fn a_relayer_funded_agent_needs_less() {
        let mut f = factory(NearToken::from_millinear(2070));
        let _ = f.create_vault("acme".into(), key(), limits(), vec![], None, Some(NearToken::from_millinear(20)));
    }

    #[test]
    #[should_panic(expected = "Agent funding must be from 0.02 to 1 NEAR")]
    fn agent_funding_is_bounded() {
        let _ = factory(NearToken::from_near(3)).create_vault("acme".into(), key(), limits(), vec![], None, Some(NearToken::from_millinear(19)));
    }

    #[test]
    #[should_panic(expected = "lowercase letters")]
    fn agent_names_cannot_be_taken_as_vaults() {
        let _ = factory(NearToken::from_near(3)).create_vault("acme-agent".into(), key(), limits(), vec![], None, None);
    }

    #[test]
    #[should_panic(expected = "At most 20 payees")]
    fn payee_list_is_bounded() {
        let many = (0..21).map(|i| format!("p{i}.near").parse().unwrap()).collect();
        let _ = factory(NearToken::from_near(3)).create_vault("acme".into(), key(), limits(), many, None, None);
    }
}
