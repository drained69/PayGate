# Nocturne local product

Requires Node.js 20+. Run `npm run dev` and open http://localhost:3000. Use `PORT=3001 npm run dev` if the port is occupied. Runtime has no external package dependencies.

The README has the step-by-step walkthrough.

## Data and trust boundaries

This is a single-user local application. The server binds only to loopback, rejects unexpected Host and cross-origin mutation requests, serializes mutations, and uses atomic file replacement. It is not a hosted multi-user service. Local processes and the operating-system user can access the workspace. Storage is not encrypted. Use sample business data.

Money is represented with cent precision during arithmetic. Budgets cannot overcommit the treasury. Completed jobs can be paid once; frozen payments and payments above the limit are rejected on the server. Receipts include policy, amount, timestamp, previous hash, and SHA-256 hash. These hashes detect changes relative to a retained trusted hash; they are not signatures and cannot stop someone with disk access from rewriting the entire chain.

The opening ledger includes sample prior spending. Charts show only settlements recorded in this installation. Browser localStorage from the earlier prototype is not imported. No secrets are collected by the UI.

## Integration status

Treasury balances and payments are simulated, and no funds move. NEAR Intents quotes and the NEAR AI Cloud attestation report are live and need no key. Agent deliveries are samples unless `NEAR_AI_API_KEY` is set. Without internet access the app still works: the review dialog reports that the quote is unavailable and the report check shows an error. NEAR Business, OutLayer and Agent Market are not connected. Proof of solvency is not implemented.

The attestation check reads the TDX quote directly and confirms its format, nonce binding and gateway configuration measurement. It does not verify Intel's signature or replay the RTMR3 event log, so it does not prove on its own that the quote came from genuine hardware. Receipts keep `hardwareAttested: false` for that reason. Response signatures are recorded in receipts but not verified locally.

When a key is set, briefs are sent to NEAR AI Cloud as standard API requests. They are not end-to-end encrypted by the app. Prompts and replies are never logged, but they are stored unencrypted in the local workspace.

## Verification

`npm test` runs payment and integration tests offline against a local stub. `npm run check:live` calls the real public endpoints and needs no key. `npm install` installs browser-test tooling. `npx playwright install chromium` installs its browser. Browser tests use a separate temporary workspace, a separate port and the local stub, so they change none of your data and need no network or key.

Run `npm run test:browser` for end-to-end checks. On macOS with Chrome installed, you can avoid the Chromium download:

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
```

Browser verification covers job creation, visible form and payment errors, stubbed agent delivery, quotes, refresh persistence, receipt chain verification, the enclave report check, concurrent duplicate payments, rejection of untrusted mutation requests and client-supplied deliveries, freeze enforcement, and mobile overflow. Screenshots are saved to `test-results/`.
