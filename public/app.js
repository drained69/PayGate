import {sections} from './docs.js';
import {terms,privacy} from './legal.js';
let config={},state=null,integrations=[],report=null,vault={configured:false};
let page='Home',filter='All',search='',doc=sections[0].id;
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(n),near=n=>fmt(n)+' NEAR',usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const when=d=>new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),short=h=>h&&h.length>16?h.slice(0,8)+'…'+h.slice(-6):h;
const OPEN=['Working','Review','Awaiting approval'],networkName=()=>({mainnet:'NEAR mainnet',testnet:'NEAR testnet',sandbox:'local NEAR node'})[config.network]||'NEAR';
const accountLink=id=>{const base={mainnet:'https://nearblocks.io/address/',testnet:'https://testnet.nearblocks.io/address/'}[config.network];return base?`<a href="${base}${esc(id)}" target="_blank" rel="noopener">${esc(id)} ↗</a>`:esc(id)};
const ICONS={vault:'<path d="M3 6h18v13H3zM3 10h18M7 14h4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',jobs:'<path d="M4 5h16v14H4zM8 9h8M8 13h5"/>',check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',shield:'<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',doc:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',bolt:'<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',pause:'<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'};
const icon=name=>`<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg></span>`;
async function api(path,body){
 const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-PayGate':'1'},body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({error:'Unexpected response from the server.'}));
 if(r.status===401&&!path.startsWith('auth/')){state=null;page='Home';render();throw new Error('Your session ended. Sign in again.')}
 if(!r.ok)throw new Error(data.error||'Request failed');return data;
}
const ws=()=>state.workspace;
async function refreshVault(){try{vault=state?.vault?await api('vault'):{configured:false}}catch(e){vault={configured:true,error:e.message}}}
async function mutate(action,payload={},errors){
 try{state=await api('action',{action,...payload});await refreshVault();render();return true}
 catch(e){if(errors)errors.textContent=e.message;else toast(e.message);return false}
}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),5000)}
// Wallets open in a pop-up and report back with postMessage, from the wallet's origin or through our callback page.
// The pop-up opens before any network request, so browsers treat it as a direct result of the click.
async function viaWallet(getUrl,op){
 const w=window.open('about:blank','paygate-wallet','width=480,height=700');
 if(!w)throw new Error('Allow pop-ups for PayGate so your wallet can open.');
 try{sessionStorage.setItem('paygate-op',JSON.stringify(op||{}))}catch{}
 let url;try{url=await getUrl()}catch(e){w.close();throw e}
 w.location.href=url;
 const walletOrigin=new URL(config.walletUrl,location.href).origin;
 return new Promise((resolve,reject)=>{
  const done=fn=>{removeEventListener('message',onMessage);clearInterval(timer);try{sessionStorage.removeItem('paygate-op')}catch{};fn()};
  const onMessage=e=>{if(e.origin!==walletOrigin&&e.origin!==location.origin)return;const d=e.data||{};if(!d.status)return;done(()=>d.status==='success'?resolve(d):reject(new Error('The wallet did not sign. Nothing was changed.')))};
  // A wallet often closes itself right after posting its result, so a closed window gets a moment for the message to arrive.
  let closedAt=0;const timer=setInterval(()=>{if(!w.closed)return;closedAt||=Date.now();if(Date.now()-closedAt>1500)done(()=>reject(new Error('The wallet window was closed. Nothing was changed.')))},300);
  addEventListener('message',onMessage);
 });
}
const firstHash=r=>String(r.transactionHashes||'').split(',')[0];
async function owner(kind,payload={},errors){
 try{
  const r=await viaWallet(async()=>(await api('action',{action:'owner',kind,...payload})).url,{kind,id:payload.id});
  await afterWallet({kind,id:payload.id},firstHash(r));
 }catch(e){if(errors)errors.textContent=e.message;else toast(e.message)}
}
// A job payment counts only after the server finds the signed approval on-chain.
async function afterWallet(op,tx){
 if(!tx)return;
 if(op.kind==='approve'||op.kind==='reject'){if(await mutate('confirm',{id:op.id,txHash:tx})){$('#review-dialog')?.close();toast(ws().jobs.find(j=>j.id===op.id)?.status==='Paid'?'Payment approved and sent.':'Payment rejected. The job is back in review.')}}
 else if(op.kind==='vault'){if(await mutate('vault-confirm',{txHash:tx})){page='Overview';render();toast('Your vault is live.')}}
 else{await refreshVault();render();toast('Wallet transaction confirmed. Vault updated.')}
}
async function signIn(){
 const b=$('#signin');if(b)b.disabled=true;
 try{
  let ch;
  const r=await viaWallet(async()=>{ch=await api('auth/challenge',{});return `${ch.walletUrl}/sign-message?${new URLSearchParams({message:ch.message,nonce:ch.nonce,recipient:ch.recipient,callbackUrl:ch.callbackUrl})}`},{kind:'signin'});
  const s=r.signedRequest||r;
  await api('auth/verify',{accountId:s.accountId,publicKey:s.publicKey,signature:s.signature,nonce:ch.nonce});
  page='Overview';await load();toast('Signed in as '+s.accountId+'.');
 }catch(e){toast(e.message)}finally{if(b)b.disabled=false}
}
const committed=()=>ws().jobs.filter(j=>OPEN.includes(j.status)).reduce((s,j)=>s+j.amount,0);
const payeeName=a=>ws().payees[a]?`${esc(ws().payees[a])} <span class="sub">${esc(a)}</span>`:esc(a);
const live=()=>vault.configured&&!vault.error;
const statusClass=s=>({Working:'working',Review:'review','Awaiting approval':'awaiting',Paid:'paid',Cancelled:'cancelled'})[s]||'';
const head=(eyebrow,title,sub,actions='')=>`<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="lead">${sub}</p></div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;
const createButton=()=>live()&&vault.recipients.length?'<button class="primary" data-action="new">Create job</button>':'';
const stat=(label,value,note,extra='')=>`<div class="stat"><div class="label"><span>${label}</span></div><div class="value">${value}</div><div class="note">${note}</div>${extra}</div>`;
const meter=(part,whole)=>{const pct=whole>0?Math.min(100,part/whole*100):0;return `<div class="meter${pct>80?' hot':''}" role="meter" aria-label="Share of daily limit used" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`};
const empty=(ic,title,text='')=>`<div class="table-wrap"><div class="empty">${ic?icon(ic):''}<h3>${title}</h3>${text?`<p>${text}</p>`:''}</div></div>`;
function setupNotice(){
 if(vault.error)return `<div class="notice"><b>Your vault could not be read.</b> ${esc(vault.error)}</div>`;
 if(!state.vault)return '<div class="notice"><b>You have no vault yet.</b> Create one in a single wallet transaction. <button class="text-button" data-page="Overview">Set up your vault →</button></div>';
 if(!vault.recipients?.length)return '<div class="notice"><b>No payees yet.</b> The agent can pay only accounts on your allowlist. Add one in <button class="text-button" data-page="Controls">Controls</button>.</div>';
 if(vault.frozen)return '<div class="notice"><b>Your vault is frozen.</b> No payment can be requested or approved. <button class="text-button" data-page="Controls">Unfreeze in Controls →</button></div>';
 return '';
}
// Public homepage for visitors who are not signed in.
function home(){
 const steps=[['01','Sign in with NEAR','Your wallet signs a message. No password, no email.'],['02','Create your vault','One transaction creates a vault you own and an agent that can only ask it for money.'],['03','Give the agent work','Jobs with a brief, an allowlisted payee and a budget.'],['04','Approve what matters','Small payments go out alone. Larger ones wait for your wallet.']];
 const features=[['shield','Rules on-chain','Payee allowlist, per-payment and daily limits, one payment per job and freeze are enforced by the vault contract, not by our servers.'],['key','Non-custodial','The vault belongs to your NEAR account and has no keys of its own. We never hold your owner key and cannot move your funds.'],['bolt','Restricted agent','The agent key can call one method, request_payment. Transfers, new keys and owner actions are rejected by NEAR itself.'],['check','Wallet approvals','Above your automatic limit, payments wait. Approve or reject them in your wallet; we check every signature on-chain.'],['doc','Evidence you can export','Every payment links to its NEAR transaction and a hash-linked receipt.'],['clock','Freeze in one signature','Stop every new and held payment at once. Withdraw to your account even while frozen.']];
 const faq=[['Can PayGate take my money?','No. Your vault is owned by your account and has no keys. The service holds only the agent key, which can request payments within your limits and only to your payees.'],['What does it cost?','PayGate charges nothing. You fund your own vault with at least 0.4 NEAR: 0.3 NEAR funds the agent account and its gas, and the rest stays in your vault. You also pay normal NEAR network fees.'],['What if the agent is tricked?','The worst a hijacked agent can do is spend up to your automatic limit per payment and your daily limit, only to payees you approved. Our attack demo tries 12 ways to steal funds; all are blocked.'],['Which wallets work?','Sign-in and approvals use MyNearWallet. For other wallets or NEAR CLI, sign the same call and paste the transaction hash.'],['Is it audited?','The contracts have unit tests and an end-to-end attack demo, but no independent audit yet. Start with small limits and a small balance.']];
 return `<div class="hero landing"><p class="eyebrow">Live on ${networkName()}</p><h1>Give your AI agent a budget it can't overspend.</h1><p class="lead">PayGate puts your agent's spending rules in a NEAR smart contract you own. The agent can only ask. The contract decides. You approve anything large in your own wallet.</p><div class="actions"><button class="primary" data-action="signin">Sign in with NEAR</button><button class="secondary" data-doc="how-it-works">How it works</button></div></div>`+
 `<section><div class="grid cols-4">${stat('Custody','None','Your account owns the vault')}${stat('Vault keys','0','Its code can never be swapped')}${stat('Agent methods','1','request_payment, nothing else')}${stat('Attacks blocked','12/12','In the open-source attack demo')}</div></section>`+
 `<section><div class="section-head"><div><p class="eyebrow">Getting started</p><h2>Four steps to a safe agent budget</h2></div></div><div class="grid cols-4 steps">${steps.map(([n,t,d])=>`<div class="step"><span class="num">${n}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}</div></section>`+
 `<section><div class="section-head"><div><p class="eyebrow">Why PayGate</p><h2>Security the agent cannot talk its way around</h2></div></div><div class="grid cols-3">${features.map(([i,t,d])=>`<div class="card">${icon(i)}<h3>${t}</h3><p>${d}</p></div>`).join('')}</div></section>`+
 `<section class="split"><div><div class="section-head"><div><p class="eyebrow">Pricing</p><h2>Free. You fund your own vault.</h2></div></div><div class="panel"><dl class="kv"><dt>PayGate fee</dt><dd>None</dd><dt>Minimum to start</dt><dd>0.4 NEAR, sent to your own accounts</dd><dt>Agent account</dt><dd>0.3 NEAR, pays its storage and gas</dd><dt>Network fees</dt><dd>Standard NEAR fees, usually a fraction of a cent</dd></dl></div></div><div><div class="section-head"><div><p class="eyebrow">Questions</p><h2>FAQ</h2></div></div><div class="rows">${faq.map(([q,a])=>`<details class="faq"><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></div></section>`+
 `<div class="hero cta"><h2>Ready when your agent is.</h2><p class="lead">Create your vault in one transaction. Leave whenever you like: the vault stays yours.</p><div class="actions"><button class="primary" data-action="signin">Sign in with NEAR</button><button class="secondary" data-page="Docs">Read the docs</button></div></div>`;
}
// The first thing a signed-in customer without a vault sees.
function setup(){
 const top=head('Welcome','Create your vault.',`Signed in as <b>${esc(state.account)}</b>. One transaction in your wallet creates a vault you own and an agent that can only ask it for payments.`);
 if(!config.ready)return top+'<div class="notice"><b>Vault creation is not open yet.</b> This PayGate server has no factory configured. Check back soon.</div>';
 if(state.pending)return top+`<div class="panel"><h3>Finishing vault <code>${esc(state.pending.name)}</code></h3><p>If you signed in your wallet, PayGate finds your vault on-chain. Otherwise start again; nothing was spent.</p><div class="dialog-actions"><button class="primary" data-action="vault-check">Check again</button><button class="secondary" data-action="vault-cancel">Start again</button></div><form id="vault-hash-form" class="inline-form" style="margin-top:20px"><label>Or paste the transaction hash<input name="hash" required placeholder="Transaction hash"></label><button class="secondary" type="submit">Confirm</button></form><div id="vault-error" class="dialog-error"></div></div>`;
 return top+`<section class="split"><form id="vault-form" class="panel"><label>Vault name<input name="name" required minlength="2" maxlength="32" pattern="[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]" placeholder="acme" autocomplete="off"><span class="hint">Your vault will be <b id="vault-preview">name.${esc(config.factory)}</b>. Lowercase letters, digits and single dashes.</span></label><label>Initial funding (NEAR)<input name="fund" type="number" min="0.4" step="0.0001" value="1" required><span class="hint" id="fund-hint"></span></label><div class="form-grid three"><label>Paid automatically up to<input name="auto" type="number" min="0.0001" step="0.0001" value="0.1" required></label><label>Maximum per payment<input name="max" type="number" min="0.0001" step="0.0001" value="0.5" required></label><label>Daily limit<input name="daily" type="number" min="0.0001" step="0.0001" value="1" required></label></div><label>Payees<textarea name="payees" placeholder="contractor.near, research.near"></textarea><span class="hint">NEAR accounts the agent may pay, separated by commas or new lines. You can add more later.</span></label><div id="vault-error" class="dialog-error"></div><button class="primary" type="submit">Create vault in wallet</button></form><div><div class="panel"><p class="eyebrow">What happens</p><ul class="checklist">${[['Your wallet opens','You review one call to the PayGate factory with your deposit.'],['Two accounts are created','A vault you own, with no keys, and an agent with one restricted key.'],['Funds land in your vault','0.3 NEAR funds the agent; the rest is spendable in your vault, minus a little storage.'],['You come back here','PayGate checks the transaction on-chain and opens your dashboard.']].map(([t,d],i)=>`<li><span class="tick">${i+1}</span><div><strong>${t}</strong><span>${d}</span></div></li>`).join('')}</ul></div><p class="hint" style="margin-top:14px">By creating a vault you accept the <button class="text-button" data-page="Terms">Terms</button>. Choose an automatic limit you could afford to lose if the agent key were stolen.</p></div></section>`;
}
function stats(){
 const v=live();
 return `<div class="grid cols-4">${stat('Vault balance',v?`${fmt(vault.spendable)}<small>NEAR</small>`:'—',v?'Spendable, read live from '+networkName():'No vault yet')}${stat('Spent today',v?`${fmt(vault.spent)}<small>NEAR</small>`:'—',v?`of ${near(vault.limits.daily)} daily limit`:'Limits are set on-chain',v?meter(vault.spent,vault.limits.daily):'')}${stat('Open jobs',ws().jobs.filter(j=>OPEN.includes(j.status)).length,`${near(committed())} committed`)}${stat('Awaiting approval',ws().jobs.filter(j=>j.status==='Awaiting approval').length,v&&vault.frozen?'Vault is frozen':'Approve in your wallet')}</div>`;
}
function receiptsTable(list,none){
 if(!list.length)return empty('doc','No payments yet',none);
 return `<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Payee</th><th>Amount</th><th>Route</th><th>Transaction</th></tr></thead><tbody>${list.map(r=>`<tr><td data-label="Payment"><strong>${esc(r.job)}</strong><span class="sub">${when(r.date)} · payment #${esc(r.settlement.paymentId)}</span></td><td data-label="Payee">${payeeName(r.payee)}</td><td data-label="Amount" class="num-cell">${near(r.amount)}${r.usdEstimate?`<span class="sub">≈ ${usd(r.usdEstimate.usd)}</span>`:''}</td><td data-label="Route"><span class="status ${r.settlement.route==='auto'?'ok':'awaiting'}">${r.settlement.route==='auto'?'Paid automatically':'Paid with owner approval'}</span></td><td data-label="Transaction" class="mono">${r.settlement.explorer?`<a href="${esc(r.settlement.explorer)}" target="_blank" rel="noopener">${esc(short(r.settlement.txHash))} ↗</a>`:esc(short(r.settlement.txHash))}<span class="sub">${esc(r.settlement.network)}</span></td></tr>`).join('')}</tbody></table></div>`;
}
function checklist(){
 const v=live(),n=v?vault.recipients.length:0,paid=ws().receipts.length;
 const items=[[v,'Vault created',v?`${esc(vault.vault)}`:'One wallet transaction'],[n>0,'Payee allowlisted',v?`${n} payee${n===1?'':'s'} on the allowlist`:'Add the accounts the agent may pay'],[v&&vault.spendable>0,'Vault funded',v?`${near(vault.spendable)} spendable`:'Send NEAR to your vault'],[state.aiKey,'Agent connected to NEAR AI',state.aiKey?'The agent can do the work':'Optional. Add your key in Settings'],[paid>0,'First payment made',paid?`${paid} payment${paid===1?'':'s'} recorded`:'Create a job and pay it']];
 return `<ul class="checklist">${items.map(([done,title,sub])=>`<li class="${done?'done':''}"><span class="tick">${done?'✓':''}</span><div><strong>${title}</strong><span>${sub}</span></div></li>`).join('')}</ul>`;
}
function overview(){
 if(!state.vault)return setup();
 const v=live(),steps=[['01','Create a job','Brief, allowlisted payee and a budget in NEAR.'],['02','Deliver','The agent works on NEAR AI, or you record the delivery.'],['03','Review','Read the work and see its live dollar value.'],['04','Vault decides','Small payments go out. Larger ones wait for your wallet.'],['05','Receipt','Linked to its NEAR transaction and the previous receipt.']];
 const rules=[['bolt','Automatic',v?near(vault.limits.auto):'—','Paid at once, with no approval.'],['shield','Per payment',v?near(vault.limits.max):'—','Hard ceiling, even with your approval.'],['clock','Per day',v?near(vault.limits.daily):'—','Total across all payments in a 24-hour window.']];
 return `<div class="hero"><p class="eyebrow">${v?(vault.frozen?'Vault frozen':'Vault active on '+networkName()):'Vault'}</p><h1>Agent payments, on your terms.</h1><p class="lead">Your agent asks. A NEAR contract it cannot change decides. You approve anything large in your own wallet.</p><div class="actions">${createButton()}<button class="secondary" data-doc="how-it-works">How it works</button></div></div>`+setupNotice()+
 `<section>${stats()}</section>`+
 `<section><div class="section-head"><div><p class="eyebrow">Payment flow</p><h2>How a payment moves</h2></div><button class="ghost" data-doc="how-it-works">Read more →</button></div><div class="grid cols-5 steps">${steps.map(([n,t,d])=>`<div class="step"><span class="num">${n}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}</div></section>`+
 `<section><div class="section-head"><div><p class="eyebrow">Activity</p><h2>Recent payments</h2></div><button class="ghost" data-page="Evidence">All receipts →</button></div>${receiptsTable(ws().receipts.slice(0,5),'Create a job, review the delivery, then pay it from the vault.')}</section>`+
 `<section><div class="section-head"><div><p class="eyebrow">On-chain rules</p><h2>What the agent can do alone</h2></div><button class="ghost" data-page="Controls">Manage →</button></div><div class="grid cols-3">${rules.map(([i,t,val,d])=>`<div class="card">${icon(i)}<p class="eyebrow">${t}</p><h3>${val}</h3><p>${d}</p></div>`).join('')}</div></section>`+
 `<section class="split"><div><div class="section-head"><div><p class="eyebrow">Connections</p><h2>Services</h2></div></div><div class="rows">${integrations.map(i=>`<div class="row-item"><div class="main"><strong>${esc(i.name)}</strong><span class="sub">${esc(i.detail)}</span></div><span class="status ${i.state==='live'?'ok':''}">${i.state==='live'?'Connected':'Off'}</span></div>`).join('')}</div></div><div><div class="section-head"><div><p class="eyebrow">Setup</p><h2>Checklist</h2></div></div><div class="panel">${checklist()}</div></div></section>`;
}
function jobActions(j){
 const id=esc(j.id);
 if(j.status==='Working')return `${state.aiKey?`<button class="text-button" data-action="run" data-id="${id}">Run agent</button>`:''}<button class="text-button" data-action="record" data-id="${id}">Record delivery</button><button class="text-button" data-action="cancel-job" data-id="${id}">Cancel</button>`;
 if(j.status==='Review')return `<button class="text-button" data-action="review" data-id="${id}">Review & pay</button><button class="text-button" data-action="cancel-job" data-id="${id}">Cancel</button>`;
 if(j.status==='Awaiting approval')return `<button class="text-button" data-action="review" data-id="${id}">Review approval</button>`;
 if(j.status==='Paid'){const r=ws().receipts.find(r=>r.jobId===j.id);return r?.settlement.explorer?`<a class="text-button" href="${esc(r.settlement.explorer)}" target="_blank" rel="noopener">View transaction ↗</a>`:'<span class="sub">Paid</span>'}
 return '<span class="sub">—</span>';
}
function jobs(){
 const list=ws().jobs.filter(j=>(filter==='All'||j.status===filter)&&`${j.title} ${j.payee} ${ws().payees[j.payee]||''} ${j.id}`.toLowerCase().includes(search.toLowerCase()));
 const count=s=>ws().jobs.filter(j=>j.status===s).length,paid=ws().jobs.filter(j=>j.status==='Paid').reduce((s,j)=>s+j.amount,0);
 const table=list.length?`<div class="table-wrap"><table><thead><tr><th>Job</th><th>Payee</th><th>Budget</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>${list.map(j=>`<tr><td data-label="Job"><strong>${esc(j.title)}</strong><span class="sub">${esc(j.id)}${j.source?' · '+esc(j.source):''}</span></td><td data-label="Payee">${payeeName(j.payee)}</td><td data-label="Budget" class="num-cell">${near(j.amount)}</td><td data-label="Status"><span class="status ${statusClass(j.status)}">${esc(j.status)}</span></td><td data-label="Created">${when(j.created)}</td><td data-label="Action" class="actions-cell">${jobActions(j)}</td></tr>`).join('')}</tbody></table></div>`:empty('jobs',ws().jobs.length?'No jobs match':'No jobs yet',ws().jobs.length?'Try another filter or search.':'Create a job to give the agent work and a budget.');
 return head('Jobs','Work, reviewed before it is paid.','Create jobs for allowlisted payees, review each delivery, then pay from the vault.',createButton())+setupNotice()+
 `<section><div class="grid cols-4">${stat('In progress',count('Working'),'Waiting for a delivery')}${stat('In review',count('Review'),'Ready for you to pay')}${stat('Awaiting approval',count('Awaiting approval'),'Held by the vault')}${stat('Paid',`${fmt(paid)}<small>NEAR</small>`,`${count('Paid')} job${count('Paid')===1?'':'s'} settled`)}</div></section>`+
 `<section><label class="search">Search jobs<input id="job-search" type="search" placeholder="Search title, payee or job ID" value="${esc(search)}"></label><div class="tabs">${['All','Working','Review','Awaiting approval','Paid','Cancelled'].map(f=>`<button data-filter="${f}" class="${filter===f?'selected':''}">${f}<span class="count">${f==='All'?ws().jobs.length:count(f)}</span></button>`).join('')}</div>${table}</section>`;
}
function treasury(){
 const top=head('Treasury','Every payment, accounted for.','Your vault balance, limits and commitments, read live from NEAR.');
 if(!live())return top+setupNotice();
 const open=ws().jobs.filter(j=>OPEN.includes(j.status)),byPayee={};for(const r of ws().receipts)byPayee[r.payee]=(byPayee[r.payee]||0)+r.amount;
 const hours=Math.max(0,(vault.windowEndsMs-Date.now())/36e5);
 const held=vault.pending.length?`<div class="table-wrap"><table><thead><tr><th>Payment</th><th>Payee</th><th>Amount</th><th>Job reference</th></tr></thead><tbody>${vault.pending.map(p=>`<tr><td data-label="Payment"><strong>Payment #${esc(p.id)}</strong></td><td data-label="Payee">${payeeName(p.recipient)}</td><td data-label="Amount" class="num-cell">${near(p.amount)}</td><td data-label="Job" class="mono">${esc(p.job_id)}</td></tr>`).join('')}</tbody></table></div>`:empty('check','Nothing is waiting','Held payments appear here.');
 const commitments=open.length?`<div class="table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Budget</th></tr></thead><tbody>${open.map(j=>`<tr><td data-label="Job"><strong>${esc(j.title)}</strong><span class="sub">${esc(ws().payees[j.payee]||j.payee)}</span></td><td data-label="Status"><span class="status ${statusClass(j.status)}">${esc(j.status)}</span></td><td data-label="Budget" class="num-cell">${near(j.amount)}</td></tr>`).join('')}</tbody></table></div>`:empty('','No open jobs');
 const payees=Object.keys(byPayee).length?`<div class="rows">${Object.entries(byPayee).sort((a,b)=>b[1]-a[1]).map(([a,n])=>`<div class="row-item"><div class="main"><strong>${esc(ws().payees[a]||a)}</strong><span class="sub">${esc(a)}</span></div><span class="num-cell">${near(n)}</span></div>`).join('')}</div>`:empty('','No payments yet');
 return top+setupNotice()+`<section><div class="grid cols-4">${stat('Vault balance',`${fmt(vault.spendable)}<small>NEAR</small>`,'Spendable after storage')}${stat('Available',`${fmt(Math.max(0,vault.spendable-committed()))}<small>NEAR</small>`,`After ${near(committed())} committed to open jobs`)}${stat('Spent today',`${fmt(vault.spent)}<small>NEAR</small>`,`of ${near(vault.limits.daily)}`,meter(vault.spent,vault.limits.daily))}${stat('Window resets',hours<1?'&lt;1<small>h</small>':`${Math.round(hours)}<small>h</small>`,when(vault.windowEndsMs))}</div></section>`+
 `<section class="split"><div><div class="section-head"><div><p class="eyebrow">Accounts</p><h2>Vault details</h2></div></div><dl class="kv"><dt>Network</dt><dd>${networkName()}</dd><dt>Vault</dt><dd>${accountLink(vault.vault)}</dd><dt>Owner</dt><dd>${accountLink(vault.owner)}</dd><dt>Agent</dt><dd>${accountLink(vault.agent)}</dd><dt>Status</dt><dd>${vault.frozen?'<span class="status bad">Frozen</span>':'<span class="status ok">Active</span>'}</dd><dt>Limits</dt><dd>${near(vault.limits.auto)} automatic · ${near(vault.limits.max)} per payment · ${near(vault.limits.daily)} per day</dd></dl><p>To add funds, send NEAR to <b>${esc(vault.vault)}</b> from any wallet.</p></div><div><div class="section-head"><div><p class="eyebrow">Owner</p><h2>Withdraw</h2></div></div><div class="panel"><p>Sends NEAR from the vault to ${esc(vault.owner)}. Works even while the vault is frozen. Your wallet asks you to confirm.</p><form id="withdraw-form"><label>Amount (NEAR)<input name="amount" type="number" min="0.0001" step="0.0001" max="${vault.spendable}" required></label><button class="primary" type="submit">Withdraw in wallet</button></form><div id="withdraw-error" class="dialog-error"></div></div></div></section>`+
 `<section><div class="section-head"><div><p class="eyebrow">On-chain</p><h2>Waiting on-chain for your approval</h2><p>Payments your vault is holding until you approve them in your wallet.</p></div></div>${held}</section>`+
 `<section class="split"><div><div class="section-head"><div><p class="eyebrow">Commitments</p><h2>Open jobs</h2></div></div>${commitments}</div><div><div class="section-head"><div><p class="eyebrow">Spending</p><h2>Paid by payee</h2></div></div>${payees}</div></section>`;
}
function evidence(){
 const accounts=live()?`<dl class="kv"><dt>Vault</dt><dd>${accountLink(vault.vault)}<span class="hint">Holds the funds. No keys.</span></dd><dt>Agent</dt><dd>${accountLink(vault.agent)}<span class="hint">One key, request_payment only.</span></dd><dt>Owner</dt><dd>${accountLink(vault.owner)}<span class="hint">Your wallet. Approves and configures.</span></dd></dl>`:setupNotice();
 const hashes=ws().receipts.length?`<details class="panel" style="margin-top:20px"><summary class="text-button">Show receipt hashes</summary><dl class="kv" style="margin-top:16px">${ws().receipts.map(r=>`<dt>${esc(r.job)}</dt><dd class="mono">${esc(r.hash)}<br>previous ${esc(r.previousHash||'none')}</dd>`).join('')}</dl></details>`:'';
 return head('Evidence','Evidence you can inspect.','Every payment links to its NEAR transaction, and every receipt to the one before it.','<button class="secondary" data-action="verify">Verify receipt chain</button><button class="secondary" data-action="export">Export JSON</button>')+
 `<div class="notice info">Receipts are hash-linked with SHA-256, so an edit to any receipt breaks the chain. The NEAR transactions are the authoritative record.<b id="verification"></b></div>`+
 `<section><div class="section-head"><div><p class="eyebrow">Receipts</p><h2>Payments</h2></div><span class="sub">${ws().receipts.length} recorded</span></div>${receiptsTable(ws().receipts,'Paid jobs appear here with their transactions.')}${hashes}</section>`+
 `<section class="split"><div><div class="section-head"><div><p class="eyebrow">Private inference</p><h2>NEAR AI Cloud enclave report</h2></div></div><div class="panel"><p>Fetches the public attestation report with a fresh nonce and checks it here: the quote format, the nonce binding, the gateway configuration and the model report.</p><button class="primary" data-action="attest">Check enclave report</button><div id="attestation">${reportHtml()}</div></div></div><div><div class="section-head"><div><p class="eyebrow">Accounts</p><h2>Who can do what</h2></div></div>${accounts}</div></section>`;
}
function controls(){
 const top=head('Controls','Autonomy, within your limits.','These rules live in your vault contract. Each change opens your wallet to sign.');
 if(!live())return top+setupNotice();
 const l=vault.limits;
 const payees=vault.recipients.length?`<div class="table-wrap"><table><thead><tr><th>Account</th><th>Label</th><th>Paid</th><th></th></tr></thead><tbody>${vault.recipients.map(a=>`<tr><td data-label="Account"><strong>${accountLink(a)}</strong></td><td data-label="Label"><form class="label-form inline-form" data-account="${esc(a)}"><label>Label<input name="label" maxlength="60" value="${esc(ws().payees[a]||'')}" placeholder="e.g. Research contractor"></label><button class="secondary small" type="submit">Save label</button></form></td><td data-label="Paid" class="num-cell">${near(ws().receipts.filter(r=>r.payee===a).reduce((s,r)=>s+r.amount,0))}</td><td class="actions-cell"><button class="danger small" data-action="remove-payee" data-account="${esc(a)}">Remove in wallet</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="notice">No payees yet.</div>';
 return top+`<section class="split"><div class="panel" id="vault-panel">${icon(vault.frozen?'pause':'shield')}<h3 style="margin-top:18px">Vault status: ${vault.frozen?'Frozen':'Active'}</h3><p>${vault.frozen?'No payment can be requested or approved until you unfreeze.':'Freezing stops every new and held payment at once. Withdrawals still work.'}</p><div class="dialog-actions"><button class="${vault.frozen?'primary':'danger'}" data-action="freeze">${vault.frozen?'Unfreeze in wallet':'Freeze in wallet'}</button></div></div><div class="panel"><p class="eyebrow">Signing</p><p>Owner changes are signed by <b>${esc(vault.owner)}</b> in your wallet. PayGate then checks the transaction on-chain.</p><button class="ghost" data-doc="approvals">Using another wallet →</button></div></section>`+
 `<section><div class="section-head"><div><p class="eyebrow">Limits</p><h2>Spending limits</h2><p>Amounts in NEAR. They must satisfy automatic ≤ per payment ≤ daily.</p></div><button class="ghost" data-doc="limits">Choosing limits →</button></div><form id="limits-form" class="panel"><div class="form-grid three"><label>Paid automatically up to<input name="auto" type="number" min="0.0001" step="0.0001" value="${l.auto}" required><span class="hint">Sent at once by the agent key.</span></label><label>Maximum per payment<input name="max" type="number" min="0.0001" step="0.0001" value="${l.max}" required><span class="hint">Even with your approval.</span></label><label>Daily limit<input name="daily" type="number" min="0.0001" step="0.0001" value="${l.daily}" required><span class="hint">Across all payments in 24 hours.</span></label></div><button class="primary" type="submit">Update limits in wallet</button><div id="limits-error" class="dialog-error"></div></form></section>`+
 `<section><div class="section-head"><div><p class="eyebrow">Allowlist</p><h2>Payees</h2><p>The agent can pay only these accounts. Labels stay in PayGate.</p></div></div>${payees}<form id="payee-form" class="panel inline-form" style="margin-top:20px"><label>NEAR account<input name="account" placeholder="name.near" required></label><label>Label<input name="label" maxlength="60" placeholder="Optional"></label><button class="primary" type="submit">Add in wallet</button></form><div id="payee-error" class="dialog-error"></div></section>`;
}
function settings(){
 return head('Settings','Your account.','Sign-in, your agent\'s NEAR AI key, and your data.')+
 `<section class="split"><div class="panel">${icon('user')}<h3 style="margin-top:18px">Account</h3><dl class="kv" style="margin-top:14px"><dt>Signed in as</dt><dd>${accountLink(state.account)}</dd><dt>Network</dt><dd>${networkName()}</dd><dt>Vault</dt><dd>${state.vault?accountLink(state.vault.vault):'Not created yet'}</dd><dt>Agent</dt><dd>${state.vault?accountLink(state.vault.agent):'—'}</dd><dt>Member since</dt><dd>${state.createdAt?when(state.createdAt):'—'}</dd></dl><div class="dialog-actions"><button class="secondary" data-action="logout">Sign out</button></div></div>`+
 `<div class="panel">${icon('key')}<h3 style="margin-top:18px">NEAR AI Cloud key</h3><p>${state.aiKey?'Your key is saved, encrypted. The agent can do the work on NEAR AI Cloud, billed to your NEAR AI account.':'Add a key from <a href="https://cloud.near.ai" target="_blank" rel="noopener">cloud.near.ai</a> so the agent can do the work. Without one, record deliveries yourself.'}</p><form id="ai-form"><label>API key<input name="key" type="password" autocomplete="off" placeholder="${state.aiKey?'Replace your saved key':'Paste your API key'}" required></label><button class="primary" type="submit">${state.aiKey?'Replace key':'Save key'}</button>${state.aiKey?' <button type="button" class="danger" data-action="ai-remove">Remove key</button>':''}</form><div id="ai-error" class="dialog-error"></div><p class="hint">Keys are encrypted at rest and never sent back to your browser.</p></div></section>`+
 `<section><div class="panel"><h3>Delete my data</h3><p>Removes your workspace, encrypted keys and sessions from PayGate now. Your vault stays on NEAR and remains yours: you can still freeze, withdraw and change it from your wallet, but PayGate will no longer have the agent key, so you would need a new agent to pay through PayGate again.</p><form id="delete-form" class="inline-form"><label>Type ${esc(state.account)} to confirm<input name="confirm" autocomplete="off" required></label><button class="danger" type="submit">Delete my data</button></form><div id="delete-error" class="dialog-error"></div></div></section>`;
}
function docs(){
 const i=sections.findIndex(s=>s.id===doc),s=sections[i],prev=sections[i-1],next=sections[i+1];
 return `<div class="docs"><aside class="docs-nav" aria-label="Documentation"><p class="eyebrow">Docs</p>${sections.map(x=>`<button data-doc="${x.id}" class="${x.id===doc?'active':''}">${esc(x.title)}</button>`).join('')}</aside><article class="doc">${s.html}<div class="doc-pager">${prev?`<button data-doc="${prev.id}"><span>Previous</span>${esc(prev.title)}</button>`:'<i></i>'}${next?`<button data-doc="${next.id}"><span>Next</span>${esc(next.title)}</button>`:''}</div></article></div>`;
}
const legal=html=>`<article class="doc legal">${html}<p class="hint">Questions? Open an issue on <a href="https://github.com/drained69/PayGate" target="_blank" rel="noopener">GitHub</a>.</p></article>`;
const PUBLIC=['Home','Docs','Terms','Privacy'],APP=['Overview','Jobs','Treasury','Evidence','Controls','Settings','Docs'];
function chrome(){
 const pages=state?APP:['Home','Docs'];
 $('#nav').innerHTML=pages.map(p=>`<button data-page="${p}" class="${p===page?'active':''}">${p}</button>`).join('');
 const ok=live();
 $('#mode').hidden=!state;$('#signin').hidden=Boolean(state);$('#logout').hidden=!state;
 if(state){$('#mode').className='pill'+(ok?(vault.frozen?' warn':' ok'):'');$('#mode-text').textContent=state.vault?(vault.error?'Vault unreachable':vault.frozen?'Vault frozen':state.account):'No vault yet'}
 $('#footer-mode').textContent=config.network==='mainnet'?'Payments move real NEAR':config.network?`Running on ${networkName()}`:'';
}
function render(){
 if(state&&page==='Home')page='Overview';
 if(!state&&!PUBLIC.includes(page))page='Home';
 chrome();
 const view={Home:home,Docs:docs,Terms:()=>legal(terms),Privacy:()=>legal(privacy),Overview:overview,Jobs:jobs,Treasury:treasury,Evidence:evidence,Controls:controls,Settings:settings}[page];
 $('#content').innerHTML=view();
 $('#job-search')?.addEventListener('input',e=>{const pos=e.target.selectionStart;search=e.target.value;render();$('#job-search').focus();$('#job-search').setSelectionRange?.(pos,pos)});
 $('#limits-form')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);owner('limits',{auto:Number(f.get('auto')),max:Number(f.get('max')),daily:Number(f.get('daily'))},$('#limits-error'))});
 $('#withdraw-form')?.addEventListener('submit',e=>{e.preventDefault();owner('withdraw',{amount:Number(new FormData(e.target).get('amount'))},$('#withdraw-error'))});
 $('#payee-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),account=String(f.get('account')).trim().toLowerCase(),label=String(f.get('label')).trim();if(label&&!await mutate('label',{account,label},$('#payee-error')))return;owner('payee',{account,allowed:true},$('#payee-error'))});
 document.querySelectorAll('.label-form').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();if(await mutate('label',{account:form.dataset.account,label:String(new FormData(form).get('label')).trim()}))toast('Label saved.')}));
 const vf=$('#vault-form');
 if(vf){
  const update=()=>{const f=new FormData(vf),fund=Number(f.get('fund'))||0;$('#vault-preview').textContent=`${f.get('name')||'name'}.${config.factory}`;$('#fund-hint').textContent=fund>=0.4?`0.3 NEAR funds the agent. About ${fmt(Math.max(0,fund-0.3-0.005))} NEAR will be spendable in your vault.`:'At least 0.4 NEAR.'};
  vf.addEventListener('input',update);update();
  vf.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(vf),b=vf.querySelector('[type=submit]');b.disabled=true;$('#vault-error').textContent='';
   const payload={name:String(f.get('name')).trim(),fund:Number(f.get('fund')),auto:Number(f.get('auto')),max:Number(f.get('max')),daily:Number(f.get('daily')),payees:String(f.get('payees')).split(/[\s,]+/).filter(Boolean)};
   try{const r=await viaWallet(async()=>(await api('action',{action:'vault-create',...payload})).url,{kind:'vault'});await afterWallet({kind:'vault'},firstHash(r))}
   catch(err){state=await api('state').catch(()=>state);if(state.pending)render();if($('#vault-error'))$('#vault-error').textContent=err.message;else toast(err.message)}
   finally{b.disabled=false}});
 }
 $('#vault-hash-form')?.addEventListener('submit',async e=>{e.preventDefault();if(await mutate('vault-confirm',{txHash:String(new FormData(e.target).get('hash')).trim()},$('#vault-error')))toast('Your vault is live.')});
 $('#ai-form')?.addEventListener('submit',async e=>{e.preventDefault();if(await mutate('ai-key',{key:String(new FormData(e.target).get('key'))},$('#ai-error'))){integrations=await api('integrations').catch(()=>integrations);toast('NEAR AI key saved.')}});
 $('#delete-form')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('action',{action:'delete-account',confirm:String(new FormData(e.target).get('confirm')).trim()});state=null;page='Home';render();toast('Your data was deleted.')}catch(err){$('#delete-error').textContent=err.message}});
}
function dialog(id){let d=$('#'+id);if(!d){d=document.createElement('dialog');d.id=id;document.body.append(d)}return d}
function reviewDialog(j){
 const d=dialog('review-dialog'),auto=live()&&j.amount<=vault.limits.auto,waiting=j.status==='Awaiting approval';
 const actions=waiting?`<p>The agent requested payment #${esc(j.payment.paymentId)}. Your vault holds it until you approve it in your wallet.</p><div class="dialog-actions"><button class="primary" data-action="approve" data-id="${esc(j.id)}">Approve in wallet</button><button class="danger" data-action="reject" data-id="${esc(j.id)}">Reject in wallet</button></div><form id="hash-form" class="inline-form" style="margin-top:22px"><label>Already signed? Transaction hash<input name="hash" placeholder="Paste the transaction hash" required></label><button class="secondary" type="submit">Record</button></form>`:`<p>${auto?'Within the automatic limit: the agent key pays this at once.':'Above the automatic limit: the agent requests it, then you approve in your wallet.'}</p><div class="dialog-actions"><button class="primary" data-action="confirm-pay" data-id="${esc(j.id)}">${auto?'Pay '+near(j.amount):'Request payment'}</button></div>`;
 d.innerHTML=`<div class="dialog-heading"><h2>${waiting?'Approve payment':'Review delivery'}</h2><button class="close" aria-label="Close review">×</button></div><p><b>${esc(j.title)}</b> · ${esc(j.id)}</p><p>${esc(j.brief)}</p><div class="dialog-meta"><div><span>Amount</span><b>${near(j.amount)}</b></div><div><span>Payee</span><b>${esc(ws().payees[j.payee]||j.payee)}</b></div><div><span>Value</span><b id="quote">${j.quote?`≈ ${usd(j.quote.usd)}`:waiting?'—':'Pricing…'}</b></div></div><p class="eyebrow">${j.inference?`Written on NEAR AI Cloud · ${esc(j.inference.model)}`:esc(j.source||'Delivery')}</p><div class="notice info delivery">${esc(j.deliverable||'')}</div>${actions}<div id="review-error" class="dialog-error"></div>`;
 d.querySelector('.close').onclick=()=>d.close();
 d.querySelector('#hash-form')?.addEventListener('submit',async e=>{e.preventDefault();if(await mutate('confirm',{id:j.id,txHash:String(new FormData(e.target).get('hash')).trim()},$('#review-error'))){d.close();toast('Payment recorded from the chain.')}});
 if(!d.open)d.showModal();
 if(!j.quote&&!waiting)api('action',{action:'quote',id:j.id}).then(s=>{state=s;const q=ws().jobs.find(x=>x.id===j.id)?.quote;if(q&&$('#quote'))$('#quote').textContent=`≈ ${usd(q.usd)}`}).catch(()=>{if($('#quote'))$('#quote').textContent='Unavailable'});
}
function recordDialog(j){
 const d=dialog('record-dialog');
 d.innerHTML=`<form id="record-form"><div class="dialog-heading"><h2>Record delivery</h2><button type="button" class="close" aria-label="Close">×</button></div><p>Describe or link what ${esc(ws().payees[j.payee]||j.payee)} delivered for <b>${esc(j.title)}</b>. It is stored with the receipt.</p><label>Delivery<textarea name="text" maxlength="8000" required placeholder="Summary, link to the work, invoice number…"></textarea></label><div id="record-error" class="dialog-error"></div><div class="dialog-actions"><button class="primary" type="submit">Save delivery</button></div></form>`;
 d.querySelector('.close').onclick=()=>d.close();
 d.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(await mutate('deliver',{id:j.id,text:new FormData(e.target).get('text')},$('#record-error'))){d.close();toast('Delivery recorded. Ready for review.')}});
 d.showModal();
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||(b.form&&b.type==='submit'))return;
 if(b.dataset.doc){page='Docs';doc=b.dataset.doc;render();scrollTo(0,0);return}
 if(b.dataset.page){e.preventDefault();page=b.dataset.page;filter='All';search='';render();scrollTo(0,0);return}
 if(b.dataset.filter){filter=b.dataset.filter;render();return}
 const action=b.dataset.action,j=state?.workspace?.jobs.find(j=>j.id===b.dataset.id);
 if(action==='signin')return signIn();
 if(action==='new'){$('#form-error').textContent='';$('#payee-select').innerHTML=vault.recipients.map(a=>`<option value="${esc(a)}">${esc(ws().payees[a]?ws().payees[a]+' · '+a:a)}</option>`).join('');$('#budget-hint').textContent=`Up to ${near(vault.limits.max)} per payment · ${near(Math.max(0,vault.spendable-committed()))} available`;$('#job-dialog').showModal()}
 if(b.classList.contains('close')&&b.closest('#job-dialog'))$('#job-dialog').close();
 if(action==='logout'){await api('logout',{}).catch(()=>{});state=null;vault={configured:false};page='Home';render()}
 if(action==='vault-cancel'){await mutate('vault-cancel')}
 if(action==='vault-check'){b.disabled=true;if(await mutate('vault-confirm',{},$('#vault-error'))){page='Overview';render();toast('Your vault is live.')}b.disabled=false}
 if(action==='ai-remove'){if(await mutate('ai-key',{key:''})){integrations=await api('integrations').catch(()=>integrations);toast('NEAR AI key removed.')}}
 if(action==='verify'){try{const r=await api('verify');$('#verification').textContent=r.valid?` All ${r.count} receipt hashes and links match.`:' Receipt integrity check failed.'}catch(err){toast(err.message)}}
 if(action==='attest'){b.disabled=true;$('#attestation').innerHTML='<p>Fetching report…</p>';try{report=await api('attestation')}catch(err){report={error:err.message}}b.disabled=false;$('#attestation').innerHTML=reportHtml()}
 if(action==='export'){const blob=new Blob([JSON.stringify({account:state.account,vault:vault.vault||null,network:config.network,receipts:ws().receipts},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='paygate-receipts.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 if(action==='run'&&j){b.disabled=true;b.textContent='Agent working…';await mutate('run',{id:j.id});b.disabled=false}
 if(action==='record'&&j)recordDialog(j);
 if(action==='review'&&j)reviewDialog(j);
 if(action==='cancel-job'&&j&&confirm(`Cancel "${j.title}"? Its budget is released.`)){if(await mutate('cancel',{id:j.id}))toast('Job cancelled. Budget released.')}
 if(action==='confirm-pay'){b.disabled=true;$('#review-error').textContent='';const ok=await mutate('pay',{id:b.dataset.id},$('#review-error'));b.disabled=false;if(ok){const now=ws().jobs.find(x=>x.id===b.dataset.id);if(now.status==='Paid'){$('#review-dialog').close();toast('Paid from the vault.')}else reviewDialog(now)}}
 if(action==='approve'||action==='reject')owner(action,{id:b.dataset.id},$('#review-error'));
 if(action==='freeze')owner('freeze',{frozen:!vault.frozen});
 if(action==='remove-payee'&&confirm(`Remove ${b.dataset.account} from the allowlist?`))owner('payee',{account:b.dataset.account,allowed:false});
});
function reportHtml(){
 if(!report)return '';if(report.error)return `<p class="dialog-error">${esc(report.error)}</p>`;
 return `<ul class="proof-list">${report.checks.map(c=>`<li class="${c.pass?'':'fail'}">${esc(c.label)}</li>`).join('')}</ul><dl class="kv" style="margin-top:18px"><dt>Model</dt><dd>${esc(report.model)}</dd><dt>TCB · GPU</dt><dd>${esc(report.tcbStatus)} · ${esc(report.gpuVerdict)}</dd><dt>Signing address</dt><dd class="mono">${esc(report.signingAddress)}</dd><dt>Quote SHA-256</dt><dd class="mono">${esc(report.quoteSha256)}</dd></dl><p>Intel's signature on the quote is not checked here. Use the NEAR AI Verification Center for full verification.</p>`;
}
$('#job-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.target),button=e.target.querySelector('[type=submit]');button.disabled=true;$('#form-error').textContent='';
 const ok=await mutate('create',{title:f.get('title'),brief:f.get('brief'),payee:f.get('payee'),amount:Number(f.get('amount'))},$('#form-error'));
 button.disabled=false;if(ok){$('#job-dialog').close();e.target.reset();toast('Job created. Budget reserved.')}
});
async function load(){
 [state,integrations]=await Promise.all([api('state'),api('integrations')]);await refreshVault();render();
 // A wallet that could not use a pop-up may have returned in this tab instead.
 let saved,op;try{saved=JSON.parse(sessionStorage.getItem('paygate-wallet')||'null');op=JSON.parse(sessionStorage.getItem('paygate-op')||'null');sessionStorage.removeItem('paygate-wallet');sessionStorage.removeItem('paygate-op')}catch{}
 if(saved?.status==='success'&&op?.kind&&op.kind!=='signin')await afterWallet(op,firstHash(saved));
}
try{config=await api('config');const s=await api('session');if(s.account)await load();else render()}catch(e){$('#content').innerHTML=`<div class="notice">Unable to reach PayGate: ${esc(e.message)}</div>`}
