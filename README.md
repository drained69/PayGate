# Nocturne

Nocturne lets a company give an AI agent a budget without giving it control of the money. A NEAR smart contract holds the funds and enforces the owner's limits, so even a fully hijacked agent cannot overspend or pay an attacker.

**The problem:** an AI agent that can pay for things can be tricked into paying the wrong person. Text hidden in a document or brief can instruct it to send funds, and rules written in the agent's prompt or app code stop working once the agent is compromised. Nocturne puts the rules where the agent cannot reach them.

## What is real and what is simulated

| Part | Status |
| --- | --- |
| On-chain spending vault | **Real contract.** Run on a local NEAR node by `npm run dev:chain`. Testnet deployment is scripted but has not been run. |
| Agent key restriction | **Real.** The agent's only key can call nothing except `request_payment` on the vault. |
| Job, budget, limit and freeze rules | Real. Enforced in the app, and by the contract when a vault is connected. |
| Hash-linked receipts | Real. SHA-256 chain, verifiable in the app and exportable as JSON. |
| NEAR Intents quotes | **Live.** Each review fetches a real 1Click quote for USDC on NEAR to USDC on Base. |
| NEAR AI Cloud attestation | **Live.** Fetches the public report with a fresh nonce and checks it locally. |
| NEAR AI Cloud inference | **Live with your key.** Without `NEAR_AI_API_KEY`, agents return a labelled sample. Tested only against a local stub so far. |
| Vault payments | **Test NEAR only.** Jobs priced in USDC settle at a fixed 1 USDC = 0.001 test NEAR. |
| Treasury balance in the app | **Sample figures.** The vault's real balance is on the Controls page. |
| Cross-chain settlement | **Quote only.** NEAR Intents has no testnet, so no cross-chain payment is sent. |
| NEAR Business, OutLayer, Agent Market | Not connected. |
| Proof of solvency | Not implemented. |

Quotes always use `dry: true`, so 1Click returns no deposit address. The attestation check confirms the quote format, the nonce binding, the gateway configuration measurement and the model report nonce. It does **not** verify Intel's signature on the quote, so it is a consistency check rather than full proof. Use the [NEAR AI Verification Center](https://docs.near.ai/cloud/verification/verification-center) for that.

## Try it

Requires Node.js 22.22.2 or later, because `near-api-js` needs it.

```sh
npm install
```

### See an attack fail (under a minute)

```sh
npm run demo:attack
```

This starts a real local NEAR node, deploys the vault, and plays an agent hijacked by a prompt injection, using its real key. No account or funds are needed. The first run downloads the NEAR sandbox binary. Each attack shows `BLOCKED` with the rule that stopped it, and the last line shows the attacker received 0 NEAR. The script fails if any attack succeeds, or if the wrong rule stops it. A saved run is in [docs/attack-demo-log.txt](docs/attack-demo-log.txt).

The demo plays a compromised agent directly instead of asking a model to obey the injection. This is the worst case, and the protection does not depend on how the model behaves.

### Use the app with the on-chain vault

```sh
npm run dev:chain
```

Open http://localhost:3000. The header shows `Vault enforced on-chain`.

1. In **Jobs & agents**, select **Review & pay** on *Competitive landscape report*, then **Approve demo payment**. This $180 job is above the 0.1 NEAR automatic limit, so the contract holds it and the app approves it as the owner.
2. Select **Create job** with a budget of 25, then **Run agent**, **Review & pay** and **Approve demo payment**. This payment is sent automatically.
3. Open **Evidence room**. Each receipt shows `On-chain · sandbox`, its route and its transaction hash.
4. Open **Controls**. **On-chain spending rules** shows the contract's limits, today's spending and the vault balance. Select **Freeze demo payments** and the status changes to `Frozen`.

The local chain and its workspace are deleted when you stop the command.

### Use the app without a chain

```sh
npm run dev
```

Payments are then local records only. Open http://localhost:3000, then:

1. In **Jobs & agents**, select **Review & pay** on *Competitive landscape report*. You see the delivery and a live quote showing what the recipient would receive on Base.
2. Select **Approve demo payment**. The balance falls by $180 and the job shows Paid.
3. Open **Evidence room** and select **Verify receipt chain**. You see that all receipt hashes and links match, and the receipt shows the quote.
4. Select **Check enclave report**. After 10 to 20 seconds you see four passing checks, the model, and the quote hash.
5. Open **Controls** and select **Freeze demo payments**. In **Jobs & agents**, select **Run agent** on *November launch campaign*, then **Review & pay**, then **Approve demo payment**. The review dialog shows `Payments are frozen.`
6. In **Controls**, select **Resume demo payments**, set **Maximum payment** to 100 and save. Approve *November launch campaign* again. The review dialog shows `Payment exceeds your limit.`
7. To use a real agent, stop the server and start it with a key from https://cloud.near.ai:

   ```sh
   NEAR_AI_API_KEY=your-key npm run dev
   ```

   Select **Create job**, then **Run agent**. The review dialog shows the model that wrote the delivery. The receipt records the chat ID, request and response hashes, and the response signature when NEAR AI provides one.

