//! PayGate spending vault for an AI agent. It holds NEAR, or one NEP-141 token such as USDC when
//! created with `token`; limits and amounts are then in that token's smallest units. The agent may only ask for payments; the
//! rules below decide. Owner methods need one attached yoctoNEAR, which a
//! function-call access key cannot send, so a leaked agent key cannot use them.
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, IterableSet, LookupSet};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const WINDOW_MS: u64 = 86_400_000;
const MAX_PENDING: u32 = 20;
const MAX_REQUESTS_PER_WINDOW: u32 = 50;
const MAX_JOB_ID_LEN: usize = 64;
const CALLBACK_GAS: Gas = Gas::from_tgas(5);
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
const STORAGE_DEPOSIT_GAS: Gas = Gas::from_tgas(10);
/// NEP-145 registration for one account on a token such as USDC; any excess is refunded by the token.
const TOKEN_STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Limits {
    /// Paid at once when the amount is at or below this.
    pub auto_limit: NearToken,
    /// Hard ceiling for one payment, even with owner approval.
    pub max_payment: NearToken,
    /// Hard ceiling for all payments in a 24-hour window.
    pub daily_limit: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Payment {
    pub id: u64,
    pub recipient: AccountId,
    pub amount: NearToken,
    pub job_id: String,
}

#[near(serializers = [json])]
pub struct RequestResult {
    pub id: u64,
    pub status: String,
}

#[near(serializers = [json])]
pub struct Policy {
    pub owner: AccountId,
    pub agent: AccountId,
    pub limits: Limits,
    pub frozen: bool,
    pub spent_in_window: NearToken,
    pub window_ends_ms: u64,
    pub balance: NearToken,
    /// The NEP-141 token the vault pays in, or none for NEAR.
    pub token: Option<AccountId>,
    /// NEAR not locked for storage. For a token vault it pays for storage and payout registrations.
    pub near_balance: NearToken,
}

#[near(event_json(standard = "paygate_vault"))]
pub enum Event {
    #[event_version("1.0.0")]
    PaymentSent { id: u64, recipient: AccountId, amount: NearToken, job_id: String },
    #[event_version("1.0.0")]
    PaymentPending { id: u64, recipient: AccountId, amount: NearToken, job_id: String },
    #[event_version("1.0.0")]
    PaymentRejected { id: u64 },
    #[event_version("1.0.0")]
    PaymentFailed { id: u64 },
    #[event_version("1.0.0")]
    FreezeChanged { frozen: bool },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    agent: AccountId,
    limits: Limits,
    frozen: bool,
    next_id: u64,
    window_start_ms: u64,
    spent_in_window: NearToken,
    requests_in_window: u32,
    recipients: IterableSet<AccountId>,
    pending: IterableMap<u64, Payment>,
    used_jobs: LookupSet<String>,
    token: Option<AccountId>,
    /// Token units the vault holds, credited only through `ft_on_transfer` from `token`.
    token_balance: u128,
}

#[near]
impl Vault {
    /// Callable only by the vault itself or by the account that created it, such as
    /// the PayGate factory, which initializes it in the same receipt that creates it.
    #[init]
    pub fn new(
        owner: AccountId,
        agent: AccountId,
        limits: Limits,
        recipients: Option<Vec<AccountId>>,
        token: Option<AccountId>,
    ) -> Self {
        let caller = env::predecessor_account_id();
        let me = env::current_account_id();
        require!(caller == me || me.is_sub_account_of(&caller), "Only the vault or its creator can initialize it");
        require!(owner != agent, "Owner and agent must differ");
        assert_limits(&limits);
        let mut vault = Self {
            owner,
            agent,
            limits,
            frozen: false,
            next_id: 1,
            window_start_ms: env::block_timestamp_ms(),
            spent_in_window: NearToken::from_yoctonear(0),
            requests_in_window: 0,
            recipients: IterableSet::new(b"r"),
            pending: IterableMap::new(b"p"),
            used_jobs: LookupSet::new(b"j"),
            token,
            token_balance: 0,
        };
        for recipient in recipients.unwrap_or_default() {
            vault.recipients.insert(recipient);
        }
        vault
    }

    #[payable]
    pub fn fund(&mut self) {}

    /// NEP-141 receiver. Credits deposits of the vault's token from anyone; refuses other tokens by returning them.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let _ = (sender_id, msg);
        if self.token.as_ref() != Some(&env::predecessor_account_id()) {
            return PromiseOrValue::Value(amount);
        }
        self.token_balance = self.token_balance.saturating_add(amount.0);
        PromiseOrValue::Value(U128(0))
    }

    pub fn request_payment(
        &mut self,
        recipient: AccountId,
        amount: NearToken,
        job_id: String,
    ) -> RequestResult {
        require!(env::predecessor_account_id() == self.agent, "Only the agent can request payments");
        require!(!self.frozen, "Payments are frozen");
        require!(self.recipients.contains(&recipient), "Recipient is not on the allowlist");
        require!(!amount.is_zero(), "Amount must be positive");
        require!(amount <= self.limits.max_payment, "Amount exceeds the per-payment limit");
        require!(!job_id.is_empty() && job_id.len() <= MAX_JOB_ID_LEN, "Invalid job id");
        require!(!self.used_jobs.contains(&job_id), "Job has already been paid or requested");
        self.roll_window();
        require!(self.requests_in_window < MAX_REQUESTS_PER_WINDOW, "Too many requests in this window");
        require!(
            self.spent_in_window.saturating_add(amount) <= self.limits.daily_limit,
            "Amount exceeds the daily limit"
        );
        self.requests_in_window += 1;
        self.used_jobs.insert(job_id.clone());
        let id = self.next_id;
        self.next_id += 1;
        let payment = Payment { id, recipient, amount, job_id };
        if amount <= self.limits.auto_limit {
            self.pay(payment);
            RequestResult { id, status: "sent".into() }
        } else {
            require!(self.pending.len() < MAX_PENDING, "Too many payments awaiting approval");
            Event::PaymentPending {
                id,
                recipient: payment.recipient.clone(),
                amount,
                job_id: payment.job_id.clone(),
            }
            .emit();
            self.pending.insert(id, payment);
            RequestResult { id, status: "pending".into() }
        }
    }

    #[payable]
    pub fn approve_payment(&mut self, id: u64) {
        self.assert_owner();
        require!(!self.frozen, "Payments are frozen");
        let payment = self.pending.remove(&id).unwrap_or_else(|| env::panic_str("Payment not found"));
        require!(self.recipients.contains(&payment.recipient), "Recipient is not on the allowlist");
        require!(payment.amount <= self.limits.max_payment, "Amount exceeds the per-payment limit");
        self.roll_window();
        self.pay(payment);
    }

    /// Owner-signed payment to an address the owner confirms in their wallet, such as a NEAR Intents
    /// deposit address that forwards to a payee on another chain. Token vaults only. The vault registers
    /// the address with the token first, and the payment counts against the same limits as any other.
    #[payable]
    pub fn pay_external(&mut self, recipient: AccountId, amount: NearToken, job_id: String) -> RequestResult {
        self.assert_owner();
        require!(self.token.is_some(), "External payments need a token vault");
        require!(!self.frozen, "Payments are frozen");
        require!(!amount.is_zero(), "Amount must be positive");
        require!(amount <= self.limits.max_payment, "Amount exceeds the per-payment limit");
        require!(!job_id.is_empty() && job_id.len() <= MAX_JOB_ID_LEN, "Invalid job id");
        require!(!self.used_jobs.contains(&job_id), "Job has already been paid or requested");
        require!(self.free_near() >= TOKEN_STORAGE, "The vault needs a little NEAR to register the address");
        self.roll_window();
        self.used_jobs.insert(job_id.clone());
        let id = self.next_id;
        self.next_id += 1;
        self.pay_with(Payment { id, recipient, amount, job_id }, true);
        RequestResult { id, status: "sent".into() }
    }

    #[payable]
    pub fn reject_payment(&mut self, id: u64) {
        self.assert_owner();
        let payment = self.pending.remove(&id).unwrap_or_else(|| env::panic_str("Payment not found"));
        self.used_jobs.remove(&payment.job_id);
        Event::PaymentRejected { id }.emit();
    }

    #[payable]
    pub fn set_frozen(&mut self, frozen: bool) {
        self.assert_owner();
        self.frozen = frozen;
        Event::FreezeChanged { frozen }.emit();
    }

    #[payable]
    pub fn set_limits(&mut self, limits: Limits) {
        self.assert_owner();
        assert_limits(&limits);
        self.limits = limits;
    }

    #[payable]
    pub fn set_recipient(&mut self, recipient: AccountId, allowed: bool) {
        self.assert_owner();
        if allowed {
            self.recipients.insert(recipient);
        } else {
            self.recipients.remove(&recipient);
        }
    }

    /// Replaces the agent, for example after its key leaks.
    #[payable]
    pub fn set_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        require!(agent != self.owner, "Owner and agent must differ");
        self.agent = agent;
    }

    /// Works while frozen, so the owner can always recover funds.
    #[payable]
    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        self.assert_owner();
        require!(amount <= self.available(), "Insufficient vault balance");
        match self.token.clone() {
            None => Promise::new(self.owner.clone()).transfer(amount),
            Some(token) => {
                self.token_balance -= amount.as_yoctonear();
                ft_transfer(token, self.owner.clone(), amount, "PayGate withdrawal".into()).then(
                    Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_withdraw(amount),
                )
            }
        }
    }

    /// Token vaults also hold a little NEAR for storage and for registering payout addresses.
    /// The owner can take back any of it not locked for storage.
    #[payable]
    pub fn withdraw_near(&mut self, amount: NearToken) -> Promise {
        self.assert_owner();
        require!(self.token.is_some(), "Use withdraw for a NEAR vault");
        require!(amount <= self.free_near(), "Insufficient NEAR above the vault's storage");
        Promise::new(self.owner.clone()).transfer(amount)
    }

    /// Restores the token ledger if a token withdrawal failed.
    #[private]
    pub fn on_withdraw(&mut self, amount: NearToken, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.token_balance = self.token_balance.saturating_add(amount.as_yoctonear());
        }
    }

    #[private]
    pub fn on_payout(
        &mut self,
        id: u64,
        amount: NearToken,
        job_id: String,
        window_start_ms: u64,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_err() {
            if self.token.is_some() {
                self.token_balance = self.token_balance.saturating_add(amount.as_yoctonear());
            }
            if window_start_ms == self.window_start_ms {
                self.spent_in_window = self.spent_in_window.saturating_sub(amount);
            }
            self.used_jobs.remove(&job_id);
            Event::PaymentFailed { id }.emit();
        }
    }

    pub fn get_policy(&self) -> Policy {
        let window_over = env::block_timestamp_ms() >= self.window_start_ms + WINDOW_MS;
        Policy {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            limits: self.limits.clone(),
            frozen: self.frozen,
            spent_in_window: if window_over { NearToken::from_yoctonear(0) } else { self.spent_in_window },
            window_ends_ms: self.window_start_ms + WINDOW_MS,
            balance: self.available(),
            token: self.token.clone(),
            near_balance: self.free_near(),
        }
    }

    pub fn get_pending(&self) -> Vec<Payment> {
        self.pending.values().cloned().collect()
    }

    pub fn get_recipients(&self) -> Vec<AccountId> {
        self.recipients.iter().cloned().collect()
    }
}

