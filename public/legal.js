// Terms and privacy notice. Starting templates: have them reviewed by a lawyer for your jurisdiction before launch.
export const terms=`<p class="eyebrow">Legal</p><h1>Terms of use</h1><p class="lead">Last updated November 2026. By signing in to PayGate you agree to these terms.</p>
<h2>1. What PayGate is</h2><p>PayGate is software that helps you create and operate a spending vault, a smart contract on the NEAR blockchain that you own, and a restricted agent account that can ask your vault for payments. PayGate is not a bank, payment institution, money transmitter, exchange or custodian.</p>
<h2>2. Your funds stay yours</h2><p>Your vault is owned by your NEAR account. PayGate never holds your owner key and cannot withdraw your funds. Rules such as limits, payees and freezes are enforced by the vault contract. You are responsible for your wallet, its keys and the transactions you sign.</p>
<h2>3. The agent key</h2><p>To let your agent request payments, PayGate stores your agent's restricted key, encrypted. That key can only call <code>request_payment</code> on your vault, within the limits you set. Choose limits you are prepared to lose if the service or the key were compromised.</p>
<h2>4. Payments are final</h2><p>Transactions on NEAR cannot be reversed. Check payees, amounts and deliveries before you pay or approve. PayGate cannot recover funds sent to the wrong account.</p>
<h2>5. Fees</h2><p>PayGate does not charge a fee. You pay NEAR network fees and fund your own vault. Part of the funding pays for the agent account and on-chain storage.</p>
<h2>6. AI deliveries</h2><p>If you add a NEAR AI Cloud key, your briefs are sent to NEAR AI Cloud under your own account and its terms. AI output can be wrong. Review it before you pay.</p>
<h2>7. Acceptable use</h2><p>Do not use PayGate for unlawful payments, sanctions evasion, fraud, or to attack the service or other users. We may stop serving accounts that do. Your vault remains yours and works without PayGate.</p>
<h2>8. No warranty</h2><p>PayGate and its contracts are provided as is. The contracts have not had an independent security audit. To the extent the law allows, the operators of PayGate are not liable for losses arising from your use of the service, the blockchain, wallets or third-party services.</p>
<h2>9. Changes</h2><p>We may update these terms. Material changes are announced in the app. Continued use means you accept the updated terms.</p>`;
export const privacy=`<p class="eyebrow">Legal</p><h1>Privacy notice</h1><p class="lead">Last updated November 2026. What PayGate stores, why, and how to delete it.</p>
<h2>What we store</h2><table><thead><tr><th>Data</th><th>Why</th></tr></thead><tbody>
<tr><td>Your NEAR account name</td><td>To sign you in and link you to your vault</td></tr>
<tr><td>Your vault and agent account names</td><td>To show your balance, limits and payments</td></tr>
<tr><td>Your agent's restricted key, encrypted</td><td>So the agent can request payments from your vault</td></tr>
<tr><td>Your NEAR AI Cloud key, encrypted, if you add one</td><td>So the agent can do work on your behalf</td></tr>
<tr><td>Jobs, briefs, deliveries, payee labels and receipts</td><td>To run your workspace</td></tr>
<tr><td>A session cookie</td><td>To keep you signed in for up to 7 days</td></tr>
</tbody></table>
<h2>What we do not store</h2><p>Your owner key, your wallet password or seed phrase, payment card details, or analytics and advertising trackers. Payments themselves are public on the NEAR blockchain, as all NEAR transactions are.</p>
<h2>Who receives data</h2><ul><li><b>NEAR RPC providers</b> receive requests to read your vault and send your agent's transactions.</li><li><b>NEAR AI Cloud</b> receives briefs only when you run your agent with your key.</li><li><b>NEAR Intents 1Click</b> receives payment amounts to price them. No account details are sent.</li><li><b>Our hosting provider</b> stores the database.</li></ul>
<h2>Deleting your data</h2><p>In <b>Settings</b>, <b>Delete my data</b> removes your workspace, encrypted keys and sessions from PayGate at once. Your vault and its history stay on the blockchain, which nobody can erase, and you can still control the vault from your wallet.</p>`;
