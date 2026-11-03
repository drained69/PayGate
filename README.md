# PayGate

PayGate lets a company give an AI agent a budget without giving it control of the money. A NEAR smart contract holds the funds and enforces the owner's limits, so even a fully hijacked agent cannot overspend or pay an attacker.

**The problem:** an AI agent that can pay for things can be tricked into paying the wrong person. Text hidden in a document or brief can instruct it to send funds, and rules written in the agent's prompt or app code stop working once the agent is compromised. PayGate puts the rules where the agent cannot reach them.

## How it works

| Part | Who holds it | What it can do |
| --- | --- | --- |
| **Vault contract** | No keys at all after setup | Holds the NEAR. Pays only allowlisted payees, within per-payment and daily limits. Holds back anything above the automatic limit until the owner approves. |
| **Agent key** | The PayGate server | Can call only `request_payment` on the vault. It cannot transfer, add keys, or call owner methods. |
| **Owner account** | Your NEAR wallet | Approves large payments and can freeze, change limits, manage payees and withdraw. The server never holds this key. |
| **PayGate app** | You, behind a password | Jobs, deliveries, reviews and receipts. Every owner action opens your wallet, and the app checks the signed transaction on-chain before recording it. |

A typical job:

1. You create a job with a brief, an allowlisted payee and a budget in NEAR.
2. The agent does the work on NEAR AI Cloud, or you record what the payee delivered.
3. You review the delivery. The app shows the payment's dollar value from a live NEAR Intents quote.
4. You pay. Payments up to the automatic limit go out at once through the agent key. Larger ones are held by the vault until you approve them in your wallet.
5. A receipt records the NEAR transaction and is hash-linked to the previous receipt.

## What is real

| Part | Status |
| --- | --- |
| Vault contract, agent key restriction, limits, allowlist, freeze | Real. Enforced by NEAR on mainnet, testnet or a local node. |
| Payments | Real NEAR to the payee's account. |
| Owner approvals and settings | Signed in your wallet through MyNearWallet's signing page. You can also sign with any tool and paste the transaction hash. |
| Vault balance, daily spend, limits, pending payments | Read live from the contract. |
| Receipts | Hash-linked SHA-256 chain, each pointing to its NEAR transaction. |
| Dollar values | Live dry quotes from NEAR Intents 1Click. No swap is made. |
| NEAR AI Cloud inference | Live with your `NEAR_AI_API_KEY`. Without it, you record deliveries yourself. |
| NEAR AI Cloud attestation | Live. The app checks the format, nonce binding and configuration measurement. It does not verify Intel's signature; use the [NEAR AI Verification Center](https://docs.near.ai/cloud/verification/verification-center) for that. |

The contract has not had an independent security audit. Start on mainnet with small limits and a small balance.

## Try it locally

Requires Node.js 22.22.2 or later.

```sh
npm install
```

### See an attack fail

```sh
npm run demo:attack
```

This starts a local NEAR node, deploys the vault and plays an agent hijacked by a prompt injection, using its real key. Each of 12 attacks shows `BLOCKED` with the rule that stopped it, and the attacker receives 0 NEAR. A saved run is in [docs/attack-demo-log.txt](docs/attack-demo-log.txt).

### Use the app on a local node

```sh
npm run dev:chain
```

Open http://localhost:3000. A local node has no wallet, so a built-in local wallet signs owner actions. It is switched on only for a local node and refuses everything else. The node and its workspace are deleted when you stop the command.

## Deploy to mainnet

### 1. Deploy the vault

You need a mainnet account to own the vault, holding enough NEAR for the vault funding plus about 0.4 NEAR. About 2.04 NEAR of the vault funding stays locked to store the contract code.

Choose your limits and payees, then run this on your own machine. Without the confirmation flag it only checks everything and prints a summary:

```sh
NEAR_NETWORK=mainnet NEAR_OWNER_ACCOUNT=you.near NEAR_OWNER_KEY=ed25519:... VAULT_FUND=3 LIMIT_AUTO=0.1 LIMIT_MAX=1 LIMIT_DAILY=2 PAYEES=contractor.near npm run vault:deploy
```

When the summary is right, run the same command with ` -- --yes-mainnet` at the end. The script:

- creates `paygate-vault.you.near` and `paygate-agent.you.near`;
- deploys and initializes the contract;
- gives the agent its single restricted key;
- adds the payees to the allowlist;
- removes the vault's own key.

It writes `data/chain.json`, which includes the agent's restricted key. Keep that file private. Your owner key is used only for this run and is not saved anywhere.

To use a key you can revoke afterwards, add a new full-access key to your account for the deployment, then delete it in your wallet when you are done. Add more funds at any time by sending NEAR to the vault account.

### 2. Run PayGate on Railway

```sh
railway init --name paygate
railway add --service paygate
railway domain --service paygate
railway service link paygate
railway volume add --mount-path /data
railway variables --service paygate --set PUBLIC_URL=https://your-domain.up.railway.app --set DATA_DIR=/data --set PAYGATE_PASSWORD='a long random password'
railway variables --service paygate --set "PAYGATE_CHAIN_JSON=$(cat data/chain.json)"
railway up --service paygate
```

Optionally set `NEAR_AI_API_KEY` so the agent can do the work. Then check the deployment. This check signs in and reads, but never pays or changes anything:

```sh
PAYGATE_PASSWORD='your password' npm run check:deployed -- https://your-domain.up.railway.app
```

