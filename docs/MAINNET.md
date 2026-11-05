# Mainnet launch guide

This guide takes PayGate from the testnet beta to a public mainnet service. It records the November 2026 pre-mainnet review, what it changed, what risk remains, and the exact launch steps.

## Pre-mainnet review (November 2026)

The review covered the vault and factory contracts, the server (sign-in, sessions, owner actions, the agent API, alerts, cross-chain payouts), the browser app and the deployment scripts. It was done in-house. It is not an independent audit.

### Changes made

| Area | Finding | Severity | Change |
| --- | --- | --- | --- |
| Vault | A USDC vault's NEAR (storage money and registration funds) could never be returned to the owner, because `withdraw` sends the token. | Medium | New owner method `withdraw_near(amount)`. It returns only NEAR not locked for storage. `get_policy` now reports `near_balance`. |
| Vault, app | A USDC vault spends about 0.0007 NEAR of storage per payment, and 0.00125 NEAR per cross-chain payout. Once its NEAR runs out, payments fail. No funds are lost. | Medium (operational) | Treasury shows the vault's NEAR, an estimate of payments left, a low-balance warning and a NEAR withdrawal form. |
| Alerts | Webhook addresses were checked, then resolved again when sending, so a DNS answer that changed in between could reach a private address (DNS rebinding). | Medium | Alerts now connect through a lookup that rejects private addresses on the IP actually used. Redirects are still not followed. |
| Cross-chain | Approving a payout twice issued a new quote, and a wallet that signed the earlier one could not be recorded. | Low | The last five quotes for a job are kept, and a payout to any of them is accepted. The vault's one-payment-per-job rule still prevents paying twice. |
| Server | The factory's feature flags (USDC, cross-chain) were read once at start. A failed first read left them off until a restart. | Low | They are re-read every five minutes. |
| Server | Without `NEAR_RPC_URL`, a single free RPC endpoint was used. | Low | NEAR's public RPC is now the default failover. |
| App, docs | Withdrawal text said NEAR for USDC vaults. Agent API descriptions assumed NEAR. Docs did not list every owner method or what to do if PayGate is down. | Info | The copy is now correct for the vault's currency. The approvals and security docs list every owner method and how to run the vault without PayGate. |

### Reviewed and unchanged

- The vault enforces its rules on every path that moves funds: the allowlist, the per-payment and daily limits, freeze, one payment per job, owner-only methods with one attached yoctoNEAR, and token deposits counted only from the vault's token. That includes `request_payment`, `approve_payment` and `pay_external`.
- **Failed transfers.** NEAR transfers, `ft_transfer` and the `storage_deposit` then `ft_transfer` chain all restore the ledger, the day's spending and the job id through `on_payout` and `on_withdraw`.
- **Factory.** It moves only 0.1 NEAR with creation, so no refund race. A failed creation refunds the whole deposit, a failed agent refunds the agent's funding, and the factory keeps no state and has no keys.
- **Server.**
  - Sign-in: a NEP-413 signature by a full-access key, checked on-chain, with nonces that work once.
  - Requests: session cookies (HttpOnly, SameSite=Lax), a custom header plus origin check on every POST, and a Host allowlist.
  - Pages: a CSP with a nonce per response.
  - Results: owner actions are recorded only after their transaction is found on-chain with the expected signer, receiver, method and arguments. The browser cannot inject results.
- **Secrets.** Agent and NEAR AI keys are sealed with AES-256-GCM. API keys are stored as SHA-256 hashes. Webhook secrets are sealed.

### Remaining risks

- There is no independent audit. Launch with small limits.
- **A server breach.** Someone holding the server and `PAYGATE_SECRET` can spend up to each customer's automatic limit per payment and their daily limit, only to that customer's payees.
- **Cross-chain payouts.** The owner's wallet shows the NEAR Intents deposit address, not the destination address.
- **Daily windows.** A window starts with the first request after the previous one ends, so two windows can fall back to back.
- **Rate limits.** The sign-in rate limit uses the client address from the proxy headers. It is a speed bump, not a security boundary.

## Launch checklist

1. **Rehearse on testnet with the current contracts.** Fund `drained99.testnet` with 7 testnet NEAR, then run:

   ```sh
   NEAR_NETWORK=testnet NEAR_OPERATOR_ACCOUNT=drained99.testnet FACTORY_NAME=paygate2 FACTORY_FUND=6 npm run platform:deploy
   ```

   Set `PAYGATE_FACTORY=paygate2.drained99.testnet` on the testnet service. With your own wallet:
   - Create a NEAR vault and a USDC vault, using Circle's testnet USDC faucet for the USDC.
   - Pay automatically, approve, reject, freeze and withdraw.
   - Withdraw spare NEAR from the USDC vault.

2. **Deploy the mainnet platform.** Use an operator account holding at least 7 NEAR. Run the command once without the flag to see the summary, then once with it:

   ```sh
   NEAR_NETWORK=mainnet NEAR_OPERATOR_ACCOUNT=you.near FACTORY_FUND=6 npm run platform:deploy -- --yes-mainnet
   ```

   About 3.4 NEAR stays locked for storage and about 2.6 NEAR stays as a refund buffer. Nothing is burned. The script deletes the factory's key, so check the printed vault hash against the SHA-256 of `contract/res/paygate_vault.wasm`. Each customer's vault locks about 1.9 NEAR of their deposit for its own copy of the code, so the minimum deposit is about 2.34 NEAR.

3. **Create a separate mainnet service.** Keep testnet running for rehearsals. The mainnet service needs its own Postgres and its own `PAYGATE_SECRET`, stored in a password manager.

   ```sh
   railway variables --service paygate-mainnet \
     --set NEAR_NETWORK=mainnet \
     --set PAYGATE_FACTORY=paygate.you.near \
     --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
     --set PUBLIC_URL=https://your-domain \
     --set PAYGATE_SECRET="$(openssl rand -hex 32)" \
     --set NEAR_RPC_URL=https://your-rpc-provider,https://free.rpc.fastnear.com
   ```

   Optional variables:
   - `ONECLICK_JWT` removes the 1Click fee.
   - `TELEGRAM_BOT_TOKEN` turns on Telegram alerts.
   - `PAYGATE_RELAYER_ACCOUNT` and `PAYGATE_RELAYER_KEY` set a gas relayer. Use an account that holds only gas money.

4. **Check it from outside.** Run `npm run check:deployed -- https://your-domain`. Then sign in with your own wallet, create a vault with a small balance and make one payment of each kind:
   - automatic;
   - approved;
   - USDC;
   - cross-chain, with a few dollars to a Base address you control. Confirm it arrives with **Check delivery**.

5. **Before you invite others:**
   - Turn on Postgres backups.
   - Have `public/legal.js` reviewed for your jurisdiction.
   - Keep the homepage's audit statement accurate.
   - Plan an independent audit.
