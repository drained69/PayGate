# PayGate judge guide

PayGate gives an AI agent permission to request a payment from a customer-owned NEAR vault. The customer retains custody and sets the rules. NEAR restricts the agent key to one method on one vault, and the vault enforces the allowed payees, spending limits and one payment per job. Those checks apply even when a stolen key signs a request directly.

## Public testnet evidence

| Open | What to inspect |
| --- | --- |
| [Live app](https://trypaygate.xyz) and [deployment configuration](https://trypaygate.xyz/api/config) | The hosted app uses `paygate.drained99.testnet` and supports NEAR vaults. |
| [Factory account](https://testnet.nearblocks.io/address/paygate.drained99.testnet) and [vault creation transaction](https://testnet.nearblocks.io/txns/HxQsazQrhpE3rZuZ3r33jZtU7EuxstpdDo5bRupr9jAr) | `drained99.testnet` called `create_vault`. The transaction created and funded the vault and its agent account. |
| [Vault account](https://testnet.nearblocks.io/address/drained.paygate.drained99.testnet) and [agent account](https://testnet.nearblocks.io/address/drained-agent.paygate.drained99.testnet) | The factory and vault have zero access keys. The agent has a single function-call key scoped to `request_payment` on `drained.paygate.drained99.testnet`. |
| [Submitted demo video](https://x.com/drained99/status/2120683021720306089) and [video notes](video/README.md) | The app screens recreate the workflow with example USDC jobs and illustrative transaction IDs. The attack segment draws on the real local [NEAR sandbox log](docs/attack-demo-log.txt). |

The recorded testnet transaction proves vault creation and funding. The payment and attack results below were run on a local NEAR node against this checkout's contract binaries.

## Build history

The [Nocturne prototype](https://github.com/drained69/PayGate/commit/05c5ed3) was first committed on November 1, 2026, the start date recorded in the [submission disclosure](README.md#hackathon-submission). The next day's [first on-chain vault](https://github.com/drained69/PayGate/commit/743daf9) added a Rust contract and local-node demo. Most of that diff is the Cargo and npm lockfiles. Later commits wired [payments into the app](https://github.com/drained69/PayGate/commit/0d259c0), added the [multi-customer factory](https://github.com/drained69/PayGate/commit/590f2d6) and exposed [scoped REST and MCP tools](https://github.com/drained69/PayGate/commit/533edfb). The [event checkout](https://github.com/drained69/PayGate/tree/fc636af8dc5cf19f183823edbd7d71e2147e99f5) ends on November 13. The reviewer guide, attack-demo checks, video labels and NEAR AI compatibility fix here were prepared after the November 14 close.

## Reproduce the payment and attack demo

From the repository root with Node.js 22.22.2 or later:

```sh
npm ci
npm run check:judge
```

This runs the app tests and executes the [attack demo](scripts/attack-demo.mjs) against the committed contract WASM on a local NEAR node. The first sandbox run downloads the node binary. The demo checks the payee balance after an automatic transfer, after a held request is rejected, and after a second held request is approved. It also verifies 12 blocked actions, the daily cap on repeated transfers to an allowlisted payee, and owner withdrawal while frozen. It requires no wallet extension, cloud API key, Rust compiler or real funds.

## Follow the evidence

| Claim | Implementation | Reproduce |
| --- | --- | --- |
| The agent key can call one method on one vault | [Factory key creation](contract/factory/src/lib.rs#L162) | Inspect the live testnet agent key. The attack demo tries forbidden actions with an equivalently scoped local key. |
| The vault evaluates payment rules independently of the server | [Request and approval methods](contract/src/lib.rs#L163), [payout rules](contract/src/lib.rs#L435) | The attack demo calls NEAR directly. The browser suite drives the same rules through the app. |
| An owner can require a signature on every payment | [Vault contract](contract/src/lib.rs), `request_payment` and `set_limits`; [server](src/server.mjs), `spendingLimits` | The browser suite creates an approval-only vault without an AI key, requests 0.01 NEAR, and checks the payee balance before and after the owner signs. |
| A wallet callback cannot fabricate a paid receipt | [Receipt verification](src/chain.mjs#L96) | The browser suite rejects unrelated transactions, recovers direct and relayed payments, and checks that duplicate confirmations create one receipt. |
| Receipt hashes survive JSON key reordering | [Domain logic](src/domain.mjs), `receiptHash` and `verify` | The app test reorders nested object keys and verifies that changing the payment data is still detected. |
| REST and MCP share the vault's spending rules | [Server](src/server.mjs), `agentCall` and `agentApi` | The browser suite checks automatic and held payments, retries, read-only keys, and key revocation. |

## Try the product

Run `npm run dev:chain` and open the localhost address it prints. Sign in as `alice.sandbox`, create a NEAR vault with `payee.sandbox`, and use **Record delivery** for a job. With the default limits, a 0.05 NEAR job pays automatically and a 0.3 NEAR job waits for the owner. Open **Evidence → Verify payment** to check the saved receipt against the finalized NEAR transaction.

For the automated walkthrough, run `npx playwright install chromium` and `npm run test:chain`. The suite sends real transactions on the local NEAR node. NEAR AI Cloud, NEAR Intents, and Telegram use test services for this run.

## Integration scope and trust

- **Agent authority.** A stolen key can send multiple payments to an allowlisted payee within the caps. Set the automatic limit to zero to require the owner's signature on every payment. The customer can freeze payments and withdraw directly on-chain.
- **NEAR AI Cloud.** With the customer's API key, PayGate makes a real inference request and stores response hashes and any signature returned by the service. Attestation checks the quote format, nonce and gateway configuration. Intel signature verification is outside the current implementation. [Inference and attestation code](src/near.mjs#L47)
- **NEAR Intents.** Live dry quotes value NEAR jobs in dollars. Cross-chain USDC uses a live quote and an owner-signed deposit in the mainnet path. The local browser suite exercises that path using a stand-in 1Click service. **Verify payment** checks the NEAR transfer and **Check delivery** looks up the destination separately. [1Click client](src/near.mjs#L11)
- **Deployment and review.** The public factory is an earlier release and the local sandbox exercises the current contract binaries, including USDC. Mainnet is unlaunched. The contracts have had an in-house review and still need an independent audit.

See [reproducibility and trust boundaries](REPRODUCIBILITY.md) for the longer reference.
