# Nocturne

Nocturne is a local workspace where a small company hires AI agents with a fixed budget, reviews their work, and approves payment under limits the owner sets. It is built around NEAR AI Cloud private inference and NEAR Intents settlement.

**The problem:** giving an AI agent a budget means trusting it with money, and a company's vendors, prices and strategy are exposed if its agents use ordinary AI APIs and public payment rails. Nocturne keeps a person in control of every payment and shows which parts of the process can be checked.

## What is real and what is simulated

| Part | Status |
| --- | --- |
| Job, budget, limit and freeze rules | Real. Enforced on the server and persisted locally. |
| Hash-linked receipts | Real. SHA-256 chain, verifiable in the app and exportable as JSON. |
| NEAR Intents quotes | **Live.** Each review fetches a real 1Click quote for USDC on NEAR to USDC on Base. |
| NEAR AI Cloud attestation | **Live.** Fetches the public report with a fresh nonce and checks it locally. |
| NEAR AI Cloud inference | **Live with your key.** Without `NEAR_AI_API_KEY`, agents return a labelled sample. Tested only against a local stub so far. |
| Treasury balance and payments | **Simulated.** Sample USDC. No funds move and no transaction is signed. |
| NEAR Business, OutLayer, Agent Market | Not connected. |
| Proof of solvency | Not implemented. |

Quotes always use `dry: true`, so 1Click returns no deposit address. The attestation check confirms the quote format, the nonce binding, the gateway configuration measurement and the model report nonce. It does **not** verify Intel's signature on the quote, so it is a consistency check rather than full proof. Use the [NEAR AI Verification Center](https://docs.near.ai/cloud/verification/verification-center) for that.

## Try it

Requires Node.js 20 or later. There are no runtime dependencies.

```sh
npm run dev
```

Open http://localhost:3000, then:

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

## Configuration

All settings are optional. See [.env.example](.env.example). The app reads environment variables only and does not load `.env` by itself.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEAR_AI_API_KEY` | none | Enables real agent deliveries |
| `NEAR_AI_MODEL` | `qwen/qwen3.5-397b-a17b` | Model for inference and attestation |
| `PAYOUT_RECIPIENT` | sample address | Address used in dry quotes |
| `PAYOUT_REFUND` | `sample.near` | Refund account used in dry quotes |
| `PORT` | `3000` | Local port |
| `DATA_DIR` | `./data` | Workspace location |

## Verify

```sh
npm test
npm run check:live
```

`npm test` works offline, using a local stub for NEAR services. `npm run check:live` calls the real public 1Click and NEAR AI endpoints. It needs no key and spends nothing.

For browser checks, run `npm install` and `npx playwright install chromium`, then `npm run test:browser`. See [REPRODUCIBILITY.md](REPRODUCIBILITY.md) for details and trust boundaries.

## How NEAR fits in

- **NEAR AI Cloud** runs agent work behind an attested gateway. The default model was chosen because its public report includes TDX and GPU evidence. The app does not yet use end-to-end encryption.
- **NEAR Intents** provides the cross-chain route and price for paying an agent. The quote is stored in the hashed receipt, so the approved terms can be inspected later.

## Project structure

- `domain.mjs`: job, payment and receipt rules
- `near.mjs`: NEAR AI Cloud and 1Click calls, and attestation checks
- `server.mjs`: loopback HTTP server and atomic persistence
- `public/`: browser interface
- `test/`, `scripts/`: tests, NEAR stub, and browser and live checks
- `docs/ARCHITECTURE-PROPOSAL.md`: the original, much larger design, kept for context

## Hackathon notes

Built for NEAR HACKATHON. Suggested tracks: `security` (spending limits, human approval, freeze, attestation checks) and `privacy` (private inference). Runtime has no third-party libraries. Playwright is used for tests only, and development used AI coding tools.

## License

[MIT](LICENSE)
