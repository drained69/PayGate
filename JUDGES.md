# PayGate judge guide

PayGate lets an AI agent request payments from an owner-controlled NEAR vault. If the agent key is stolen, NEAR still restricts it to one method on one vault. The vault enforces the payee allowlist, per-payment and daily limits, and one payment per job. The owner can require a wallet signature for every transfer by setting the automatic limit to zero.

## Start here

From the repository root with Node.js 22.22.2 or later:

```sh
npm ci
npm run check:judge
```

This runs the app tests and executes the attack demo against the committed contract WASM on a local NEAR node. The first sandbox run downloads the node binary. The check verifies a legitimate transfer, a held request that moves zero funds, 12 blocked attacks, the daily cap on repeated transfers to an allowlisted payee, and owner withdrawal while frozen. It requires no wallet extension, cloud API key, Rust compiler or real funds.

## Follow the evidence

| Claim | Implementation | Reproduce |
| --- | --- | --- |
| The agent key can call one method on one vault | [Factory contract](contract/factory/src/lib.rs), `on_vault` | The attack demo reads both accounts' access keys and attempts forbidden actions with the agent key. |
| The vault evaluates payment rules independently of the server | [Vault contract](contract/src/lib.rs), `request_payment`, `approve_payment`, `pay_with` | The attack demo calls NEAR directly. The browser suite drives the same rules through the app. |
| An owner can require a signature on every payment | [Vault contract](contract/src/lib.rs), `request_payment` and `set_limits`; [server](src/server.mjs), `spendingLimits` | The browser suite creates an approval-only vault without an AI key, requests 0.01 NEAR, and checks the payee balance before and after the owner signs. |
| A wallet callback cannot fabricate a paid receipt | [Chain client](src/chain.mjs), `checkTx`, `payoutResult`, and `verifyPaymentReceipt` | The browser suite rejects unrelated transactions, recovers direct and relayed payments, and checks that duplicate confirmations create one receipt. |
| Receipt hashes survive JSON key reordering | [Domain logic](src/domain.mjs), `receiptHash` and `verify` | The app test reorders nested object keys and verifies that changing the payment data is still detected. |
| REST and MCP share the vault's spending rules | [Server](src/server.mjs), `agentCall` and `agentApi` | The browser suite checks automatic and held payments, retries, read-only keys, and key revocation. |

## Try the product

Run `npm run dev:chain` and open the localhost address it prints. Sign in as `alice.sandbox`, create a NEAR vault with `payee.sandbox`, and use **Record delivery** for a job. With the default limits, a 0.05 NEAR job pays automatically and a 0.3 NEAR job waits for the owner. Open **Evidence → Verify payment** to check the saved receipt against the finalized NEAR transaction.

For the automated walkthrough, run `npx playwright install chromium` and `npm run test:chain`. The suite sends real transactions on the local NEAR node. NEAR AI Cloud, NEAR Intents, and Telegram use test services for this run.

## Interpret the results

- With automatic payments enabled, a stolen key can send multiple payments to an allowlisted payee within the vault's caps. An automatic limit of zero requires human approval for every payment.
- Receipt hashes check stored history. **Verify payment** queries NEAR for the actual transfer. For cross-chain payments, **Check delivery** looks up destination status separately.
- The hosted testnet demo uses an earlier factory. Use the local sandbox to evaluate the current checkout, including the USDC and cross-chain fixtures. The contracts have had an in-house review and still need an independent audit.

See [reproducibility and trust boundaries](REPRODUCIBILITY.md) for the longer reference.
