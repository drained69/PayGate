let state,integrations=[],report=null,vault={configured:false},session={};
let page='Overview',filter='All',search='';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const near=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(n)+' NEAR',usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const OPEN=['Working','Review','Awaiting approval'],networkName=()=>({mainnet:'NEAR mainnet',testnet:'NEAR testnet',sandbox:'local NEAR node'})[vault.network]||'NEAR';
async function api(path,body){
 const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-PayGate':'1'},body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({error:'Unexpected response from the server.'}));
 if(r.status===401&&path!=='login'){session.authenticated=false;renderLogin();throw new Error('Sign in first.')}
 if(!r.ok)throw new Error(data.error||'Request failed');return data;
}
async function refreshVault(){try{vault=await api('vault')}catch(e){vault={...vault,error:e.message}}}
async function mutate(action,payload={},errors){
 try{state=await api('action',{action,...payload});await refreshVault();render();return true}
 catch(e){if(errors)errors.textContent=e.message;else toast(e.message);return false}
}
// Owner actions leave the app: the wallet signs them, then sends the owner back here with the transaction hash.
async function owner(kind,payload={},errors){
 try{const {url}=await api('action',{action:'owner',kind,...payload});location.assign(url)}
 catch(e){if(errors)errors.textContent=e.message;else toast(e.message)}
}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),5000)}
const committed=()=>state.jobs.filter(j=>OPEN.includes(j.status)).reduce((s,j)=>s+j.amount,0);
const payeeName=a=>state.payees[a]?`${esc(state.payees[a])} <small>${esc(a)}</small>`:esc(a);
const inference=()=>integrations.find(i=>i.name==='NEAR AI Cloud inference')?.state==='live';
const live=()=>vault.configured&&!vault.error;
function heading(title,sub,action=''){return `<div class="heading"><div><p class="eyebrow">AGENT PAYMENTS</p><h1>${title}</h1><p>${sub}</p></div>${action}</div>`}
const createButton=()=>live()&&vault.recipients.length?'<button class="primary" data-action="new">＋ Create job</button>':'';
function setupNotice(){
 if(vault.error)return `<div class="notice">The vault could not be read: ${esc(vault.error)}</div>`;
 if(!vault.configured)return '<div class="notice"><b>No vault is connected.</b> Payments are off until you deploy one. Run <code>npm run vault:deploy</code>, then restart PayGate with the settings it writes. The README covers mainnet step by step.</div>';
 if(!vault.recipients.length)return '<div class="notice"><b>No payees yet.</b> The agent can pay only accounts on the vault allowlist. Add one in <button class="text-button" data-page="Controls">Controls</button>.</div>';
 return '';
}
function stats(){
 const v=live();
 return `<div class="stats"><article><p>Vault balance <span>↗</span></p><h2>${v?near(vault.spendable):'—'}</h2><small><i></i> ${v?'Spendable, read from '+networkName():'No vault connected'}</small></article><article><p>Spent today <span>◷</span></p><h2>${v?near(vault.spent):'—'}</h2><small>${v?'of '+near(vault.limits.daily)+' daily limit':'Limits are set on-chain'}</small></article><article><p>Open jobs <span>◫</span></p><h2>${state.jobs.filter(j=>OPEN.includes(j.status)).length}<em>jobs</em></h2><small>${near(committed())} committed</small></article><article><p>Awaiting approval <span>✓</span></p><h2>${state.jobs.filter(j=>j.status==='Awaiting approval').length}</h2><small>${v&&vault.frozen?'Vault is frozen':'Approve in your wallet'}</small></article></div>`;
}
function receiptRow(r){return `<div class="receipt"><div><strong>${esc(r.job)}</strong><small>${near(r.amount)} to ${payeeName(r.payee)} · ${r.settlement.route==='auto'?'paid automatically':'paid with owner approval'} · ${new Date(r.date).toLocaleString()}</small><code>${r.settlement.explorer?`<a href="${esc(r.settlement.explorer)}" target="_blank" rel="noopener">Transaction ${esc(r.settlement.txHash)}</a>`:'Transaction '+esc(r.settlement.txHash)} · payment #${esc(r.settlement.paymentId)} · ${esc(r.settlement.network)}${r.usdEstimate?` · about ${usd(r.usdEstimate.usd)} when quoted`:''}<br>SHA-256 ${esc(r.hash)}</code></div><span class="status">On-chain · ${esc(r.settlement.network)}</span></div>`}
function overview(){
 const recent=state.receipts.slice(0,5);
 return heading('Agent payments, on your terms.','Your agent asks. The vault decides. You approve anything large.',createButton())+setupNotice()+stats()+`<div class="middle"><section class="panel padded"><h3>Recent payments</h3>${recent.length?recent.map(receiptRow).join(''):'<p>No payments yet. Create a job, review the delivery, then pay it from the vault.</p>'}</section><section class="proof-card"><div class="proof-icon">◇</div><p class="eyebrow">ON-CHAIN RULES</p><h2>${live()?(vault.frozen?'Vault frozen':'Vault active'):'Not connected'}</h2><p>${live()?`Paid automatically up to ${near(vault.limits.auto)}. Above that, up to ${near(vault.limits.max)} with your wallet approval. Never more than ${near(vault.limits.daily)} a day.`:'Deploy a vault so the agent can pay within limits it cannot change.'}</p><button data-page="Controls">Review controls →</button></section></div><div class="integration-strip">${integrations.map(i=>`<div><b>${esc(i.name)}</b><small class="${i.state==='live'?'live':''}">${i.state==='live'?'● Connected':'○ Off'} · ${esc(i.detail)}</small></div>`).join('')}</div>`;
}
function jobActions(j){
 const id=esc(j.id);
 if(j.status==='Working')return `${inference()?`<button class="text-button" data-action="run" data-id="${id}">Run agent</button> · `:''}<button class="text-button" data-action="record" data-id="${id}">Record delivery</button> · <button class="text-button" data-action="cancel-job" data-id="${id}">Cancel</button>`;
 if(j.status==='Review')return `<button class="text-button" data-action="review" data-id="${id}">Review & pay</button> · <button class="text-button" data-action="cancel-job" data-id="${id}">Cancel</button>`;
 if(j.status==='Awaiting approval')return `<button class="text-button" data-action="review" data-id="${id}">Review approval</button>`;
 if(j.status==='Paid'){const r=state.receipts.find(r=>r.jobId===j.id);return r?.settlement.explorer?`<a class="text-button" href="${esc(r.settlement.explorer)}" target="_blank" rel="noopener">View transaction</a>`:'<span class="muted">Paid</span>'}
 return '<span class="muted">—</span>';
}
function jobsTable(){
 const jobs=state.jobs.filter(j=>(filter==='All'||j.status===filter)&&`${j.title} ${j.payee} ${state.payees[j.payee]||''} ${j.id}`.toLowerCase().includes(search.toLowerCase()));
 if(!jobs.length)return '<div class="empty">▦<h2>No jobs here</h2><p>Create a job to give the agent work and a budget.</p></div>';
 return `<div class="table-wrap"><table><thead><tr><th>JOB / PAYEE</th><th>BUDGET</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${jobs.map(j=>`<tr><td data-label="Job"><strong>${esc(j.title)}</strong><small>${esc(j.id)} <span>·</span> ${payeeName(j.payee)}</small></td><td data-label="Budget">${near(j.amount)}</td><td data-label="Status"><span class="status ${j.status.split(' ')[0].toLowerCase()}">${esc(j.status)}</span></td><td data-label="Action">${jobActions(j)}</td></tr>`).join('')}</tbody></table></div>`;
}
function treasury(){
 const top=heading('Every payment, accounted for.','The vault balance and limits, read live from NEAR.');
 if(!live())return top+setupNotice();
 return top+stats()+`<section class="panel padded"><h3>Available after commitments</h3><h2 class="large">${near(Math.max(0,vault.spendable-committed()))}</h2><p>Vault balance minus the budgets of open jobs. The daily window resets ${new Date(vault.windowEndsMs).toLocaleString()}.</p><p class="muted">Vault <b>${esc(vault.vault)}</b> · owner <b>${esc(vault.owner)}</b> · agent <b>${esc(vault.agent)}</b>. To add funds, send NEAR to the vault account from any wallet.</p></section><section class="panel padded"><h3>Waiting on-chain for your approval</h3>${vault.pending.length?vault.pending.map(p=>`<div class="receipt"><div><strong>${near(p.amount)} to ${payeeName(p.recipient)}</strong><small>Payment #${esc(p.id)} · ${esc(p.job_id)}</small></div></div>`).join(''):'<p>Nothing is waiting.</p>'}</section><section class="panel padded"><h3>Withdraw to owner</h3><p>Sends NEAR from the vault to ${esc(vault.owner)}. Works even while the vault is frozen. Your wallet asks you to confirm.</p><form id="withdraw-form" class="inline-form"><label>Amount (NEAR)<input name="amount" type="number" min="0.0001" step="0.0001" max="${vault.spendable}" required></label><button class="primary" type="submit">Withdraw in wallet</button></form><div id="withdraw-error" class="dialog-error"></div></section>`;
}
function evidence(){
 return heading('Evidence you can inspect.','Every payment links to its NEAR transaction.')+`<div class="notice">Receipts are hash-linked with SHA-256, so an edit to any receipt breaks the chain. The NEAR transactions are the authoritative record.</div><section class="panel padded"><div class="panel-title flush"><h3>Payment receipts</h3><span><button class="text-button" data-action="verify">Verify receipt chain</button> · <button class="text-button" data-action="export">Export JSON</button></span></div><p id="verification"></p>${state.receipts.length?state.receipts.map(receiptRow).join(''):'<p>No payments yet.</p>'}</section><section class="panel padded"><h3>NEAR AI Cloud enclave report</h3><p>Fetch the public attestation report with a fresh nonce and check it here.</p><button class="primary" data-action="attest">Check enclave report</button><div id="attestation">${reportHtml()}</div></section>`;
}
function controls(){
 const top=heading('Autonomy, within your limits.','These rules live in the vault contract. Changing them needs your wallet.');
 if(!live())return top+setupNotice();
 const l=vault.limits,rows=vault.recipients.map(a=>`<div class="receipt"><div><strong>${esc(a)}</strong><form class="label-form inline-form" data-account="${esc(a)}"><label>Label<input name="label" maxlength="60" value="${esc(state.payees[a]||'')}" placeholder="e.g. Research contractor"></label><button class="text-button" type="submit">Save label</button></form></div><button class="danger" data-action="remove-payee" data-account="${esc(a)}">Remove in wallet</button></div>`).join('');
 return top+`<section class="panel padded" id="vault-panel"><h3>Vault status: ${vault.frozen?'Frozen':'Active'}</h3><p>${vault.frozen?'No payment can be requested or approved until you unfreeze.':'Freeze stops every new and pending payment at once.'}</p><button class="${vault.frozen?'primary':'danger'}" data-action="freeze">${vault.frozen?'Unfreeze in wallet':'Freeze in wallet'}</button></section><section class="panel padded"><h3>Spending limits</h3><form id="limits-form"><div class="form-grid three"><label>Paid automatically up to<input name="auto" type="number" min="0.0001" step="0.0001" value="${l.auto}" required></label><label>Maximum per payment<input name="max" type="number" min="0.0001" step="0.0001" value="${l.max}" required></label><label>Daily limit<input name="daily" type="number" min="0.0001" step="0.0001" value="${l.daily}" required></label></div><p class="muted">Amounts in NEAR. Payments above the automatic amount wait for your wallet approval.</p><button class="primary" type="submit">Update limits in wallet</button><div id="limits-error" class="dialog-error"></div></form></section><section class="panel padded"><h3>Payees</h3><p>The agent can pay only these accounts.</p>${rows||'<p class="muted">No payees yet.</p>'}<form id="payee-form" class="inline-form"><label>NEAR account<input name="account" placeholder="name.near" required></label><label>Label<input name="label" maxlength="60" placeholder="Optional"></label><button class="primary" type="submit">Add in wallet</button></form><div id="payee-error" class="dialog-error"></div></section>`;
}
function render(){
 if(!state)return;
 document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#breadcrumb').textContent=page;
 $('#owner-name').textContent=vault.owner||'Owner';$('#vault-name').textContent=vault.vault||'No vault connected';$('#network-name').textContent=vault.configured?networkName():'No network';
 $('#mode').textContent=vault.configured?(vault.frozen?'◉ Vault frozen':'◉ Vault enforced on '+networkName()):'◉ No vault connected';
 $('#footer-mode').textContent=vault.network==='mainnet'?'Payments move real NEAR':vault.configured?`Payments move NEAR on ${networkName()}`:'Payments are off';
 $('#logout').hidden=!session.passwordRequired;
 let html='';
 if(page==='Overview')html=overview();
 if(page==='Jobs')html=heading('Work, reviewed before it is paid.','Create jobs, review deliveries, and pay allowlisted payees.',createButton())+setupNotice()+`<label class="search-label">Search jobs<input id="job-search" type="search" placeholder="Search title, payee, or job ID" value="${esc(search)}"></label><div class="tabs">${['All','Working','Review','Awaiting approval','Paid','Cancelled'].map(f=>`<button data-filter="${f}" class="${filter===f?'selected':''}">${f}<span class="count">${f==='All'?state.jobs.length:state.jobs.filter(j=>j.status===f).length}</span></button>`).join('')}</div><section class="panel">${jobsTable()}</section>`;
 if(page==='Treasury')html=treasury();
 if(page==='Evidence')html=evidence();
 if(page==='Controls')html=controls();
 $('#content').innerHTML=html;
 $('#job-search')?.addEventListener('input',e=>{const pos=e.target.selectionStart;search=e.target.value;render();$('#job-search').focus();$('#job-search').setSelectionRange?.(pos,pos)});
 $('#limits-form')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);owner('limits',{auto:Number(f.get('auto')),max:Number(f.get('max')),daily:Number(f.get('daily'))},$('#limits-error'))});
 $('#withdraw-form')?.addEventListener('submit',e=>{e.preventDefault();owner('withdraw',{amount:Number(new FormData(e.target).get('amount'))},$('#withdraw-error'))});
 $('#payee-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),account=String(f.get('account')).trim().toLowerCase(),label=String(f.get('label')).trim();if(label&&!await mutate('label',{account,label},$('#payee-error')))return;owner('payee',{account,allowed:true},$('#payee-error'))});
 document.querySelectorAll('.label-form').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();if(await mutate('label',{account:form.dataset.account,label:String(new FormData(form).get('label')).trim()}))toast('Label saved.')}));
}
function renderLogin(error=''){
 $('#content').innerHTML=`<section class="panel padded login"><h1>Sign in to PayGate</h1><p>This workspace controls a NEAR spending vault. Enter the owner password.</p><form id="login-form"><label>Password<input name="password" type="password" autocomplete="current-password" required autofocus></label><button class="primary" type="submit">Sign in</button><div id="login-error" class="dialog-error">${esc(error)}</div></form></section>`;
 $('#mode').textContent='◉ Signed out';$('#logout').hidden=true;
 $('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('login',{password:new FormData(e.target).get('password')});session.authenticated=true;await load()}catch(err){$('#login-error').textContent=err.message;b.disabled=false}});
}
function reviewDialog(j){
 let d=$('#review-dialog');if(!d){d=document.createElement('dialog');d.id='review-dialog';document.body.append(d)}
 const auto=live()&&j.amount<=vault.limits.auto,waiting=j.status==='Awaiting approval';
 d.innerHTML=`<div class="dialog-heading"><h2>${waiting?'Approve payment':'Review delivery'}</h2><button class="close" aria-label="Close review">×</button></div><h3>${esc(j.title)}</h3><p>${esc(j.brief)}</p><p class="muted">${j.inference?`Written on NEAR AI Cloud · ${esc(j.inference.model)}`:esc(j.source||'')}</p><div class="notice delivery">${esc(j.deliverable||'')}</div><p><b>${near(j.amount)}</b> to ${payeeName(j.payee)} <span id="quote" class="muted">${j.quote?`· about ${usd(j.quote.usd)} (NEAR Intents quote)`:waiting?'':'· pricing…'}</span></p>${waiting?`<p>The agent requested payment #${esc(j.payment.paymentId)}. The vault holds it until you approve it in your wallet.</p><button class="primary" data-action="approve" data-id="${esc(j.id)}">Approve in wallet</button> <button class="danger" data-action="reject" data-id="${esc(j.id)}">Reject in wallet</button><form id="hash-form" class="inline-form"><label>Already signed? Transaction hash<input name="hash" placeholder="Paste the transaction hash" required></label><button class="text-button" type="submit">Record</button></form>`:`<p class="muted">${auto?'Within the automatic limit: the agent key pays this at once.':'Above the automatic limit: the agent requests it, then you approve in your wallet.'}</p><button class="primary" data-action="confirm-pay" data-id="${esc(j.id)}">${auto?'Pay '+near(j.amount):'Request payment'}</button>`}<div id="review-error" class="dialog-error"></div>`;
 d.querySelector('.close').onclick=()=>d.close();
 d.querySelector('#hash-form')?.addEventListener('submit',async e=>{e.preventDefault();if(await mutate('confirm',{id:j.id,txHash:String(new FormData(e.target).get('hash')).trim()},$('#review-error'))){d.close();toast('Payment recorded from the chain.')}});
 if(!d.open)d.showModal();
 if(!j.quote&&!waiting)api('action',{action:'quote',id:j.id}).then(s=>{state=s;const q=s.jobs.find(x=>x.id===j.id)?.quote;if(q&&$('#quote'))$('#quote').textContent=`· about ${usd(q.usd)} (NEAR Intents quote)`}).catch(()=>{if($('#quote'))$('#quote').textContent='· dollar price unavailable'});
}
function recordDialog(j){
 let d=$('#record-dialog');if(!d){d=document.createElement('dialog');d.id='record-dialog';document.body.append(d)}
 d.innerHTML=`<form id="record-form"><div class="dialog-heading"><h2>Record delivery</h2><button type="button" class="close" aria-label="Close">×</button></div><p>Describe or link what ${payeeName(j.payee)} delivered for <b>${esc(j.title)}</b>. It is stored with the receipt.</p><label>Delivery<textarea name="text" maxlength="8000" required></textarea></label><div id="record-error" class="dialog-error"></div><button class="primary" type="submit">Save delivery</button></form>`;
 d.querySelector('.close').onclick=()=>d.close();
 d.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(await mutate('deliver',{id:j.id,text:new FormData(e.target).get('text')},$('#record-error'))){d.close();toast('Delivery recorded. Ready for review.')}});
 d.showModal();
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||(b.form&&b.type==='submit'))return;
 if(b.dataset.page){page=b.dataset.page;filter='All';search='';render();return}
 if(b.dataset.filter){filter=b.dataset.filter;render();return}
 const action=b.dataset.action,j=state?.jobs.find(j=>j.id===b.dataset.id);
 if(action==='new'){$('#form-error').textContent='';$('#payee-select').innerHTML=vault.recipients.map(a=>`<option value="${esc(a)}">${esc(state.payees[a]?state.payees[a]+' · '+a:a)}</option>`).join('');$('#job-dialog').showModal()}
 if(b.classList.contains('close')&&b.closest('#job-dialog'))$('#job-dialog').close();
 if(action==='logout'){await api('logout',{}).catch(()=>{});session.authenticated=false;state=null;renderLogin()}
 if(action==='verify'){try{const r=await api('verify');$('#verification').textContent=r.valid?`All ${r.count} receipt hashes and links match.`:'Receipt integrity check failed.'}catch(err){toast(err.message)}}
 if(action==='attest'){b.disabled=true;$('#attestation').textContent='Fetching report…';try{report=await api('attestation')}catch(err){report={error:err.message}}b.disabled=false;$('#attestation').innerHTML=reportHtml()}
 if(action==='export'){const blob=new Blob([JSON.stringify({vault:vault.vault||null,network:vault.network||null,receipts:state.receipts},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='paygate-receipts.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 if(action==='run'&&j){b.disabled=true;b.textContent='Agent working…';await mutate('run',{id:j.id});b.disabled=false}
 if(action==='record'&&j)recordDialog(j);
 if(action==='review'&&j)reviewDialog(j);
 if(action==='cancel-job'&&j&&confirm(`Cancel "${j.title}"? Its budget is released.`)){if(await mutate('cancel',{id:j.id}))toast('Job cancelled. Budget released.')}
 if(action==='confirm-pay'){b.disabled=true;$('#review-error').textContent='';const ok=await mutate('pay',{id:b.dataset.id},$('#review-error'));b.disabled=false;if(ok){const now=state.jobs.find(x=>x.id===b.dataset.id);if(now.status==='Paid'){$('#review-dialog').close();toast('Paid from the vault.')}else reviewDialog(now)}}
 if(action==='approve'||action==='reject')owner(action,{id:b.dataset.id},$('#review-error'));
 if(action==='freeze')owner('freeze',{frozen:!vault.frozen});
 if(action==='remove-payee'&&confirm(`Remove ${b.dataset.account} from the allowlist?`))owner('payee',{account:b.dataset.account,allowed:false});
});
function reportHtml(){
 if(!report)return '';if(report.error)return `<p class="dialog-error">${esc(report.error)}</p>`;
 return `<ul class="proof-list">${report.checks.map(c=>`<li class="${c.pass?'':'fail'}">${c.pass?'✓':'✕'} ${esc(c.label)}</li>`).join('')}</ul><code>Model ${esc(report.model)} · TCB ${esc(report.tcbStatus)} · GPU ${esc(report.gpuVerdict)}<br>Signing address ${esc(report.signingAddress)}<br>Quote SHA-256 ${esc(report.quoteSha256)}</code><p>Intel's signature on the quote is not checked here. Use the NEAR AI Verification Center for full verification.</p>`;
}
$('#job-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.target),button=e.target.querySelector('[type=submit]');button.disabled=true;$('#form-error').textContent='';
 const ok=await mutate('create',{title:f.get('title'),brief:f.get('brief'),payee:f.get('payee'),amount:Number(f.get('amount'))},$('#form-error'));
 button.disabled=false;if(ok){$('#job-dialog').close();e.target.reset();toast('Job created. Budget reserved.')}
});
// The wallet returns with ?transactionHashes=… or ?errorCode=…. A job payment is then checked on-chain before it counts.
async function walletReturn(){
 const q=new URLSearchParams(location.search);if(!q.has('wallet'))return;history.replaceState(null,'','/');
 if(q.get('errorCode'))return toast('The wallet did not sign the transaction. Nothing was changed.');
 const tx=q.get('transactionHashes')?.split(',')[0];if(!tx)return;
 const job=q.get('job');
 if(job){if(await mutate('confirm',{id:job,txHash:tx}))toast(state.jobs.find(j=>j.id===job)?.status==='Paid'?'Payment approved and sent.':'Payment rejected. The job is back in review.')}
 else toast('Wallet transaction confirmed. Vault updated.');
}
async function load(){
 const back=new URLSearchParams(location.search).get('wallet');if(back)page={approve:'Jobs',reject:'Jobs',withdraw:'Treasury'}[back]||'Controls';
 try{[state,integrations]=await Promise.all([api('state'),api('integrations')]);await refreshVault();render();await walletReturn()}
 catch(e){if(session.authenticated!==false)$('#content').innerHTML=`<div class="notice">Unable to load the workspace: ${esc(e.message)}</div>`}
}
try{session=await api('session');if(session.authenticated)await load();else renderLogin()}catch{$('#content').innerHTML='<div class="notice">Unable to reach PayGate. Check that the server is running, then refresh.</div>'}
