# PayGate: running, verifying and trust boundaries

Requires Node.js 22.22.2 or later. Run `npm install`, then `npm run dev:chain`, and open http://localhost:3000. `npm run demo:attack` and `npm run dev:chain` download the NEAR sandbox binary on first use. Tested on macOS on Apple silicon. The README covers mainnet deployment.

## Trust boundaries

- **Owner key.** The server never holds it on testnet or mainnet, and refuses to start if `NEAR_OWNER_KEY` is set there. Owner actions are built as unsigned transactions and signed in the owner's wallet. The local-node wallet signs only on a local node, and only calls from the owner to the vault.
- **Wallet callbacks.** A callback is not trusted. The server fetches the transaction from NEAR and requires all of the following before it records a payment:
  - the transaction was signed by the owner;
  - it was sent to the vault;
  - it calls `approve_payment` or `reject_payment` with this job's payment id;
  - it succeeded.

  A transfer that fails on-chain, for example because the payee account was deleted, is reported and not recorded as paid.
- **Agent key.** It is a function-call key for `request_payment` on the vault, and it lives in the vault settings on the server. Someone who takes over the server can spend with it up to the automatic limit per payment and the daily limit, and only to allowlisted payees.
- **Sign-in.** When `PUBLIC_URL` is set, the server listens publicly and requires `PAYGATE_PASSWORD`, which must be at least 12 characters.
  - Sessions last 12 hours, in an HttpOnly, Secure, SameSite=Lax cookie.
  - Sign-in is limited to 10 attempts per address every 15 minutes.
  - Mutations need the `X-PayGate` header and an allowed origin.
  - Requests for unknown hosts are refused.
- **Browser input.** Results come only from the server, the chain or NEAR AI. Delivery, quote, settlement and payment fields sent by the browser are discarded, and internal actions are refused.
- **Storage.** The workspace (jobs, deliveries, labels, receipts) is a JSON file in `DATA_DIR`, written atomically and not encrypted. NEAR transactions are the authoritative record of payments. Receipt hashes detect edits against a retained hash; they are not signatures.

## Integration notes

- **NEAR Intents.** Quotes are always `dry`, so 1Click returns no deposit address and no swap can happen. They price NEAR in USDC on NEAR.
- **Attestation.** The check reads the TDX quote directly and confirms its format, nonce binding and gateway configuration measurement. It does not verify Intel's signature or replay the RTMR3 event log. Response signatures from NEAR AI are recorded, not verified locally.
- **NEAR AI requests.** Briefs sent to NEAR AI Cloud are standard API requests. The app does not end-to-end encrypt them.
- **Wallets.** Wallet links use MyNearWallet's signing page. Its own code shows it signs with the owner's key and nonce, ignoring the placeholder key in the link. Any other signer works through the transaction-hash field.

## Rebuilding the contract

`contract/res/paygate_vault.wasm` is committed, so no Rust toolchain is needed. To rebuild it, run `cargo build --release --target wasm32-unknown-unknown` in `contract/` and copy the output to `res/`. The build needs the `--cfg near` flag in `contract/.cargo/config.toml`, because `near-sdk` otherwise drops every contract panic message. The contract needs nearcore 2.14 or later, so the sandbox is pinned to 2.14.0.

## Verification

- `npm test` runs domain, NEAR service and server tests offline, against a local stub.
- `npm run check:live` calls the real public endpoints and needs no key.
- `cd contract && cargo test` runs the contract's 18 unit tests.

`npx playwright install chromium` installs the browser for the next two checks. On macOS with Chrome installed, you can skip the download by prefixing them with `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`.

- `npm run test:browser` checks sign-in, the no-vault setup, receipts, the enclave report, navigation before data loads and the mobile layout.
- `npm run test:chain` deploys a vault on a local NEAR node and drives every flow through the browser, checking balances and transactions on-chain:
  - automatic and owner-approved payments, and rejections;
  - freeze, limits, payees and withdrawal;
  - forged approval hashes;
  - interrupted and tampered pending payments.
- `npm run check:deployed` checks a live deployment without paying or changing anything.

Screenshots are saved to `test-results/`.
