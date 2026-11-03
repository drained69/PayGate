//! PayGate spending vault for an AI agent. The agent may only ask for payments; the
//! rules below decide. Owner methods need one attached yoctoNEAR, which a
//! function-call access key cannot send, so a leaked agent key cannot use them.
use near_sdk::store::{IterableMap, IterableSet, LookupSet};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

const WINDOW_MS: u64 = 86_400_000;
const MAX_PENDING: u32 = 20;
const MAX_REQUESTS_PER_WINDOW: u32 = 50;
const MAX_JOB_ID_LEN: usize = 64;
const CALLBACK_GAS: Gas = Gas::from_tgas(5);

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
}

#[near]
impl Vault {
    /// Private, so nobody can front-run initialization between deploy and init.
    #[init]
    #[private]
    pub fn new(owner: AccountId, agent: AccountId, limits: Limits) -> Self {
        require!(owner != agent, "Owner and agent must differ");
        assert_limits(&limits);
        Self {
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
        }
    }

    #[payable]
    pub fn fund(&mut self) {}

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
        Promise::new(self.owner.clone()).transfer(amount)
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

    /// Balance not locked for contract storage.
    fn available(&self) -> NearToken {
        env::account_balance().saturating_sub(env::storage_byte_cost().saturating_mul(env::storage_usage() as u128))
    }

    fn pay(&mut self, payment: Payment) {
        let Payment { id, recipient, amount, job_id } = payment;
        let spent = self.spent_in_window.saturating_add(amount);
        require!(spent <= self.limits.daily_limit, "Amount exceeds the daily limit");
        require!(amount <= self.available(), "Insufficient vault balance");
        self.spent_in_window = spent;
        Event::PaymentSent { id, recipient: recipient.clone(), amount, job_id: job_id.clone() }.emit();
        Promise::new(recipient).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_payout(id, amount, job_id, self.window_start_ms),
        ).detach();
    }
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

    #[test]
    #[should_panic(expected = "Limits must satisfy")]
    fn incoherent_limits_are_refused() {
        let mut v = vault();
        call("owner.near", 1);
        v.set_limits(Limits { auto_limit: near(9), max_payment: near(5), daily_limit: near(8) });
    }
}
