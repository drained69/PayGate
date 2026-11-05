# PayGate: running, verifying and trust boundaries

Requires Node.js 22.22.2 or later. Run `npm install`, then `npm run dev:chain`, and open http://localhost:3000. `npm run dev:chain`, `npm run demo:attack` and `npm run test:chain` download the NEAR sandbox binary on first use. Tested on macOS on Apple silicon. The README covers deploying the platform to mainnet.

## Trust boundaries

- **Owner keys.** PayGate never holds a customer's owner key. Sign-in and every owner action are signed in the customer's wallet.
- **Local-node wallet.** The stand-in wallet used by `dev:chain` and the tests exists only on a local node. The server refuses to start with test accounts on testnet or mainnet.
- **Sign-in.** The server issues a 32-byte nonce, valid once for five minutes. The wallet signs a NEP-413 payload with message, nonce, recipient (this site's host) and callback URL. The server verifies the signature, then confirms on-chain that the public key is a full-access key of the claimed account. Sessions are random 32-byte tokens, stored only as SHA-256 hashes, in HttpOnly SameSite=Lax cookies that are Secure when hosted. They last 7 days.
- **Vault creation.** The customer signs `create_vault` on the factory. Before saving the vault, the server fetches the transaction and checks:
  - the signer is the customer;
  - the receiver is the factory;
  - the name and agent public key are the ones it issued;
  - the factory emitted `vault_created` for this owner, vault and agent.
- **Factory.** The factory has no keys. It creates each vault with the global contract pinned by hash and initializes it in the same receipt, so nobody can front-run or change it. If vault creation fails, it refunds the whole deposit; if only the agent fails, it refunds the agent funding. It keeps a small buffer for refunds and holds no customer funds otherwise.
- **Approvals.** A wallet callback is never trusted on its own. The server fetches the transaction from NEAR and requires all of the following:
  - the owner signed it;
  - it was sent to that customer's vault;
  - it calls the expected method with this payment's id;
  - it succeeded.

  A transfer that failed on-chain is reported, not recorded as paid.
- **Agent keys.** Each agent key is a function-call key limited to `request_payment` on one vault. It is sealed with AES-256-GCM under a key derived from `PAYGATE_SECRET`, and it is decrypted only in server memory to sign the agent's requests. Someone holding both the database and the secret can spend up to each customer's automatic limit per payment and daily limit, only to that customer's payees.
- **NEAR AI keys.** They are sealed the same way and used only for that customer's agent runs. Keys, sealed or not, are never returned to the browser.
- **Requests.** Results come only from the server, the chain or NEAR AI. Delivery, quote, settlement and payment fields sent by the browser are discarded, and internal actions are refused. Mutations need the `X-PayGate` header and an allowed origin. Requests for unknown hosts are refused, and sign-in and actions are rate limited.
- **Networks.** Each network keeps its own customers in the same database: testnet rows use the account name, mainnet and local-node rows are prefixed with the network. Sessions from another network are ignored, so switching a server from testnet to mainnet never shows a testnet vault to a mainnet customer.
- **Storage.** In Postgres, each account is updated inside a transaction with `SELECT … FOR UPDATE`, so concurrent requests apply in order, even across instances. Without `DATABASE_URL`, data goes to files written atomically, one per account. NEAR transactions are the authoritative record of payments; receipt hashes detect edits against a retained hash but are not signatures.

## Integration notes

- **NEAR Intents.** Quotes are always `dry`, so 1Click returns no deposit address and no swap can happen. They price NEAR in USDC on NEAR.
- **Attestation.** The check reads the TDX quote directly and confirms its format, nonce binding and gateway configuration measurement. It does not verify Intel's signature or replay the RTMR3 event log.
- **Wallets.** On testnet and mainnet, wallets connect through NEAR Connect (`public/vendor/near-connect.js`, bundled from `@hot-labs/near-connect` 0.12.0). Each wallet's code is fetched from the NEAR Connect wallet list and runs in a sandboxed iframe without same-origin access. The page's Content Security Policy allows inline code only with a per-response nonce, and allows wallets to reach their own services over https. Sign-in signs the NEP-413 message while connecting. Owner actions are sent to the wallet as transactions, and their hashes are checked on-chain. On a local node, a stand-in wallet signs through `/wallet-callback.html` instead.

## Rebuilding the contracts

`contract/res/paygate_vault.wasm` and `contract/res/paygate_factory.wasm` are committed, so no Rust toolchain is needed. To rebuild them, run `cargo build --release --target wasm32-unknown-unknown` in `contract/` and in `contract/factory/`, and copy each output to `contract/res/`. The build needs the `--cfg near` flag in `contract/.cargo/config.toml`, because `near-sdk` otherwise drops every contract panic message. The contracts need nearcore 2.14 or later, so the sandbox is pinned to 2.14.0. Publishing the vault code as a global contract burns ten times the normal storage cost, about 20.7 NEAR.

## Verification

| Command | Covers |
| --- | --- |
| `npm test` | Domain, NEAR services, encryption, NEP-413, server security and the file store, offline |
| `cd contract && cargo test` | 21 vault tests |
| `cd contract/factory && cargo test` | 5 factory tests |
| `npm run test:postgres` | The store against real Postgres, in Docker or at `DATABASE_URL` |
| `npm run test:browser` | The public site and the sign-in hand-off |
| `npm run test:chain` | The whole product on a local node, through the wallet pop-up flow (list below) |
| `npm run check:live` | The real public 1Click and NEAR AI endpoints |
| `npm run check:deployed -- <url>` | A live deployment, read-only |

`npm run test:chain` covers:

- sign-in and vault creation;
- payments, approvals and rejections;
- controls;
- forged approvals;
- isolation between two customers;
- forged and replayed sign-ins;
- data deletion.

Screenshots are saved to `test-results/`.
