// In-app documentation. Static text, so it renders before sign-in too.
export const sections=[
{id:'introduction',title:'Introduction',html:`
<p class="eyebrow">Docs</p><h1>What PayGate is</h1>
<p class="lead">PayGate lets a company give an AI agent a budget without giving it control of the money.</p>
<p>An agent that can pay for things can be tricked into paying the wrong person. Text hidden in a document, an email or a job brief can instruct it to send funds. Rules written into the agent's prompt or into app code stop working the moment the agent is compromised.</p>
<p>PayGate moves the rules somewhere the agent cannot reach: a smart contract on NEAR. The agent's only key can do one thing, ask the contract for a payment. The contract decides.</p>
<h2>The four parts</h2>
<table><thead><tr><th>Part</th><th>Held by</th><th>What it can do</th></tr></thead><tbody>
<tr><td><b>Vault contract</b></td><td>Nobody. It has no keys after setup</td><td>Holds the NEAR. Pays only allowlisted payees, within per-payment and daily limits. Holds back anything above the automatic limit until the owner approves.</td></tr>
<tr><td><b>Agent key</b></td><td>The PayGate server</td><td>Calls <code>request_payment</code> on the vault, and nothing else. It cannot transfer, add keys or call owner methods.</td></tr>
<tr><td><b>Owner account</b></td><td>Your NEAR wallet</td><td>Approves large payments, freezes the vault, changes limits and payees, withdraws. The server never holds this key.</td></tr>
<tr><td><b>PayGate app</b></td><td>You, behind a password</td><td>Jobs, deliveries, reviews, receipts and evidence. Every owner action opens your wallet.</td></tr>
</tbody></table>
<h2>What is real</h2>
<ul><li>Payments are real NEAR sent to the payee's account on the network your vault is on.</li><li>Balances, limits, daily spending and pending payments are read live from the contract.</li><li>Dollar values come from live NEAR Intents 1Click quotes. No swap is made.</li><li>Agent work runs on NEAR AI Cloud when an API key is set. Otherwise you record what the payee delivered.</li></ul>`},
{id:'how-it-works',title:'How a payment moves',html:`
<p class="eyebrow">Concepts</p><h1>How a payment moves</h1>
<p class="lead">Every payment follows the same path, and each step is checked by something the agent does not control.</p>
<ol>
<li><b>Create a job.</b> You give it a brief, a payee from the allowlist and a budget in NEAR. PayGate checks the budget against the vault's per-payment limit and against the balance not already committed to other open jobs.</li>
<li><b>Deliver.</b> The agent does the work on NEAR AI Cloud, or you record what the payee delivered: a summary, a link, an invoice number.</li>
<li><b>Review.</b> You read the delivery. The review shows the payee, the amount and a live dollar value.</li>
<li><b>Request.</b> When you pay, the server calls <code>request_payment</code> with the agent key. The contract checks that the vault is not frozen, that the payee is allowlisted, that the amount is within the per-payment and daily limits, and that this job has not been paid before.</li>
<li><b>Send or hold.</b> At or below the automatic limit, the contract sends the NEAR at once. Above it, the contract holds the payment and waits for the owner.</li>
<li><b>Approve.</b> For a held payment, PayGate opens your wallet with an <code>approve_payment</code> call. After you sign, the app fetches the transaction from NEAR and checks that the owner approved this exact payment before marking the job paid.</li>
<li><b>Receipt.</b> A receipt records the transaction, payment id, route and quote. Each receipt includes the SHA-256 hash of the one before it.</li>
</ol>
<h2>Job statuses</h2>
<table><thead><tr><th>Status</th><th>Meaning</th></tr></thead><tbody>
<tr><td><span class="status working">Working</span></td><td>Created, waiting for a delivery. Can be cancelled.</td></tr>
<tr><td><span class="status review">Review</span></td><td>Delivered and waiting for you to review and pay. Can be cancelled.</td></tr>
<tr><td><span class="status awaiting">Awaiting approval</span></td><td>The agent requested payment and the vault is holding it for your wallet approval.</td></tr>
<tr><td><span class="status paid">Paid</span></td><td>The NEAR transfer succeeded and a receipt was recorded.</td></tr>
<tr><td><span class="status cancelled">Cancelled</span></td><td>Closed without payment. Its budget is released.</td></tr>
</tbody></table>`},
{id:'quickstart',title:'Quickstart',html:`
<p class="eyebrow">Get started</p><h1>Quickstart</h1>
<p class="lead">Try PayGate on a local NEAR node in two minutes, with no account and no funds.</p>
<pre><code>npm install
npm run dev:chain</code></pre>
<p>Open <code>http://localhost:3000</code>. The command starts a local NEAR node, deploys a vault with one payee and starts the app. A local node has no wallet, so a built-in local wallet signs owner actions. It works only on a local node.</p>
<h2>Watch an attack fail</h2>
<pre><code>npm run demo:attack</code></pre>
<p>This plays an agent hijacked by a prompt injection, using its real key. It tries 12 ways to steal the funds, and each one is blocked by a named rule. The attacker receives 0 NEAR.</p>
<h2>Your first payment</h2>
<ol><li>Open <b>Jobs</b> and select <b>Create job</b>. Choose the payee and a budget of 0.05 NEAR.</li><li>Select <b>Record delivery</b> and describe what was delivered, or <b>Run agent</b> if NEAR AI is connected.</li><li>Select <b>Review &amp; pay</b>, then <b>Pay 0.05 NEAR</b>. It is under the automatic limit, so it is sent at once.</li><li>Open <b>Evidence</b> to see the receipt and its transaction.</li></ol>`},
{id:'approvals',title:'Wallet approvals',html:`
<p class="eyebrow">Using PayGate</p><h1>Approving with your wallet</h1>
<p class="lead">The owner key never leaves your wallet. PayGate prepares each owner action, and your wallet signs it.</p>
<h2>What needs your wallet</h2>
<table><thead><tr><th>Action</th><th>Contract method</th></tr></thead><tbody>
<tr><td>Approve a held payment</td><td><code>approve_payment</code></td></tr><tr><td>Reject a held payment</td><td><code>reject_payment</code></td></tr><tr><td>Freeze or unfreeze</td><td><code>set_frozen</code></td></tr><tr><td>Change limits</td><td><code>set_limits</code></td></tr><tr><td>Add or remove a payee</td><td><code>set_recipient</code></td></tr><tr><td>Withdraw to the owner</td><td><code>withdraw</code></td></tr>
</tbody></table>
<p>Each call attaches one yoctoNEAR. A function-call key cannot send a deposit, so even a stolen agent key could not call these methods.</p>
<h2>How the redirect works</h2>
<ol><li>PayGate builds the unsigned transaction and opens MyNearWallet's signing page.</li><li>You check the call and sign it with your own key.</li><li>The wallet returns you to PayGate with the transaction hash.</li><li>PayGate fetches that transaction from NEAR and checks who signed it, which contract it called, the method, the arguments and that it succeeded. A hash that does not match is refused.</li></ol>
<h2>Using another wallet or the CLI</h2>
<p>Sign the same call anywhere, then paste the transaction hash into the payment's review dialog. With NEAR CLI, approving payment 7 looks like this:</p>
<pre><code>near contract call-function as-transaction paygate-vault.you.near approve_payment \\
  json-args '{"id":7}' prepaid-gas '60 Tgas' attached-deposit '1 yoctoNEAR' \\
  sign-as you.near network-config mainnet sign-with-keychain send</code></pre>`},
{id:'limits',title:'Limits and freeze',html:`
<p class="eyebrow">Using PayGate</p><h1>Limits and freeze</h1>
<p class="lead">Three limits decide how much the agent can move without you.</p>
<table><thead><tr><th>Limit</th><th>Effect</th></tr></thead><tbody>
<tr><td><b>Automatic</b></td><td>Payments at or below this go out at once.</td></tr>
<tr><td><b>Maximum per payment</b></td><td>No single payment can exceed this, even with your approval.</td></tr>
<tr><td><b>Daily</b></td><td>The total of all payments in a 24-hour window. Applies to approved payments too.</td></tr>
</tbody></table>
<p>The contract requires automatic ≤ maximum ≤ daily. Lowering a limit also applies to payments that are already held.</p>
<h2>Choosing values</h2>
<p>Set the automatic limit to what you could afford to lose in a day if the server were breached: that is the most a stolen agent key can send without you. Keep the daily limit close to your real spending.</p>
<h2>Freeze</h2>
<p>Freezing stops every new request and every approval at once, including payments already held. Withdrawals still work while frozen, so you can always move funds out.</p>
<h2>Windows</h2>
<p>The daily limit uses fixed 24-hour windows that start with the first payment after the previous window ends. Spending at the end of one window and the start of the next can reach twice the daily limit in a short time.</p>`},
{id:'payees',title:'Payees',html:`
<p class="eyebrow">Using PayGate</p><h1>Payees</h1>
<p class="lead">The vault can only pay accounts on its allowlist.</p>
<p>Add a payee in <b>Controls</b> with its NEAR account, such as <code>contractor.near</code>. Your wallet signs <code>set_recipient</code>. Labels such as "Research contractor" are stored in PayGate only and do not touch the chain.</p>
<p>Removing a payee also blocks payments to it that are already held. If a payee account does not exist or is deleted, the transfer fails, the NEAR returns to the vault and the daily spend is restored. PayGate reports the failure instead of recording a payment.</p>`},
{id:'evidence',title:'Receipts and evidence',html:`
<p class="eyebrow">Using PayGate</p><h1>Receipts and evidence</h1>
<p class="lead">The NEAR transactions are the authoritative record. Receipts make them easy to read and export.</p>
<h2>Receipts</h2>
<p>Each receipt holds the job, payee, amount, route, payment id, transaction hash and the dollar quote at review time. It also holds the hash of the previous receipt, so an edit anywhere breaks the chain. <b>Verify receipt chain</b> recomputes every hash. <b>Export JSON</b> downloads them all.</p>
<p>Receipt hashes detect edits against a hash you kept. They are not signatures. Someone with disk access could rewrite the whole chain, which is why each receipt links to its transaction.</p>
<h2>Enclave report</h2>
<p><b>Check enclave report</b> fetches NEAR AI Cloud's public attestation report with a fresh nonce. The app checks that it is an Intel TDX v4 quote, that it is bound to this nonce, that it matches the gateway configuration in the report, and that the model report answers the same nonce. It does not verify Intel's signature; use the NEAR AI Verification Center for that.</p>`},
{id:'deploy',title:'Deploy to mainnet',html:`
<p class="eyebrow">Operate</p><h1>Deploy to mainnet</h1>
<p class="lead">You deploy the vault from your own machine. Your owner key is used for that one run and never saved.</p>
<h2>1. Check the plan</h2>
<p>You need a mainnet account holding the vault funding plus about 0.4 NEAR. About 2.04 NEAR of the funding stays locked to store the contract code. Without the confirmation flag, the script only checks everything and prints a summary.</p>
<pre><code>NEAR_NETWORK=mainnet NEAR_OWNER_ACCOUNT=you.near NEAR_OWNER_KEY=ed25519:... \\
VAULT_FUND=3 LIMIT_AUTO=0.1 LIMIT_MAX=1 LIMIT_DAILY=2 PAYEES=contractor.near \\
npm run vault:deploy</code></pre>
<h2>2. Deploy</h2>
<p>Run the same command with <code>-- --yes-mainnet</code> at the end. The script:</p>
<ul><li>creates <code>paygate-vault.you.near</code> and <code>paygate-agent.you.near</code>;</li><li>deploys and initializes the contract;</li><li>gives the agent its single restricted key;</li><li>adds your payees;</li><li>removes the vault's own key.</li></ul>
<p>It writes <code>data/chain.json</code>, which includes the agent's restricted key. Keep it private.</p>
<h2>3. Host it</h2>
<pre><code>railway init --name paygate
railway add --service paygate
railway domain --service paygate
railway service link paygate
railway volume add --mount-path /data
railway variables --service paygate --set PUBLIC_URL=https://your-domain.up.railway.app \\
  --set DATA_DIR=/data --set PAYGATE_PASSWORD='a long random password'
railway variables --service paygate --set "PAYGATE_CHAIN_JSON=$(cat data/chain.json)"
railway up --service paygate</code></pre>
<p>Then run the read-only deployment check. It signs in and reads, but never pays or changes anything:</p>
<pre><code>PAYGATE_PASSWORD='…' npm run check:deployed -- https://your-domain.up.railway.app</code></pre>
<h2>Configuration</h2>
<table><thead><tr><th>Variable</th><th>Purpose</th></tr></thead><tbody>
<tr><td><code>PAYGATE_PASSWORD</code></td><td>Owner password. Required when <code>PUBLIC_URL</code> is set, at least 12 characters.</td></tr>
<tr><td><code>PUBLIC_URL</code></td><td>Public https address. The server then listens on all interfaces and requires the password.</td></tr>
<tr><td><code>DATA_DIR</code></td><td>Where the workspace is saved. Use a volume.</td></tr>
<tr><td><code>PAYGATE_CHAIN_JSON</code></td><td>Vault settings written by the deploy script.</td></tr>
<tr><td><code>NEAR_AI_API_KEY</code></td><td>Optional. Lets the agent do the work on NEAR AI Cloud.</td></tr>
</tbody></table>`},
{id:'security',title:'Security model',html:`
<p class="eyebrow">Trust</p><h1>Security model</h1>
<p class="lead">What each rule stops, and what risk remains.</p>
<table><thead><tr><th>Rule</th><th>Enforced by</th><th>Stops</th></tr></thead><tbody>
<tr><td>Agent key can only call <code>request_payment</code></td><td>NEAR access key</td><td>Direct transfers, new keys, other contracts, owner methods</td></tr>
<tr><td>Payee allowlist</td><td>Contract</td><td>Paying an attacker</td></tr>
<tr><td>Per-payment and daily limits</td><td>Contract</td><td>Large or repeated theft</td></tr>
<tr><td>Approval above the automatic limit</td><td>Contract and your wallet</td><td>Large payments nobody reviewed</td></tr>
<tr><td>Each job paid once</td><td>Contract</td><td>Replayed payments</td></tr>
<tr><td>Freeze, including held payments</td><td>Contract</td><td>Everything, until you resume</td></tr>
<tr><td>Owner key stays in your wallet</td><td>Deployment</td><td>A server breach taking the vault</td></tr>
<tr><td>Approvals checked on-chain</td><td>Server</td><td>Forged callbacks recording payments that never happened</td></tr>
</tbody></table>
<p>The vault has no keys, so its code cannot be replaced, and owner methods need a deposit that a function-call key cannot attach.</p>
<h2>Remaining risks</h2>
<ul><li>Someone who takes over the server can use the agent key to spend up to the automatic limit per payment and the daily limit, only to allowlisted payees.</li><li>A hijacked agent can use its 50 daily requests or fill the queue of 20 held payments, which blocks payments until you reject them.</li><li>When the agent's gas allowance runs out, add a new restricted key or use <code>set_agent</code>.</li><li>The contract has not had an independent audit. Start with small limits and a small balance.</li></ul>`},
{id:'troubleshooting',title:'Troubleshooting',html:`
<p class="eyebrow">Help</p><h1>Troubleshooting</h1>
<h3>"Budget exceeds the vault balance not already committed"</h3><p>Open jobs reserve their budgets. Cancel jobs you no longer need, or send more NEAR to the vault account.</p>
<h3>"The vault is frozen"</h3><p>Unfreeze it in <b>Controls</b>. Your wallet signs the change.</p>
<h3>"That transaction is not the expected owner action"</h3><p>The hash you pasted is not your approval or rejection of this exact payment. Check the payment number in the review dialog.</p>
<h3>"The transfer failed and the funds returned to the vault"</h3><p>The payee account does not exist on this network. Remove it, add the correct account, and pay again.</p>
<h3>"A pending payment for this job has different terms"</h3><p>Something requested a payment for this job with a different payee or amount. Reject it from your wallet; the job can then be paid normally.</p>
<h3>The server will not start</h3><p>Hosted servers need <code>PAYGATE_PASSWORD</code> of at least 12 characters and a writable <code>DATA_DIR</code>. The server also refuses to start if <code>NEAR_OWNER_KEY</code> is set with a testnet or mainnet vault.</p>`},
{id:'api',title:'HTTP API',html:`
<p class="eyebrow">Reference</p><h1>HTTP API</h1>
<p class="lead">The app uses these endpoints. All need a session when a password is set. POST requests need the <code>X-PayGate: 1</code> header.</p>
<table><thead><tr><th>Endpoint</th><th>Purpose</th></tr></thead><tbody>
<tr><td><code>POST /api/login</code></td><td>Sign in with <code>{password}</code>. Sets an HttpOnly session cookie.</td></tr>
<tr><td><code>GET /api/state</code></td><td>Jobs, receipts and payee labels.</td></tr>
<tr><td><code>GET /api/vault</code></td><td>Live balance, limits, daily spend, payees and held payments.</td></tr>
<tr><td><code>GET /api/verify</code></td><td>Recomputes the receipt hash chain.</td></tr>
<tr><td><code>GET /api/attestation</code></td><td>Fetches and checks the NEAR AI Cloud report.</td></tr>
<tr><td><code>POST /api/action</code></td><td>Job actions, below.</td></tr>
</tbody></table>
<h2>Actions</h2>
<table><thead><tr><th>Action</th><th>Body</th></tr></thead><tbody>
<tr><td><code>create</code></td><td><code>{title, brief, payee, amount}</code></td></tr>
<tr><td><code>deliver</code></td><td><code>{id, text}</code></td></tr>
<tr><td><code>run</code></td><td><code>{id}</code>. Needs <code>NEAR_AI_API_KEY</code>.</td></tr>
<tr><td><code>pay</code></td><td><code>{id}</code>. Sends or holds the payment.</td></tr>
<tr><td><code>confirm</code></td><td><code>{id, txHash}</code>. Records a signed approval or rejection.</td></tr>
<tr><td><code>owner</code></td><td><code>{kind, …}</code>. Returns a wallet link. Kinds: <code>approve</code>, <code>reject</code>, <code>freeze</code>, <code>limits</code>, <code>payee</code>, <code>withdraw</code>.</td></tr>
<tr><td><code>cancel</code>, <code>label</code></td><td><code>{id}</code>, <code>{account, label}</code></td></tr>
</tbody></table>`}
];