### 3. Use it

Sign in, then add labels for your payees in **Controls**. Owner actions open MyNearWallet: approving a payment, freezing, changing limits, adding or removing payees, and withdrawing. After you sign, the wallet returns you to PayGate, which checks the transaction on-chain.

If you use another wallet, sign the same call there and paste the transaction hash into the payment's review dialog. With NEAR CLI, approving payment 7 is:

```sh
near contract call-function as-transaction paygate-vault.you.near approve_payment json-args '{"id":7}' prepaid-gas '60 Tgas' attached-deposit '1 yoctoNEAR' sign-as you.near network-config mainnet sign-with-keychain send
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAYGATE_PASSWORD` | none | Owner password. Required when `PUBLIC_URL` is set, at least 12 characters |
| `PUBLIC_URL` | none | Public https address; the server then listens on all interfaces and requires the password |
| `DATA_DIR` | `./data` | Where the workspace is saved. Use a Railway volume |
| `PAYGATE_CHAIN_JSON` | none | Vault settings as JSON, instead of `DATA_DIR/chain.json` |
| `NEAR_AI_API_KEY` | none | Lets the agent do the work on NEAR AI Cloud |
| `NEAR_AI_MODEL` | `qwen/qwen3.5-397b-a17b` | Model for inference and attestation |
| `PORT` | `3000` | Port |

For `npm run vault:deploy` only, on your own machine: `NEAR_NETWORK`, `NEAR_OWNER_ACCOUNT`, `NEAR_OWNER_KEY`, `VAULT_FUND`, `LIMIT_AUTO`, `LIMIT_MAX`, `LIMIT_DAILY`, `PAYEES`, and optionally `AGENT_FUND` (0.3), `AGENT_ALLOWANCE` (0.25), `VAULT_NAME`, `AGENT_NAME`, `NEAR_RPC_URL`. The server refuses to start if `NEAR_OWNER_KEY` is set with a testnet or mainnet vault.

## Verify

```sh
npm test
npm run check:live
cd contract && cargo test
```

`npm test` works offline against a local stub. `npm run check:live` calls the real 1Click and NEAR AI endpoints and spends nothing. For browser checks, run `npx playwright install chromium`, then:

- `npm run test:browser` checks sign-in, setup guidance and the evidence room without a vault.
- `npm run test:chain` drives the whole app against a local NEAR node, through the same wallet redirect a real owner uses.

`test:chain` covers:

- automatic and owner-approved payments, and rejections;
- freeze, limits, payees and withdrawal;
- forged approval hashes;
- interrupted payments, and pending payments with tampered terms;
- the mobile layout.

See [REPRODUCIBILITY.md](REPRODUCIBILITY.md) for trust boundaries.

## Security model

| Rule | Where it is enforced | What it stops |
| --- | --- | --- |
| Agent key can only call `request_payment` | NEAR access key | Direct transfers, new keys, other contracts, owner methods |
| Recipient allowlist | Contract | Paying an attacker |
| Per-payment and daily limits | Contract | Large or repeated theft |
| Owner approval above the automatic limit | Contract and your wallet | Large payments nobody reviewed |
| Each job can be paid once | Contract | Replayed payments |
| Limit and allowlist changes apply to pending payments | Contract | A held payment slipping through after the rules tighten |
| Freeze, including pending payments | Contract | Everything, until the owner resumes |
| Owner withdraw, works while frozen | Contract | Funds being stuck during an incident |
| Owner key stays in your wallet | Deployment | A server breach taking the vault |
| Approvals checked on-chain | Server | A forged wallet callback recording a payment that never happened |

The vault account has no keys, so its code cannot be replaced. Owner methods need one attached yoctoNEAR, which a function-call key cannot send.

**Remaining risks:**

- **Server breach or stolen agent key.** Someone who takes over the server or steals the agent key can spend up to the automatic limit per payment and up to the daily limit per day, but only to allowlisted payees. Set the automatic limit to what you could lose in a day.
- **Fixed daily windows.** The limit uses fixed 24-hour windows, so spending at the end of one window and the start of the next can reach twice the daily limit in a short time.
- **Agent quotas.** A hijacked agent can use up its 50 requests a day or fill the queue of 20 pending payments, which blocks payments until you reject them.
- **Gas allowance.** When the agent's gas allowance runs out, add a new restricted key or use `set_agent`.
- **Your password.** The password protects the workspace. Use a long random one.

## Project structure

- `contract/`: the vault in Rust, with the built WASM in `contract/res/`
- `chain.mjs`: vault deployment, agent requests, wallet links and on-chain checks
- `domain.mjs`: job, payment and receipt rules
- `near.mjs`: NEAR AI Cloud, attestation checks and 1Click quotes
- `server.mjs`: HTTP server, sign-in and persistence
- `public/`: browser interface
- `scripts/`: deployment, local node, attack demo and checks
- `test/`: unit and server tests
- `docs/ARCHITECTURE-PROPOSAL.md`: the original, much larger design, kept for context

## Hackathon notes

Built for NEAR HACKATHON. Suggested tracks: `security` (on-chain spending limits, restricted keys, wallet approvals, freeze, attack demo) and `privacy` (private inference and attestation checks). Libraries: `near-api-js` at runtime, `near-sdk` in the contract, and `near-sandbox` and Playwright for tests. Development used AI coding tools.

## License

[MIT](LICENSE)
