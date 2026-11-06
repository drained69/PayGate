# Design: running the PayGate agent as a Shade Agent

> **Status: design only. Nothing in this document is built.** PayGate today works as described in the [README](../README.md). This is a proposal for taking the agent key off the PayGate server, with its costs, risks and a fallback.

## Summary

Today the PayGate server holds each customer's agent key, encrypted at rest, and uses it to call `request_payment` on the customer's vault. The vault's on-chain limits cap what that key can do, but anyone who controls the running server can use it within those limits.

This design moves the key into an attested worker running in a trusted execution environment (TEE). The vault's `agent` becomes a small **PayGate agent contract**. That contract forwards payment requests only from workers that have proven, with a TEE attestation, that they run an approved build of the PayGate worker. The vault contract does not change, and neither do owner approvals.

## Why

The README lists a server breach as the main remaining risk. Someone holding the server and `PAYGATE_SECRET` can use agent keys to spend up to each customer's automatic and daily limits, paying only that customer's payees. This design aims at two goals:

1. **Nobody can copy agent keys.** Keys are generated inside the TEE and never leave it. A stolen database, backup or secret cannot pay anything.
2. **Payment rules run in code anyone can check.** The worker's code is pinned by its TEE measurements, which the agent contract's owner approves on-chain. Anyone can compare those measurements with a reproducible build.