To start again, stop the server and delete `data/`.

### Deploy to NEAR testnet

This needs a testnet account you control with at least 6.5 NEAR available.

```sh
NEAR_OWNER_ACCOUNT=your-account.testnet NEAR_OWNER_KEY=ed25519:... npm run vault:deploy
```

Then start the app with `NEAR_OWNER_KEY` still set, using `npm run dev`. Receipts then link to the testnet explorer. Each owner account can create one vault, because the script uses fixed `vault`, `agent` and `worker` sub-accounts. Use a new owner account to deploy again.

## Configuration

All settings are optional. See [.env.example](.env.example). The app reads environment variables only and does not load `.env` by itself.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEAR_AI_API_KEY` | none | Enables real agent deliveries |
| `NEAR_AI_MODEL` | `qwen/qwen3.5-397b-a17b` | Model for inference and attestation |
| `PAYOUT_RECIPIENT` | sample address | Address used in dry quotes |
| `PAYOUT_REFUND` | `sample.near` | Refund account used in dry quotes |
| `NEAR_OWNER_ACCOUNT` | none | Testnet owner, for `vault:deploy` only |
| `NEAR_OWNER_KEY` | none | Owner key, used to approve, freeze and change limits |
| `NEAR_RPC_URL` | testnet RPC | Node used by `vault:deploy` |
| `PORT` | `3000` | Local port |
| `DATA_DIR` | `./data` | Workspace location |

## Verify

```sh
npm test
npm run check:live
```

`npm test` works offline, using a local stub for NEAR services. `npm run check:live` calls the real public 1Click and NEAR AI endpoints. It needs no key and spends nothing. `cd contract && cargo test` runs the contract's unit tests.

For browser checks, run `npx playwright install chromium`, then `npm run test:browser` and `npm run test:chain`. The second drives the app against a local NEAR node and confirms each payment on-chain. See [REPRODUCIBILITY.md](REPRODUCIBILITY.md) for details and trust boundaries.

## How the protection works

The vault at [contract/src/lib.rs](contract/src/lib.rs) holds the funds. The agent can only ask it for money.

| Rule | Where it is enforced | What it stops |
| --- | --- | --- |
| Agent key can only call `request_payment` | NEAR access key | Direct transfers, new keys, other contracts, owner methods |
| Recipient allowlist | Contract | Paying an attacker |
| Per-payment and daily limits | Contract | Large or repeated theft |
| Owner approval above the automatic limit | Contract | Large payments nobody reviewed |
| Each job can be paid once | Contract | Replayed payments |
| Limit and allowlist changes apply to pending payments | Contract | A held payment slipping through after the rules tighten |
| Freeze, works on pending payments too | Contract | Everything, until the owner resumes |
| Owner withdraw, works while frozen | Contract | Funds being stuck during an incident |

The vault account has no keys after setup, so its code cannot be replaced and its rules can change only through its owner methods. Those methods need one attached yoctoNEAR, which a function-call key cannot send.

**Remaining risk:** a stolen agent key can still spend up to the daily limit, but only to allowlisted recipients. The limit uses fixed 24-hour windows, so spending at the end of one window and the start of the next can reach twice the limit in a short time. A hijacked agent can also waste its quota of 50 requests a day or fill the queue of 20 pending payments, which blocks payments until the owner clears them. The agent also needs a gas allowance, and when that 0.5 NEAR runs out it stops working until the owner issues a new key. In this demo the app holds the owner key so that one person can try every step. A real deployment should keep it in a hardware or browser wallet, away from the agent.

The contract has not had an independent security audit. Use it with test funds only.

## How NEAR fits in

- **Access keys and smart contracts** let the rules sit outside the agent. A restricted key is enforced by the network, so the agent cannot talk its way around it.
- **NEAR AI Cloud** runs agent work behind an attested gateway. The default model was chosen because its public report includes TDX and GPU evidence. The app does not yet use end-to-end encryption.
- **NEAR Intents** provides the cross-chain route and price for paying an agent. The quote is stored in the hashed receipt, so the approved terms can be inspected later.

## Project structure

- `domain.mjs`: job, payment and receipt rules
- `contract/`: the spending vault in Rust, with the built WASM in `contract/res/`
- `chain.mjs`: vault deployment and calls
- `near.mjs`: NEAR AI Cloud and 1Click calls, and attestation checks
- `server.mjs`: loopback HTTP server and atomic persistence
- `public/`: browser interface
- `test/`, `scripts/`: tests, NEAR stub, and browser and live checks
- `docs/ARCHITECTURE-PROPOSAL.md`: the original, much larger design, kept for context

## Hackathon notes

Built for NEAR HACKATHON. Suggested tracks: `security` (spending limits, restricted keys, human approval, freeze, attack demo) and `privacy` (private inference and attestation checks). Libraries: `near-api-js` at runtime, `near-sdk` in the contract, and `near-sandbox` and Playwright for tests. Development used AI coding tools.

## License

[MIT](LICENSE)