impl Vault {
    fn assert_owner(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }

    fn roll_window(&mut self) {
        let now = env::block_timestamp_ms();
        if now >= self.window_start_ms + WINDOW_MS {
            self.window_start_ms = now;
            self.spent_in_window = NearToken::from_yoctonear(0);
            self.requests_in_window = 0;
        }
    }

    /// Spendable balance: token units for a token vault, otherwise NEAR not locked for storage.
    fn available(&self) -> NearToken {
        if self.token.is_some() {
            return NearToken::from_yoctonear(self.token_balance);
        }
        self.free_near()
    }

    fn free_near(&self) -> NearToken {
        env::account_balance().saturating_sub(env::storage_byte_cost().saturating_mul(env::storage_usage() as u128))
    }

    fn pay(&mut self, payment: Payment) {
        self.pay_with(payment, false)
    }

    fn pay_with(&mut self, payment: Payment, register: bool) {
        let Payment { id, recipient, amount, job_id } = payment;
        let spent = self.spent_in_window.saturating_add(amount);
        require!(spent <= self.limits.daily_limit, "Amount exceeds the daily limit");
        require!(amount <= self.available(), "Insufficient vault balance");
        self.spent_in_window = spent;
        Event::PaymentSent { id, recipient: recipient.clone(), amount, job_id: job_id.clone() }.emit();
        let transfer = match self.token.clone() {
            None => Promise::new(recipient).transfer(amount),
            Some(token) => {
                self.token_balance -= amount.as_yoctonear();
                if register {
                    let args = json!({ "account_id": recipient, "registration_only": true });
                    Promise::new(token.clone())
                        .function_call("storage_deposit", args.to_string().into_bytes(), TOKEN_STORAGE, STORAGE_DEPOSIT_GAS)
                        .then(ft_transfer(token, recipient, amount, job_id.clone()))
                } else {
                    ft_transfer(token, recipient, amount, job_id.clone())
                }
            }
        };
        transfer.then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_payout(id, amount, job_id, self.window_start_ms),
        ).detach();
    }
}

