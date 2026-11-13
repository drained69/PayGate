// In-app documentation. Static text, so it renders before sign-in too.
export const sections=[
{id:'introduction',title:'Introduction',html:`
<p class="eyebrow">Docs</p><h1>What PayGate is</h1>
<p class="lead">PayGate lets anyone give an AI agent a budget without giving it control of the money.</p>
<p>An agent that can pay for things can be tricked into paying the wrong person. Text hidden in a document, an email or a job brief can instruct it to send funds. Rules written into the agent's prompt or into app code stop working the moment the agent is compromised.</p>
<p>PayGate moves the rules somewhere the agent cannot reach: a smart contract on NEAR that you own. The agent's only key can do one thing, ask your vault for a payment. The vault decides.</p>
<h2>The parts</h2>
<table><thead><tr><th>Part</th><th>Held by</th><th>What it can do</th></tr></thead><tbody>
<tr><td><b>Your vault</b></td><td>Nobody. It has no keys</td><td>Holds your NEAR. Pays only your allowlisted payees, within your per-payment and daily limits. Holds back anything above your automatic limit until you approve it.</td></tr>
<tr><td><b>Your agent</b></td><td>PayGate, encrypted</td><td>Calls <code>request_payment</code> on your vault, and nothing else. It cannot transfer, add keys or call owner methods.</td></tr>
<tr><td><b>Your account</b></td><td>Your NEAR wallet</td><td>Signs you in, approves large payments, freezes, changes limits and payees, withdraws. PayGate never holds this key.</td></tr>
<tr><td><b>The factory</b></td><td>Nobody. It has no keys</td><td>Creates your vault and agent in one transaction you sign, and refunds you if a step fails. It keeps none of your money.</td></tr>
</tbody></table>
<h2>What is real</h2>
<ul><li>Payments are real NEAR sent to your payees on the network PayGate runs on.</li><li>Balances, limits, daily spending and held payments are read live from your vault.</li><li>Dollar values come from live NEAR Intents 1Click quotes. No swap is made.</li><li>Agent work runs on NEAR AI Cloud with your own API key. Without one, you record what the payee delivered.</li></ul>`},
{id:'how-it-works',title:'How it works',html:`
<p class="eyebrow">Concepts</p><h1>How it works</h1>
<p class="lead">Sign in, create a vault, then pay through it. Each step is checked by something the agent does not control.</p>
<h2>Sign in</h2><p>Select <b>Sign in with NEAR</b>. Your wallet signs a one-time message (NEP-413). PayGate checks the signature and that the key belongs to your account on-chain. There is no password.</p>
<h2>Create your vault</h2><p>Choose a name, your first payees, limits and initial funding (at least about 2.02 NEAR when PayGate's gas relayer is on, 2.30 without: a little funds the agent, and about 1.99 NEAR stays locked in your vault for its own copy of the code and its storage, returned if you close the vault). Your wallet signs one call to the PayGate factory, which creates <code>name.factory</code> owned by you and <code>name-agent.factory</code> with a single restricted key. PayGate checks the result on-chain before showing your dashboard.</p>
<h2>A payment</h2>
<ol>
<li><b>Create a job</b> with a brief, an allowlisted payee and a budget. PayGate checks the budget against your per-payment limit and against funds not already committed to other open jobs.</li>
<li><b>Deliver.</b> The agent does the work on NEAR AI Cloud, or you record what the payee delivered.</li>
<li><b>Review</b> the delivery, the payee, the amount and its live dollar value.</li>
<li><b>Request.</b> The agent key calls <code>request_payment</code>. The vault checks freeze, allowlist, per-payment and daily limits, and that the job was not paid before.</li>
<li><b>Send or hold.</b> At or below your automatic limit, the vault pays at once. Above it, the vault holds the payment.</li>
<li><b>Approve.</b> Your wallet signs <code>approve_payment</code>. PayGate checks that you approved this exact payment before marking the job paid.</li>
<li><b>Receipt.</b> Linked to its NEAR transaction and hash-linked to the previous receipt.</li>
</ol>
<h2>Job statuses</h2>
<table><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody>
<tr><td><span class="status working">Working</span></td><td>Created, waiting for a delivery. Can be cancelled.</td></tr>
<tr><td><span class="status review">Review</span></td><td>Delivered and waiting for you to review and pay. Can be cancelled.</td></tr>
<tr><td><span class="status awaiting">Awaiting approval</span></td><td>The vault is holding the payment for your wallet approval.</td></tr>
<tr><td><span class="status paid">Paid</span></td><td>The transfer succeeded and a receipt was recorded.</td></tr>
<tr><td><span class="status cancelled">Cancelled</span></td><td>Closed without payment. Its budget is released.</td></tr>
</tbody></table>`},
{id:'quickstart',title:'Quickstart',html:`
<p class="eyebrow">Get started</p><h1>Quickstart</h1>
<p class="lead">Your first payment in a few minutes.</p>
<ol><li>Select <b>Sign in with NEAR</b> and approve the sign-in message in your wallet.</li><li>Name your vault, add a payee such as <code>contractor.near</code>, keep the suggested limits and fund it with 1 NEAR. Select <b>Create vault in wallet</b> and sign.</li><li>Open <b>Jobs</b>, select <b>Create job</b>, choose the payee and a budget of 0.05 NEAR.</li><li>Select <b>Record delivery</b>, or <b>Run agent</b> if you added a NEAR AI key in <b>Settings</b>.</li><li>Select <b>Review &amp; pay</b>, then <b>Pay 0.05 NEAR</b>. It is under the automatic limit, so it is sent at once.</li><li>Open <b>Evidence</b> to see the receipt and its transaction.</li></ol>
<h2>Try it without real funds</h2>
<pre><code>npm install
npm run dev:chain</code></pre>
<p>This runs the whole platform on a local NEAR node with two test customers and a built-in local wallet. <code>npm run demo:attack</code> plays an agent hijacked by a prompt injection: 12 attacks, all blocked.</p>`},
{id:'approvals',title:'Wallet approvals',html:`
<p class="eyebrow">Using PayGate</p><h1>Approving with your wallet</h1>
<p class="lead">Your key never leaves your wallet. PayGate prepares each owner action, your connected wallet signs it, and PayGate checks the result on-chain.</p>
<table><thead><tr><th>Action</th><th>Contract method</th></tr></thead><tbody>
<tr><td>Approve a held payment</td><td><code>approve_payment</code></td></tr><tr><td>Reject a held payment</td><td><code>reject_payment</code></td></tr><tr><td>Freeze or unfreeze</td><td><code>set_frozen</code></td></tr><tr><td>Change limits</td><td><code>set_limits</code></td></tr><tr><td>Add or remove a payee</td><td><code>set_recipient</code></td></tr><tr><td>Withdraw to you</td><td><code>withdraw</code></td></tr><tr><td>Withdraw spare NEAR from a USDC vault</td><td><code>withdraw_near</code></td></tr><tr><td>Close the vault and take back all of its NEAR</td><td><code>close</code></td></tr><tr><td>Approve a cross-chain payout</td><td><code>pay_external</code></td></tr><tr><td>Replace the agent</td><td><code>set_agent</code></td></tr>
</tbody></table>
<p>Each call attaches one yoctoNEAR. A function-call key cannot attach a deposit, so even a stolen agent key could not call these methods.</p>
<h2>Wallets</h2><p>PayGate connects wallets through NEAR Connect: Meteor, HOT, Intear, Nightly, Ledger, OKX and others. Sign in with the account that owns your vault; if your wallet is connected as a different account, PayGate asks you to switch.</p>
<h2>Another wallet or the CLI</h2><p>Sign the same call anywhere, then paste the transaction hash in the payment's review dialog. With NEAR CLI, approving payment 7 looks like this:</p>
<pre><code>near contract call-function as-transaction acme.paygate.example.near approve_payment \\
  json-args '{"id":7}' prepaid-gas '60 Tgas' attached-deposit '1 yoctoNEAR' \\
  sign-as you.near network-config mainnet sign-with-keychain send</code></pre>`},
{id:'usdc',title:'USDC budgets',html:`
<p class="eyebrow">Using PayGate</p><h1>USDC budgets</h1>
<p class="lead">Budget in dollars: a vault can hold and pay in USDC instead of NEAR.</p>
<ol><li>When you create your vault, choose <b>USDC</b> as the currency. Limits are then in USDC, for example 10 automatic, 50 per payment and 100 per day. The NEAR you send still funds the agent and the vault's code and storage; anything above that pays for USDC registrations and can be withdrawn later.</li>
<li>In <b>Controls</b>, register each payee with USDC (<b>Register in wallet</b>, 0.00125 NEAR once per payee). A token contract only pays registered accounts; a payment to an unregistered one is refunded to your vault.</li>
<li>In <b>Treasury</b>, <b>Deposit USDC</b>. Your wallet sends USDC to the vault with <code>ft_transfer_call</code>, and registers the vault with USDC if needed.</li>
<li>Pay jobs as usual. Receipts and alerts show USDC, and withdrawals return USDC to you.</li></ol>
<p>The vault keeps its own ledger of USDC: it counts only deposits from the USDC contract itself, so tokens sent another way, or other tokens, are not spendable. On mainnet PayGate uses Circle's native USDC; on testnet, Circle's testnet USDC from Circle's faucet.</p>`},
{id:'cross-chain',title:'Cross-chain payouts',html:`
<p class="eyebrow">Using PayGate</p><h1>Cross-chain payouts</h1>
<p class="lead">Pay people who want USDC on Base, Arbitrum, Ethereum, Optimism, Polygon, Avalanche or Solana, straight from a USDC vault.</p>
<ol><li>In <b>Controls → Payees on other chains</b>, choose the chain and paste the payee's USDC address. This list is kept by PayGate; only you can change it, and agent API keys cannot.</li>
<li>Create jobs for that payee as usual. When the agent or you request payment, nothing moves: cross-chain payouts always wait for you.</li>
<li>Select <b>Approve in wallet</b>. PayGate asks NEAR Intents 1Click for a live quote, which comes with a one-time NEAR deposit address. Your wallet signs <code>pay_external</code> on your vault, which registers that address with USDC and sends it the payment. 1Click then delivers USDC to the payee's address on the other chain.</li>
<li>In <b>Evidence</b>, <b>Check delivery</b> shows the 1Click status and the transaction on the destination chain.</li></ol>
<p>The vault still enforces its per-payment and daily limits, the freeze switch and one payment per job, and only your account can call <code>pay_external</code>. If the swap cannot complete, 1Click refunds the USDC to your own NEAR account, not to the vault. Each payout spends 0.00125 NEAR of the vault's NEAR to register the deposit address, so keep a little NEAR in the vault.</p>
<p>Trust: the destination address you see in PayGate is what the quote is requested for, but your wallet shows only the deposit address. You can check any deposit address on the 1Click explorer before signing. NEAR Intents runs on mainnet only, so cross-chain payouts are off on testnet.</p>`},
{id:'agent-api',title:'Agent API and MCP',html:`
<p class="eyebrow">For agents</p><h1>Agent API and MCP</h1>
<p class="lead">Your own AI agent can use PayGate directly: read the vault, create jobs, deliver work and request payment. The vault's rules apply exactly as they do to you in the dashboard.</p>
<h2>1. Create a key</h2><p>In <b>Settings → API keys for your agents</b>, name the key and choose whether it can request payments. Copy it when it appears: PayGate stores only a hash. Keys start with <code>pg_live_</code> on mainnet and <code>pg_test_</code> elsewhere. Revoke a key at any time; agents using it stop at once.</p>
<h2>2a. Connect over MCP</h2><p>The MCP server is at <code>/mcp</code> on your PayGate address (streamable HTTP, JSON responses). With Claude Code:</p>
<pre><code>claude mcp add --transport http paygate https://your-paygate/mcp \\
  --header "Authorization: Bearer pg_test_…"</code></pre>
<p>Clients that only run local servers can use <code>mcp-remote</code>:</p>
<pre><code>{"mcpServers":{"paygate":{"command":"npx","args":["mcp-remote","https://your-paygate/mcp","--header","Authorization: Bearer pg_test_…"]}}}</code></pre>
<table><thead><tr><th>Tool</th><th>What it does</th></tr></thead><tbody>
<tr><td><code>get_vault</code></td><td>Balance, limits, today's spending, frozen or not, payees, committed budget</td></tr>
<tr><td><code>list_payees</code></td><td>Accounts the vault may pay</td></tr>
<tr><td><code>list_jobs</code>, <code>get_job</code></td><td>Jobs with their delivery, payment and receipt</td></tr>
<tr><td><code>create_job</code></td><td>Title, brief, payee and budget in NEAR</td></tr>
<tr><td><code>deliver_job</code></td><td>Record what was delivered</td></tr>
<tr><td><code>request_payment</code></td><td>Only for keys allowed to pay</td></tr>
<tr><td><code>cancel_job</code></td><td>Release a job's budget</td></tr>
</tbody></table>
<h2>2b. Or call the REST API</h2>
<pre><code>KEY=pg_test_…; BASE=https://your-paygate/api/v1
curl $BASE/vault -H "Authorization: Bearer $KEY"
curl $BASE/jobs -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"title":"Competitor pricing","brief":"Summarize three pricing pages","payee":"contractor.near","amount":0.05}'
curl -X POST $BASE/jobs/PG-1a2b3c4d/deliver -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"text":"Report: https://example.com/report.pdf"}'
curl -X POST $BASE/jobs/PG-1a2b3c4d/pay -H "Authorization: Bearer $KEY"</code></pre>
<table><thead><tr><th>Endpoint</th><th>Purpose</th></tr></thead><tbody>
<tr><td><code>GET /api/v1/vault</code></td><td>Vault, limits and payees</td></tr>
<tr><td><code>GET /api/v1/payees</code></td><td>Allowlisted accounts</td></tr>
<tr><td><code>GET /api/v1/jobs?status=Review</code></td><td>Jobs, optionally by status</td></tr>
<tr><td><code>GET /api/v1/jobs/{id}</code></td><td>One job</td></tr>
<tr><td><code>POST /api/v1/jobs</code></td><td>Create a job; returns 201</td></tr>
<tr><td><code>POST /api/v1/jobs/{id}/deliver</code></td><td><code>{text}</code></td></tr>
<tr><td><code>POST /api/v1/jobs/{id}/pay</code></td><td>Request payment</td></tr>
<tr><td><code>POST /api/v1/jobs/{id}/cancel</code></td><td>Cancel</td></tr>
</tbody></table>
<h2>What a payment request returns</h2><p>At or below the automatic limit, the job comes back <code>Paid</code> with a receipt: route, NEAR transaction hash and explorer link. Above it, the job comes back <code>Awaiting approval</code>: the vault holds the payment until you approve or reject it in your wallet. The agent can poll <code>get_job</code>.</p>
<h2>What an agent can never do</h2><ul><li>Approve or reject held payments, freeze or unfreeze, change limits or payees, or withdraw. These need your wallet.</li><li>Pay anyone outside your allowlist, or more than your limits. The vault refuses it on-chain.</li><li>See your keys. API responses never include them.</li></ul>
<p>Errors return a JSON <code>{"error": "…"}</code> with status 400, 401 (missing or revoked key), 403 (key cannot pay), 404 or 429 (more than 120 requests a minute).</p>`},
{id:'alerts',title:'Alerts',html:`
<p class="eyebrow">Using PayGate</p><h1>Alerts</h1>
<p class="lead">Know the moment a payment needs your approval, without keeping PayGate open.</p>
<table><thead><tr><th>Event</th><th>When</th></tr></thead><tbody>
<tr><td><code>payment.held</code></td><td>A payment above your automatic limit waits for your wallet</td></tr>
<tr><td><code>payment.paid</code></td><td>The vault sent a payment automatically</td></tr>
<tr><td><code>job.delivered</code></td><td>Your agent delivered work through the API</td></tr>
</tbody></table>
<p>Every alert links to the job; opening the link takes you straight to its review.</p>
<h2>Webhook</h2><p>In <b>Settings → Alerts</b>, paste an incoming-webhook URL from Slack or Discord, or any https endpoint. PayGate sends a test message before saving it. Slack and Discord get a plain message. Other endpoints get JSON <code>{event, text, data, sentAt}</code> with headers <code>X-PayGate-Event</code> and <code>X-PayGate-Signature: sha256=…</code>, the HMAC-SHA256 of the body with the signing secret shown when you connect. PayGate only calls public https addresses.</p>
<h2>Telegram</h2><p>Select <b>Connect Telegram</b>, open the PayGate bot and press Start within 10 minutes. Operators enable this by setting <code>TELEGRAM_BOT_TOKEN</code> to a bot made with @BotFather.</p>`},
{id:'limits',title:'Limits and freeze',html:`
<p class="eyebrow">Using PayGate</p><h1>Limits and freeze</h1>
<p class="lead">Three limits decide how much the agent can move without you.</p>
<table><thead><tr><th>Limit</th><th>Effect</th></tr></thead><tbody>
<tr><td><b>Automatic</b></td><td>Payments at or below this go out at once.</td></tr>
<tr><td><b>Maximum per payment</b></td><td>No single payment can exceed this, even with your approval.</td></tr>
<tr><td><b>Daily</b></td><td>The total of all payments in a 24-hour window, approved ones included.</td></tr>
</tbody></table>
<p>The vault requires automatic ≤ maximum ≤ daily. Lowering a limit also applies to payments already held.</p>
<h2>Choosing values</h2><p>Set the automatic limit to zero to require your wallet for every payment. With a positive automatic limit, the agent can make multiple payments up to that amount, until it reaches the daily limit. Keep the daily limit close to your real spending.</p>
<h2>Freeze</h2><p>Freezing stops every new request and every approval at once, including held payments. Withdrawals still work while frozen.</p>
<h2>Windows</h2><p>The daily limit uses fixed 24-hour windows. Spending at the end of one window and the start of the next can reach twice the daily limit in a short time.</p>`},
{id:'payees',title:'Payees',html:`
<p class="eyebrow">Using PayGate</p><h1>Payees</h1>
<p class="lead">Your vault can only pay accounts on its allowlist.</p>
<p>Add payees when you create the vault, or later in <b>Controls</b>, where your wallet signs <code>set_recipient</code>. PayGate checks that each account exists before you sign. Labels such as "Research contractor" stay in PayGate and do not touch the chain.</p>
<p>Removing a payee also blocks payments to it that are already held. If a payee account is deleted, the transfer fails, the NEAR returns to your vault and the daily spend is restored.</p>`},
{id:'evidence',title:'Receipts and evidence',html:`
<p class="eyebrow">Using PayGate</p><h1>Receipts and evidence</h1>
<p class="lead">NEAR transactions are the authoritative record. Receipts make them easy to read and export.</p>
<p>Each receipt holds the job, payee, amount, route, payment id, transaction hash and the dollar quote at review time, plus the hash of the previous receipt. <b>Verify receipt chain</b> recomputes every hash. <b>Export JSON</b> downloads them all.</p>
<h2>Enclave report</h2><p><b>Check enclave report</b> fetches NEAR AI Cloud's public attestation report with a fresh nonce and checks its TDX quote format, nonce binding, gateway configuration and model report. It does not verify Intel's signature; use the NEAR AI Verification Center for that.</p>`},
{id:'deploy',title:'Run your own PayGate',html:`
<p class="eyebrow">Operate</p><h1>Run your own PayGate</h1>
<p class="lead">For operators. Customers do not need any of this: they sign in and create a vault.</p>
<h2>1. Deploy the platform</h2>
<p>Run once from your own machine with an operator account. It deploys the factory with the vault code stored in it, so every customer vault gets exactly that code, and the factory ends with no keys. Storage locks about 3.5 NEAR and about 2.5 NEAR stays as a refund buffer, so fund it with 6 NEAR. Nothing is burned: the operator can call <code>retire</code> to delete the factory and get it all back, without affecting existing vaults. Without the confirmation flag it only prints a summary.</p>
<pre><code>NEAR_NETWORK=mainnet NEAR_OPERATOR_ACCOUNT=you.near NEAR_OPERATOR_KEY=ed25519:... \\
npm run platform:deploy</code></pre>
<p>Run it again with <code>-- --yes-mainnet</code> to deploy. It prints the <code>PAYGATE_FACTORY</code> value for your server.</p>
<h2>2. Host it</h2>
<pre><code>railway add --database postgres
railway variables --service paygate \\
  --set NEAR_NETWORK=mainnet --set PAYGATE_FACTORY=paygate.you.near \\
  --set 'DATABASE_URL=\${{Postgres.DATABASE_URL}}' \\
  --set PUBLIC_URL=https://your-domain.up.railway.app \\
  --set PAYGATE_SECRET="$(openssl rand -hex 32)"
railway up --service paygate</code></pre>
<p><code>PAYGATE_SECRET</code> encrypts every customer's agent key and NEAR AI key. Back it up: without it, stored agent keys cannot be decrypted. Then run the read-only check:</p>
<pre><code>npm run check:deployed -- https://your-domain.up.railway.app</code></pre>
<h2>Configuration</h2>
<table><thead><tr><th>Variable</th><th>Purpose</th></tr></thead><tbody>
<tr><td><code>NEAR_NETWORK</code></td><td><code>mainnet</code>, <code>testnet</code> or <code>sandbox</code></td></tr>
<tr><td><code>PAYGATE_FACTORY</code></td><td>The factory account from step 1</td></tr>
<tr><td><code>DATABASE_URL</code></td><td>Postgres. Without it, data is kept in files in <code>DATA_DIR</code></td></tr>
<tr><td><code>PAYGATE_SECRET</code></td><td>At least 32 characters. Required when hosted</td></tr>
<tr><td><code>PUBLIC_URL</code></td><td>The public https address</td></tr>
<tr><td><code>NEAR_RPC_URL</code></td><td>RPC endpoint. Comma-separated URLs fail over. Use a dedicated provider for mainnet</td></tr>
<tr><td><code>PAYGATE_RELAYER_ACCOUNT</code>, <code>PAYGATE_RELAYER_KEY</code></td><td>Optional gas relayer (NEP-366). Create an account holding a few NEAR for gas only; agents' payment requests are relayed through it, so their allowance never runs out</td></tr>
<tr><td><code>TELEGRAM_BOT_TOKEN</code></td><td>Optional Telegram alerts, with a bot from @BotFather</td></tr>
</tbody></table>`},
{id:'security',title:'Security model',html:`
<p class="eyebrow">Trust</p><h1>Security model</h1>
<p class="lead">What each rule stops, and what risk remains.</p>
<table><thead><tr><th>Rule</th><th>Enforced by</th><th>Stops</th></tr></thead><tbody>
<tr><td>Agent key can only call <code>request_payment</code></td><td>NEAR access key</td><td>Direct transfers, new keys, other contracts, owner methods</td></tr>
<tr><td>Payee allowlist</td><td>Your vault</td><td>Paying an attacker</td></tr>
<tr><td>Per-payment and daily limits</td><td>Your vault</td><td>Large or repeated theft</td></tr>
<tr><td>Approval above the automatic limit</td><td>Your vault and wallet</td><td>Large payments nobody reviewed</td></tr>
<tr><td>Each job paid once</td><td>Your vault</td><td>Replayed payments</td></tr>
<tr><td>Vault and factory have no keys</td><td>Deployment</td><td>Anyone changing the code or taking funds</td></tr>
<tr><td>Vault code fixed by the keyless factory</td><td>Factory contract</td><td>A silent upgrade of every vault</td></tr>
<tr><td>Wallet sign-in checked on-chain</td><td>PayGate</td><td>Signing in as someone else</td></tr>
<tr><td>Approvals checked on-chain</td><td>PayGate</td><td>Forged callbacks recording payments that never happened</td></tr>
<tr><td>Agent and AI keys encrypted (AES-256-GCM)</td><td>PayGate</td><td>A database leak exposing usable keys</td></tr>
<tr><td>Cross-chain payouts only by the owner (<code>pay_external</code>)</td><td>Your vault</td><td>The agent or PayGate sending funds off NEAR</td></tr>
<tr><td>USDC counted only from the USDC contract</td><td>Your vault</td><td>Fake or unrelated tokens inflating the balance</td></tr>
<tr><td>Webhook addresses checked when connecting</td><td>PayGate</td><td>Alerts being pointed at private networks, including by DNS rebinding</td></tr>
<tr><td>Agent API keys stored as hashes, scoped, revocable</td><td>PayGate</td><td>A leaked database revealing usable API keys; agents approving or withdrawing</td></tr>
</tbody></table>
<h2>Remaining risks</h2>
<ul><li>Someone who takes over PayGate's server and its secret can use agent keys to spend up to each customer's automatic limit per payment and daily limit, only to that customer's payees. They cannot approve held payments, change rules or withdraw.</li><li>A hijacked agent can use its 50 daily requests or fill the queue of 20 held payments, which blocks payments until you reject them.</li><li>When the agent's 0.25 NEAR gas allowance runs out, it stops until a new agent is set.</li><li>For a cross-chain payout, your wallet shows the NEAR Intents deposit address, not the destination address. You rely on PayGate's quote for where it ends up; check the deposit address on the NEAR Intents explorer before signing if the amount is large.</li><li>A USDC vault needs a little NEAR for storage. If it runs out, payments fail until you send NEAR to the vault; no funds are lost.</li><li>The contracts were reviewed in-house, with unit tests for every rule and an end-to-end attack demo, but have not had an independent audit. Start with small limits and a small balance.</li></ul>
<h2>If PayGate is unavailable</h2><p>Your vault never depends on PayGate. Call it directly with NEAR CLI or any wallet that signs contract calls, attaching 1 yoctoNEAR: <code>set_frozen</code> to stop payments, <code>withdraw</code> (and <code>withdraw_near</code> for USDC vaults) to take funds back, <code>close</code> to delete the vault and recover its storage, <code>approve_payment</code> or <code>reject_payment</code> for held payments. <code>get_policy</code>, <code>get_pending</code> and <code>get_recipients</code> are free views.</p>`},
{id:'troubleshooting',title:'Troubleshooting',html:`
<p class="eyebrow">Help</p><h1>Troubleshooting</h1>
<h3>The wallet does not open</h3><p>Allow pop-ups for PayGate, or choose another wallet in the list.</p>
<h3>"The vault name is taken"</h3><p>Vault names are shared by all customers. Choose another.</p>
<h3>"does not exist on mainnet"</h3><p>A payee account must exist on the network before it can be paid. Check the spelling.</p>
<h3>"Budget exceeds the vault balance not already committed"</h3><p>Open jobs reserve their budgets. Cancel jobs you no longer need, or send more NEAR to your vault.</p>
<h3>"The vault is frozen"</h3><p>Unfreeze it in <b>Controls</b>.</p>
<h3>"That transaction is not the expected action"</h3><p>The hash you pasted is not your approval or rejection of this exact payment, or not your vault creation.</p>
<h3>"The transfer failed and the funds returned to the vault"</h3><p>The payee account does not exist. Remove it, add the right account and pay again.</p>`},
{id:'api',title:'HTTP API',html:`
<p class="eyebrow">Reference</p><h1>HTTP API</h1>
<p class="lead">The app uses these endpoints. POST requests need the <code>X-PayGate: 1</code> header. Account endpoints need a session.</p>
<table><thead><tr><th>Endpoint</th><th>Purpose</th></tr></thead><tbody>
<tr><td><code>GET /api/config</code></td><td>Network, factory and wallet</td></tr>
<tr><td><code>POST /api/auth/challenge</code></td><td>A one-time NEP-413 message to sign</td></tr>
<tr><td><code>POST /api/auth/verify</code></td><td><code>{accountId, publicKey, signature, nonce}</code>. Sets a session cookie for 7 days</td></tr>
<tr><td><code>GET /api/state</code></td><td>Your account, vault and workspace. Never any key</td></tr>
<tr><td><code>GET /api/vault</code></td><td>Live balance, limits, daily spend, payees and held payments</td></tr>
<tr><td><code>GET /api/verify</code></td><td>Recomputes your receipt hash chain</td></tr>
<tr><td><code>GET /api/attestation</code></td><td>Fetches and checks the NEAR AI Cloud report</td></tr>
<tr><td><code>POST /api/action</code></td><td>Actions, below</td></tr>
</tbody></table>
<table><thead><tr><th>Action</th><th>Body</th></tr></thead><tbody>
<tr><td><code>vault-create</code></td><td><code>{name, fund, auto, max, daily, payees}</code>. Returns a wallet link</td></tr>
<tr><td><code>vault-confirm</code></td><td><code>{txHash}</code></td></tr>
<tr><td><code>create</code>, <code>deliver</code>, <code>run</code>, <code>pay</code>, <code>cancel</code></td><td>Job actions with <code>{id}</code> and their fields</td></tr>
<tr><td><code>confirm</code></td><td><code>{id, txHash}</code>. Records a verified approval or rejection</td></tr>
<tr><td><code>owner</code></td><td><code>{kind, …}</code>. Wallet link for <code>approve</code>, <code>reject</code>, <code>freeze</code>, <code>limits</code>, <code>payee</code>, <code>withdraw</code></td></tr>
<tr><td><code>ai-key</code>, <code>label</code>, <code>api-key-create</code>, <code>api-key-revoke</code>, <code>delete-account</code></td><td>Settings, payee labels, agent API keys, data deletion</td></tr>
</tbody></table>`}
];