Goal 1 needs only the key move. Goal 2 needs the worker to check more than the server tells it (see [Phase 2](#phase-2-checks-the-server-cannot-forge)).

## Background: Shade Agents

Facts below are from the Shade Agent Framework repository, [NearDeFi/shade-agent-framework](https://github.com/NearDeFi/shade-agent-framework), `docs/reference/agent-contract.md` and `docs/reference/api.md`.

- A Shade Agent has two parts: an off-chain **agent** running in a TEE, and an on-chain **agent contract**. Agents are deployed to Phala Cloud by default, or to any TEE provider that supports dstack.
- The contract's owner approves **measurements** (hashes of the code and platform the agent runs) and **PPIDs** (the physical TEE CPUs it may run on).
- An agent registers by calling `register_agent(attestation)` from a NEAR implicit account. It attaches about 0.00486 NEAR for its storage. The attestation's report data must contain the agent's account ID, which binds the attestation to the TEE where the key was created and prevents replay.
- A registration lasts `attestation_expiration_time_ms`. An agent stops being valid when its registration expires or when its measurements or PPID are no longer approved. The owner can also remove an agent at any time.
- Agent-gated methods call `require_valid_agent()`. An invalid caller is removed and the call fails in the next block.
- Agent keys are ephemeral: they are created in the TEE and lost when it restarts, after which the agent registers again as a new account.
- The template's `request_signature(path, payload, key_type)` gives valid agents Chain Signatures from the MPC contract (`v1.signer` on mainnet).
- The framework recommends **on-chain guardrails**: put the important checks in the contract, so they hold even if a TEE is compromised.

## Design

### Components

| Component | Today | With this design |
| --- | --- | --- |
| Vault contract | Unchanged | Unchanged. Its `agent` is the PayGate agent contract |
| Agent account | `<name>-agent.<factory>`, with one function-call key for `request_payment` | Not needed. The factory sets the agent contract as each new vault's agent |
| Agent key | Held by the PayGate server, encrypted with AES-256-GCM | Ephemeral keys inside TEE workers. The server holds none |
| PayGate agent contract | None | New. It registers attested workers and forwards `request_payment` to vaults |
| PayGate worker | Part of `src/server.mjs` | New service in a dstack TEE. It checks a payment request and calls the agent contract |
| PayGate server | Signs payment requests | Keeps jobs, the UI, the Agent API and alerts. It asks the worker to pay |

### The agent contract

This is a minimal contract built from the reference agent contract (measurement and PPID approval, `register_agent`, `require_valid_agent`), plus one gated method:

```rust
// Called by a registered, valid worker. The vault sees the agent contract as its predecessor,
// so vault.request_payment's `predecessor == agent` check passes unchanged.
pub fn request_payment(&mut self, vault: AccountId, recipient: AccountId, amount: NearToken, job_id: String) -> Promise {
    if let Some(fail) = self.require_valid_agent() { return fail; }
    ext_vault::ext(vault).with_static_gas(GAS).request_payment(recipient, amount, job_id)
}
```

- **Who owns it.** A multisig, as the framework recommends. It approves new worker builds (measurements) and TEE CPUs (PPIDs), and can remove a worker.
- **What it adds on-chain.** Only workers running an approved build can reach any vault. Every limit stays in the vault: automatic limit, per-payment and daily limits, the allowlist, one payment per job, and freeze.
- **What it cannot do.** It holds no customer funds. It cannot approve held payments, change limits or payees, or withdraw: those vault methods check for the owner and one attached yoctoNEAR.

### The worker

- **Where it runs.** In a dstack confidential VM, on Phala Cloud by default. Its Docker image is pinned by digest, and its build is reproducible so anyone can recompute the measurements.
- **Startup.** It creates a key in the TEE, derives its implicit account, is funded with gas money by the operator, as the gas relayer is today, and calls `register_agent`. It registers again before its registration expires. Running two or more workers keeps payments available while one restarts.
- **Per payment.** It receives `{vault, recipient, amount, job_id}` from the PayGate server and calls the agent contract's `request_payment`. It returns the vault's `{id, status}` and the transaction hash. The server then confirms the payment on-chain exactly as it does now.
- **Data it keeps.** None that must survive a restart. It keeps no customer data and logs no secrets.

### Phase 1: key custody

The worker pays whatever the server asks, within the vault's rules. This meets goal 1: there is no stored key to steal. A live server compromise can still request payments, still within each vault's limits and allowlist, as today.

### Phase 2: checks the server cannot forge

To meet goal 2, the worker accepts a payment only with evidence the server cannot make on its own:

- **Owner-signed job terms.** When the owner creates a job, or when an agent creates one with an API key, the owner's wallet signs the terms with NEP-413: vault, payee, amount and job ID. The worker checks that the signature comes from a full-access key of the vault's owner, reading the owner's keys from several RPC providers, as the framework's security guide advises. A job the server made up has no owner signature.
- **NEAR AI delivery proof.** For jobs done on NEAR AI Cloud, the worker checks the inference signature PayGate already records, and that its signing address comes from a valid attestation.

The cost is one more wallet signature when creating a job, or one per Agent API key if the owner signs a standing budget instead. These checks run in the worker rather than the contract, because a contract cannot read another account's access keys synchronously. Measurements keep that code pinned.

### Payments on other chains

Cross-chain payouts stay on NEAR Intents 1Click, signed by the owner with `pay_external`. The funds stay in the vault until paid, and the vault's limits apply.

The agent contract could also call `request_signature` and pay from addresses that Chain Signatures derives on other chains. That would hold funds outside the vault, where none of its rules apply, so this design does not use it. Revisit it only if PayGate later needs balances kept on other chains, with per-vault caps enforced in the agent contract.

## What changes for whom

| | Today | With this design |
| --- | --- | --- |
| Customer | Signs vault creation, approvals and changes | Same. In Phase 2, also signs job terms |
| Server breach | Agent keys usable within each vault's limits | Phase 1: no keys to steal, but live requests still go through. Phase 2: no payment without an owner-signed job |
| Stolen database or backup | Keys usable if `PAYGATE_SECRET` also leaks | Nothing usable |
| New trust | None | TEE hardware (Intel TDX), dstack and the hosting provider for availability, plus the agent contract's owner, who approves builds |
| Vault rules | Enforced on-chain | Unchanged |

**Migrating existing vaults.** An owner moves an existing vault with one wallet transaction, `set_agent(<agent contract>)`. The old `-agent` account can then be deleted, and its leftover gas money returned to the owner. A factory release for new vaults would pass the agent contract as `agent` and skip creating the agent account. That saves the 0.3 NEAR the agent account costs today.

## Costs

| Item | Paid by | Notes |
| --- | --- | --- |
| Agent contract deployment and storage | Operator, once | Size depends on the attestation verifier; measure it at build time |
| Worker registration | Operator, per registration | About 0.00486 NEAR each time a worker registers |
| Worker gas | Operator | Like the gas relayer: one function call per payment, plus registrations |
| TEE hosting | Operator, monthly | One always-on confidential VM per worker, at least two for availability. Check the provider's current pricing |
| Customer | Nothing new | New vaults no longer pay the 0.3 NEAR for an agent account |

## Risks

- **The framework is no longer maintained.** NEAR's documentation says that after April 19, 2026, the Shade Agent Framework is no longer maintained as standalone developer tooling, and that teams using it maintain it themselves. Its documentation now lives in the monorepo.
- **It has not been audited.** The repository's README warns that the framework has not had a formal audit. Its attestation verification would become part of PayGate's trusted code.
- **Builds need Docker on macOS.** The agent contract cannot be built natively on a Mac, so builds run in Docker.
- **The TEE becomes a dependency.** Hardware or firmware advisories can require removing PPIDs or measurements, which stops payments until a worker on an approved build re-registers. Owner approvals and withdrawals are not affected.
- **Availability.** If no valid worker is running, agents cannot request payments. Customers can still approve, freeze and withdraw from their wallets, and can point the vault at another agent with `set_agent`.

## Fallback if the framework stops working for us

The design depends on a few open-source parts, not the whole framework:

1. **Pin and keep our own copies.** Vendor the `shade-attestation` crate at a fixed commit, and keep our own minimal agent contract: `register_agent`, `require_valid_agent` and `request_payment`.
2. **Run the worker on dstack directly.** Use Phala Cloud or a self-hosted dstack, without the Shade Agent CLI or the JavaScript library. The worker needs only a key, an attestation whose report data holds its account ID, and near-api-js.
3. **Last resort: verify off-chain.** Publish the worker's attestation from an endpoint and check it the way `src/near.mjs` checks NEAR AI Cloud's TDX quote today. This is weaker, because the contract no longer enforces it, but it still proves which build holds the key.

## Not in scope

- No change to the vault contract.
- No change to how owners approve, reject, freeze, change limits or payees, or withdraw.
- No custody of funds by the worker or the agent contract.

## Next steps, if built

1. Build the agent contract in local mode with a whitelisted worker, and run the existing chain check with the vault's agent set to it.
2. Package the worker as a pinned, reproducible image, deploy it to a dstack TEE on testnet, and register it.
3. Migrate one testnet vault with `set_agent`, and run the attack demo against it.
4. Add Phase 2 checks, starting with owner-signed job terms.
5. Get an independent audit of the agent contract and the attestation verifier before mainnet.