/// NEP-141 transfer of `amount` token units; the token requires exactly one yoctoNEAR.
fn ft_transfer(token: AccountId, receiver_id: AccountId, amount: NearToken, memo: String) -> Promise {
    let args = json!({ "receiver_id": receiver_id, "amount": U128(amount.as_yoctonear()), "memo": memo });
    Promise::new(token).function_call("ft_transfer", args.to_string().into_bytes(), NearToken::from_yoctonear(1), FT_TRANSFER_GAS)
}

fn assert_limits(limits: &Limits) {
    require!(
        limits.auto_limit <= limits.max_payment && limits.max_payment <= limits.daily_limit,
        "Limits must satisfy auto <= max payment <= daily"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn near(n: u128) -> NearToken {
        NearToken::from_near(n)
    }
    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn call(who: &str, yocto: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("vault.near"))
            .predecessor_account_id(acct(who))
            .account_balance(near(100))
            .attached_deposit(NearToken::from_yoctonear(yocto))
            .build());
    }
    fn vault() -> Vault {
        call("vault.near", 0);
        let mut v = Vault::new(
            acct("owner.near"),
            acct("agent.near"),
            Limits { auto_limit: near(1), max_payment: near(5), daily_limit: near(8) },
            None,
            None,
        );
        call("owner.near", 1);
        v.set_recipient(acct("worker.near"), true);
        call("agent.near", 0);
        v
    }

    #[test]
    fn small_payment_is_sent_and_large_waits_for_owner() {
        let mut v = vault();
        assert_eq!(v.request_payment(acct("worker.near"), near(1), "a".into()).status, "sent");
        let large = v.request_payment(acct("worker.near"), near(3), "b".into());
        assert_eq!(large.status, "pending");
        assert_eq!(v.get_pending().len(), 1);
        call("owner.near", 1);
        v.approve_payment(large.id);
        assert!(v.get_pending().is_empty());
        assert_eq!(v.get_policy().spent_in_window, near(4));
    }

    #[test]
    #[should_panic(expected = "Only the agent")]
    fn strangers_cannot_request() {
        let mut v = vault();
        call("attacker.near", 0);
        v.request_payment(acct("worker.near"), near(1), "a".into());
    }

    #[test]
    #[should_panic(expected = "allowlist")]
    fn unknown_recipient_is_refused() {
        vault().request_payment(acct("attacker.near"), near(1), "a".into());
    }

    #[test]
    #[should_panic(expected = "per-payment limit")]
    fn oversized_payment_is_refused() {
        vault().request_payment(acct("worker.near"), near(6), "a".into());
    }

    #[test]
    #[should_panic(expected = "daily limit")]
    fn daily_limit_stops_a_drain_of_small_payments() {
        let mut v = vault();
        for i in 0..9 {
            v.request_payment(acct("worker.near"), near(1), format!("job-{i}"));
        }
    }

    #[test]
    fn daily_limit_resets_after_the_window() {
        let mut v = vault();
        for i in 0..8 {
            v.request_payment(acct("worker.near"), near(1), format!("job-{i}"));
        }
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("vault.near"))
            .predecessor_account_id(acct("agent.near"))
            .account_balance(near(100))
            .block_timestamp((WINDOW_MS + 1) * 1_000_000)
            .build());
        assert_eq!(v.request_payment(acct("worker.near"), near(1), "later".into()).status, "sent");
        assert_eq!(v.get_policy().spent_in_window, near(1));
    }

    #[test]
    #[should_panic(expected = "already been paid")]
    fn a_job_cannot_be_paid_twice() {
        let mut v = vault();
        v.request_payment(acct("worker.near"), near(1), "a".into());
        v.request_payment(acct("worker.near"), near(1), "a".into());
    }

    #[test]
    #[should_panic(expected = "frozen")]
    fn freeze_blocks_requests() {
        let mut v = vault();
        call("owner.near", 1);
        v.set_frozen(true);
        call("agent.near", 0);
        v.request_payment(acct("worker.near"), near(1), "a".into());
    }

    #[test]
    #[should_panic(expected = "frozen")]
    fn freeze_blocks_approvals_already_pending() {
        let mut v = vault();
        let large = v.request_payment(acct("worker.near"), near(3), "a".into());
        call("owner.near", 1);
        v.set_frozen(true);
        call("owner.near", 1);
        v.approve_payment(large.id);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn owner_methods_cannot_be_called_by_a_function_call_key() {
        let mut v = vault();
        call("owner.near", 0);
        v.set_frozen(false);
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn agent_cannot_use_owner_methods() {
        let mut v = vault();
        call("agent.near", 1);
        v.set_limits(Limits { auto_limit: near(5), max_payment: near(5), daily_limit: near(100) });
    }

    #[test]
    #[should_panic(expected = "Too many payments awaiting approval")]
    fn pending_queue_is_bounded() {
        let mut v = vault();
        for i in 0..21 {
            v.request_payment(acct("worker.near"), near(3), format!("job-{i}"));
        }
    }

    #[test]
    fn rejecting_lets_the_job_be_requested_again() {
        let mut v = vault();
        let large = v.request_payment(acct("worker.near"), near(3), "a".into());
        call("owner.near", 1);
        v.reject_payment(large.id);
        call("agent.near", 0);
        assert_eq!(v.request_payment(acct("worker.near"), near(3), "a".into()).status, "pending");
    }

    #[test]
    #[should_panic(expected = "per-payment limit")]
    fn lowering_the_limit_applies_to_payments_already_pending() {
        let mut v = vault();
        let large = v.request_payment(acct("worker.near"), near(3), "a".into());
        call("owner.near", 1);
        v.set_limits(Limits { auto_limit: near(1), max_payment: near(2), daily_limit: near(8) });
        call("owner.near", 1);
        v.approve_payment(large.id);
    }

    #[test]
    #[should_panic(expected = "allowlist")]
    fn removing_a_recipient_applies_to_payments_already_pending() {
        let mut v = vault();
        let large = v.request_payment(acct("worker.near"), near(3), "a".into());
        call("owner.near", 1);
        v.set_recipient(acct("worker.near"), false);
        call("owner.near", 1);
        v.approve_payment(large.id);
    }

    #[test]
    #[should_panic(expected = "daily limit")]
    fn a_request_that_could_never_be_approved_is_refused_early() {
        let mut v = vault();
        for i in 0..4 {
            v.request_payment(acct("worker.near"), near(1), format!("job-{i}"));
        }
        v.request_payment(acct("worker.near"), near(5), "large".into());
    }

    #[test]
    #[should_panic(expected = "Insufficient vault balance")]
    fn cannot_overdraw() {
        let mut v = vault();
        call("owner.near", 1);
        v.set_limits(Limits { auto_limit: near(500), max_payment: near(500), daily_limit: near(500) });
        call("agent.near", 0);
        v.request_payment(acct("worker.near"), near(200), "a".into());
    }

    fn limits() -> Limits {
        Limits { auto_limit: near(1), max_payment: near(5), daily_limit: near(8) }
    }

    #[test]
    fn the_creating_account_can_initialize_with_payees() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("v1.factory.near"))
            .predecessor_account_id(acct("factory.near"))
            .build());
        let v = Vault::new(acct("owner.near"), acct("v1-agent.factory.near"), limits(), Some(vec![acct("worker.near")]), None);
        assert_eq!(v.get_recipients(), vec![acct("worker.near")]);
        assert_eq!(v.get_policy().owner, acct("owner.near"));
    }

    #[test]
    #[should_panic(expected = "Only the vault or its creator")]
    fn strangers_cannot_initialize() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("v1.factory.near"))
            .predecessor_account_id(acct("attacker.near"))
            .build());
        Vault::new(acct("attacker.near"), acct("agent.near"), limits(), None, None);
    }

    #[test]
    #[should_panic(expected = "Only the vault or its creator")]
    fn a_grandparent_cannot_initialize() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acct("v1.factory.near"))
            .predecessor_account_id(acct("near"))
            .build());
        Vault::new(acct("owner.near"), acct("agent.near"), limits(), None, None);
    }

    fn usdc(n: u128) -> NearToken {
        NearToken::from_yoctonear(n * 1_000_000)
    }
    fn token_vault() -> Vault {
        call("vault.near", 0);
        let mut v = Vault::new(
            acct("owner.near"),
            acct("agent.near"),
            Limits { auto_limit: usdc(10), max_payment: usdc(50), daily_limit: usdc(80) },
            Some(vec![acct("worker.near")]),
            Some(acct("usdc.near")),
        );
        call("usdc.near", 0);
        let kept = v.ft_on_transfer(acct("owner.near"), U128(usdc(100).as_yoctonear()), String::new());
        assert!(matches!(kept, PromiseOrValue::Value(U128(0))));
        call("agent.near", 0);
        v
    }

    #[test]
    fn token_deposits_are_credited_only_from_the_vault_token() {
        let mut v = token_vault();
        assert_eq!(v.get_policy().balance, usdc(100));
        assert_eq!(v.get_policy().token, Some(acct("usdc.near")));
        call("fake-usdc.near", 0);
        let returned = v.ft_on_transfer(acct("attacker.near"), U128(999), String::new());
        assert!(matches!(returned, PromiseOrValue::Value(U128(999))));
        assert_eq!(v.get_policy().balance, usdc(100));
    }

    #[test]
    fn token_payments_debit_the_ledger_and_follow_the_limits() {
        let mut v = token_vault();
        assert_eq!(v.request_payment(acct("worker.near"), usdc(10), "a".into()).status, "sent");
        assert_eq!(v.get_policy().balance, usdc(90));
        let held = v.request_payment(acct("worker.near"), usdc(30), "b".into());
        assert_eq!(held.status, "pending");
        call("owner.near", 1);
        v.approve_payment(held.id);
        assert_eq!(v.get_policy().balance, usdc(60));
        assert_eq!(v.get_policy().spent_in_window, usdc(40));
    }

    #[test]
    #[should_panic(expected = "Insufficient vault balance")]
    fn token_payments_cannot_exceed_the_token_balance() {
        let mut v = token_vault();
        call("owner.near", 1);
        v.set_limits(Limits { auto_limit: usdc(500), max_payment: usdc(500), daily_limit: usdc(500) });
        call("agent.near", 0);
        v.request_payment(acct("worker.near"), usdc(101), "a".into());
    }

    #[test]
    fn a_failed_token_transfer_restores_the_ledger() {
        let mut v = token_vault();
        v.request_payment(acct("worker.near"), usdc(10), "a".into());
        call("vault.near", 0);
        v.on_payout(1, usdc(10), "a".into(), v.window_start_ms, Err(PromiseError::Failed));
        assert_eq!(v.get_policy().balance, usdc(100));
        assert_eq!(v.get_policy().spent_in_window, usdc(0));
    }

    #[test]
    fn token_withdrawals_debit_and_restore_on_failure() {
        let mut v = token_vault();
        call("owner.near", 1);
        let _ = v.withdraw(usdc(40));
        assert_eq!(v.get_policy().balance, usdc(60));
        call("vault.near", 0);
        v.on_withdraw(usdc(40), Err(PromiseError::Failed));
        assert_eq!(v.get_policy().balance, usdc(100));
    }

    #[test]
    fn external_payments_are_owner_only_and_follow_the_limits() {
        let mut v = token_vault();
        call("owner.near", 1);
        let deposit = acct(&"ab".repeat(32));
        assert_eq!(v.pay_external(deposit.clone(), usdc(30), "x".into()).status, "sent");
        assert_eq!(v.get_policy().balance, usdc(70));
        assert_eq!(v.get_policy().spent_in_window, usdc(30));
        assert!(!v.get_recipients().contains(&deposit), "the deposit address is never allowlisted");
        call("vault.near", 0);
        v.on_payout(1, usdc(30), "x".into(), v.window_start_ms, Err(PromiseError::Failed));
        assert_eq!(v.get_policy().balance, usdc(100));
        call("owner.near", 1);
        assert_eq!(v.pay_external(deposit, usdc(30), "x".into()).status, "sent", "a failed job can be paid again");
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn the_agent_cannot_pay_external_addresses() {
        let mut v = token_vault();
        call("agent.near", 1);
        v.pay_external(acct("anyone.near"), usdc(1), "x".into());
    }

    #[test]
    #[should_panic(expected = "Amount exceeds the per-payment limit")]
    fn external_payments_respect_the_per_payment_limit() {
        let mut v = token_vault();
        call("owner.near", 1);
        v.pay_external(acct("anyone.near"), usdc(51), "x".into());
    }

    #[test]
    #[should_panic(expected = "External payments need a token vault")]
    fn external_payments_need_a_token_vault() {
        let mut v = vault();
        call("owner.near", 1);
        v.pay_external(acct("anyone.near"), near(1), "x".into());
    }

    #[test]
    fn token_vaults_return_spare_near_to_the_owner() {
        let mut v = token_vault();
        call("owner.near", 1);
        assert!(v.get_policy().near_balance > NearToken::from_near(90));
        let _ = v.withdraw_near(NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn only_the_owner_withdraws_near() {
        let mut v = token_vault();
        call("agent.near", 1);
        let _ = v.withdraw_near(NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "Insufficient NEAR above the vault's storage")]
    fn token_vaults_keep_their_storage_near() {
        let mut v = token_vault();
        call("owner.near", 1);
        let _ = v.withdraw_near(NearToken::from_near(101));
    }

    #[test]
    #[should_panic(expected = "Use withdraw for a NEAR vault")]
    fn near_vaults_use_withdraw() {
        let mut v = vault();
        call("owner.near", 1);
        let _ = v.withdraw_near(NearToken::from_near(1));
    }

    #[test]
    #[should_panic(expected = "Limits must satisfy")]
    fn incoherent_limits_are_refused() {
        let mut v = vault();
        call("owner.near", 1);
        v.set_limits(Limits { auto_limit: near(9), max_payment: near(5), daily_limit: near(8) });
    }
}
