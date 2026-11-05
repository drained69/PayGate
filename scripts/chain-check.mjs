import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {JsonRpcProvider,KeyPair,decodeTransaction} from 'near-api-js';
import {toYocto,signNep413,accountFor} from '../chain.mjs';
import {startChainApp} from './dev-chain.mjs';
import {startStub} from './near-stub.mjs';
// The public product end to end on a local NEAR node: wallet sign-in, a vault from the factory, payments,
// approvals and controls, through the same pop-up flow a real wallet uses. A second customer checks isolation.
const stub=await startStub(),port=3097,url=`http://localhost:${port}`;
const app=await startChainApp(port,{ONECLICK_URL:stub.url,NEAR_AI_URL:stub.url});
let browser;
try{
 const {payee,factory,customers}=app,[alice,bob]=Object.keys(customers),vault=`acme.${factory}`,agent=`acme-agent.${factory}`;
 const provider=new JsonRpcProvider({url:app.rpcUrl}),balance=async id=>BigInt((await provider.viewAccount({accountId:id,blockQuery:{finality:'optimistic'}})).amount);
 browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const errors=[],open=async()=>{const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',d=>d.accept());return page};
 const page=await open(),toast=text=>page.locator('#toast').getByText(text,{exact:false}).waitFor();
 const nav=name=>page.locator(`nav [data-page="${name}"]`).click(),row=title=>page.getByRole('row').filter({hasText:title});
 // Clicks a button that opens the wallet and waits for the wallet window to finish and close.
 const viaWallet=async(p,click,account)=>{const [popup]=await Promise.all([p.waitForEvent('popup'),click()]);if(account)await popup.getByRole('link',{name:account}).click();if(!popup.isClosed())await popup.waitForEvent('close')};
 const post=async(p,data)=>(await p.request.post(url+'/api/action',{headers:{'X-PayGate':'1'},data})).json();
 await page.goto(url);await page.getByRole('heading',{name:"Give your AI agent a budget it can't overspend."}).waitFor();
 assert.equal((await page.request.get(url+'/api/state')).status(),401);
 await page.locator('nav [data-page="Docs"]').click();await page.getByRole('heading',{name:'What PayGate is'}).waitFor();
 await page.locator('.footer-links [data-page="Terms"]').click();await page.getByRole('heading',{name:'Terms of use'}).waitFor();
 await viaWallet(page,()=>page.locator('#signin').click(),alice);
 await page.getByRole('heading',{name:'Create your vault.'}).waitFor();await toast('Signed in as '+alice);
 // Vault creation: a payee that does not exist is caught before the wallet signs anything.
 const form=page.locator('#vault-form');await form.getByLabel('Vault name').fill('acme');await form.getByLabel('Initial funding (NEAR)').fill('3');await form.getByLabel('Payees').fill('ghost.sandbox');
 const [blocked]=await Promise.all([page.waitForEvent('popup'),form.getByRole('button',{name:'Create vault in wallet'}).click()]);if(!blocked.isClosed())await blocked.waitForEvent('close');
 await page.locator('#vault-error').getByText('does not exist').waitFor();
 await form.getByLabel('Payees').fill(payee);
 await viaWallet(page,()=>form.getByRole('button',{name:'Create vault in wallet'}).click());
 await toast('Your vault is live.');await page.getByRole('heading',{name:'Agent payments, on your terms.'}).waitFor();
 assert.match(await page.locator('.row-item').filter({hasText:'NEAR spending vault'}).innerText(),/Connected/,'the services list must update once the vault exists');
 const keys=(await provider.viewAccessKeyList({accountId:vault,blockQuery:{finality:'optimistic'}})).keys;assert.equal(keys.length,0,'the vault must have no keys');
 const agentKeys=(await provider.viewAccessKeyList({accountId:agent,blockQuery:{finality:'optimistic'}})).keys;assert.deepEqual(agentKeys.map(k=>k.access_key.permission.FunctionCall?.method_names),[['request_payment']]);
 assert.equal((await provider.callFunction({contractId:vault,method:'get_policy',args:{},blockQuery:{finality:'optimistic'}})).owner,alice);
 const fresh=await (await page.request.get(url+'/api/state')).json();assert.equal(fresh.vault.vault,vault);assert.equal(JSON.stringify(fresh).includes('ed25519:'),false,'keys must never reach the browser');
 await nav('Controls');await page.locator(`form[data-account="${payee}"] input`).fill('Research contractor');await page.locator(`form[data-account="${payee}"] button`).click();await toast('Label saved.');
 await viaWallet(page,()=>page.getByRole('button',{name:'Freeze in wallet'}).click());await page.getByText('Vault status: Frozen').waitFor();
 await nav('Settings');await page.getByLabel('API key').fill('test-key-paygate');await page.getByRole('button',{name:'Save key'}).click();await toast('NEAR AI key saved.');
 const create=async(title,amount)=>{await nav('Jobs');await page.getByRole('button',{name:'Create job'}).click();await page.getByLabel('Job title').fill(title);await page.getByLabel('Brief',{exact:true}).fill('Summarize three competitor pricing pages');await page.getByLabel('Payee').selectOption(payee);await page.getByLabel('Budget (NEAR)').fill(String(amount));await page.locator('#job-form button[type=submit]').click()};
 await create('Too large',0.6);await page.locator('#form-error').getByText('per-payment limit of 0.5 NEAR').waitFor();await page.locator('#job-dialog .close').click();
 await create('Small job',0.05);await page.locator('#job-dialog').waitFor({state:'hidden'});
 await row('Small job').getByRole('button',{name:'Run agent'}).click();await row('Small job').getByRole('button',{name:'Review & pay'}).click();
 await page.getByText('Written on NEAR AI Cloud · stub/model').waitFor();await page.getByText('≈ $3.83').waitFor();
 await page.getByRole('button',{name:'Pay 0.05 NEAR'}).click();await page.locator('#review-error').getByText('The vault is frozen').waitFor();await page.getByRole('button',{name:'Close review'}).click();
 await nav('Controls');await viaWallet(page,()=>page.getByRole('button',{name:'Unfreeze in wallet'}).click());await page.getByText('Vault status: Active').waitFor();
 const start=await balance(payee);
 await nav('Jobs');await row('Small job').getByRole('button',{name:'Review & pay'}).click();await page.getByRole('button',{name:'Pay 0.05 NEAR'}).click();await toast('Paid from the vault.');
 assert.equal(await balance(payee)-start,BigInt(toYocto(0.05)));
 await create('Large job',0.3);await page.locator('#job-dialog').waitFor({state:'hidden'});
 await row('Large job').getByRole('button',{name:'Record delivery'}).click();await page.getByLabel('Delivery').fill('Report: https://example.com/report.pdf');await page.getByRole('button',{name:'Save delivery'}).click();await toast('Delivery recorded');
 await row('Large job').getByRole('button',{name:'Review & pay'}).click();await page.locator('#review-dialog').getByText('Recorded by owner').waitFor();await page.getByRole('button',{name:'Request payment'}).click();
 await viaWallet(page,()=>page.getByRole('button',{name:'Approve in wallet'}).click());await toast('Payment approved and sent.');
 assert.equal(await balance(payee)-start,BigInt(toYocto(0.35)));
 await create('Rejected job',0.2);await page.locator('#job-dialog').waitFor({state:'hidden'});await row('Rejected job').getByRole('button',{name:'Record delivery'}).click();await page.getByLabel('Delivery').fill('Draft');await page.getByRole('button',{name:'Save delivery'}).click();await toast('Delivery recorded');
 await row('Rejected job').getByRole('button',{name:'Review & pay'}).click();await page.getByRole('button',{name:'Request payment'}).click();await viaWallet(page,()=>page.getByRole('button',{name:'Reject in wallet'}).click());await toast('Payment rejected');
 await row('Rejected job').getByText('Review',{exact:true}).waitFor();assert.equal(await balance(payee)-start,BigInt(toYocto(0.35)));
 await nav('Evidence');await page.getByText('Paid automatically').first().waitFor();await page.getByText('Paid with owner approval').first().waitFor();await page.getByRole('button',{name:'Verify receipt chain'}).click();await page.getByText('All 2 receipt hashes and links match.').waitFor();
 const s=await (await page.request.get(url+'/api/state')).json();
 for(const r of s.workspace.receipts){const tx=await provider.viewTransactionStatus({txHash:r.settlement.txHash,accountId:r.settlement.route==='auto'?agent:alice,waitUntil:'EXECUTED_OPTIMISTIC'});assert.ok(tx.status.SuccessValue!==undefined)}
 // A transaction hash proves nothing unless the chain shows this owner approving this exact payment.
 const rejected=s.workspace.jobs.find(j=>j.title==='Rejected job').id;assert.equal((await post(page,{action:'pay',id:rejected})).workspace.jobs.find(j=>j.id===rejected).status,'Awaiting approval');
 assert.match((await post(page,{action:'confirm',id:rejected,txHash:s.workspace.receipts[0].settlement.txHash})).error,/not the expected action/);
 for(const action of ['paid','requested','complete','released'])assert.equal((await post(page,{action,id:rejected,settlement:{txHash:'x'}})).error,'Unknown action.');
 await nav('Controls');await page.getByLabel('Paid automatically up to').fill('0.6');await page.getByRole('button',{name:'Update limits in wallet'}).click();await page.locator('#limits-error').getByText('Limits must satisfy').waitFor();
 await page.getByLabel('Paid automatically up to').fill('0.2');await page.getByLabel('Maximum per payment').fill('0.4');await viaWallet(page,()=>page.getByRole('button',{name:'Update limits in wallet'}).click());await toast('Wallet transaction confirmed');
 assert.deepEqual((await (await page.request.get(url+'/api/vault')).json()).limits,{auto:0.2,max:0.4,daily:1});
 await page.getByLabel('NEAR account').fill(bob);await viaWallet(page,()=>page.getByRole('button',{name:'Add in wallet'}).click());await page.locator(`form[data-account="${bob}"]`).waitFor();
 await viaWallet(page,()=>page.locator(`[data-account="${bob}"][data-action="remove-payee"]`).click());await toast('Wallet transaction confirmed');assert.equal(await page.locator(`form[data-account="${bob}"]`).count(),0);
 await nav('Treasury');await page.getByRole('heading',{name:'Waiting on-chain for your approval'}).waitFor();
 const before=await balance(alice);await page.getByLabel('Amount (NEAR)').fill('1');await viaWallet(page,()=>page.getByRole('button',{name:'Withdraw in wallet'}).click());await toast('Wallet transaction confirmed');assert.ok(await balance(alice)-before>BigInt(toYocto(0.99)));
 // Agent API: a key made in Settings lets an agent run the same flow over REST and MCP, within the same rules.
 await nav('Settings');await page.getByLabel('Key name').fill('Research agent');await page.getByRole('button',{name:'Create key'}).click();
 const apiKey=(await page.locator('#new-key').textContent()).trim();assert.match(apiKey,/^pg_test_[A-Za-z0-9_-]{32}$/);await page.locator('#key-dialog .close').click();
 const agentReq=async(method,path,data,key=apiKey)=>{const r=await page.request.fetch(url+path,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},data});return {status:r.status(),body:await r.json().catch(()=>null)}};
 assert.equal((await agentReq('GET','/api/v1/vault',undefined,'pg_test_'+'x'.repeat(32))).status,401);
 const v1=(await agentReq('GET','/api/v1/vault')).body;assert.equal(v1.vault,vault);assert.deepEqual(v1.payees.map(p=>p.account),[payee]);
 const viaApi=await balance(payee);
 const made=await agentReq('POST','/api/v1/jobs',{title:'Agent job',brief:'Made over REST',payee,amount:0.05});assert.equal(made.status,201);
 await agentReq('POST',`/api/v1/jobs/${made.body.id}/deliver`,{text:'Delivered by the agent'});
 const paidApi=(await agentReq('POST',`/api/v1/jobs/${made.body.id}/pay`)).body;assert.equal(paidApi.status,'Paid');assert.equal(paidApi.receipt.route,'auto');
 assert.equal(await balance(payee)-viaApi,BigInt(toYocto(0.05)));
 const mcp=async(method,params,key=apiKey)=>(await agentReq('POST','/mcp',{jsonrpc:'2.0',id:1,method,params},key)).body;
 assert.equal((await mcp('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.serverInfo.name,'paygate');
 assert.ok((await mcp('tools/list',{})).result.tools.some(t=>t.name==='request_payment'));
 const call=async(name,args,key)=>JSON.parse((await mcp('tools/call',{name,arguments:args},key)).result.content[0].text);
 const big=await call('create_job',{title:'Agent large job',brief:'Over MCP',payee,amount:0.3});await call('deliver_job',{id:big.id,text:'Done'});
 assert.equal((await call('request_payment',{id:big.id})).status,'Awaiting approval','larger payments still wait for the owner');
 assert.equal((await mcp('tools/call',{name:'create_job',arguments:{title:'x',brief:'y',payee:'attacker.near',amount:0.01}})).result.isError,true);
 assert.equal((await agentReq('POST','/api/v1/vault/freeze',{})).status,404,'agents have no owner actions');
 // A key without payment rights cannot request payment.
 await page.getByLabel('Key name').fill('Read only');await page.locator('#api-key-form input[name=pay]').uncheck();await page.getByRole('button',{name:'Create key'}).click();
 await page.locator('#key-dialog[open] #new-key').filter({hasNotText:apiKey}).waitFor();const readKey=(await page.locator('#new-key').textContent()).trim();assert.notEqual(readKey,apiKey);await page.locator('#key-dialog .close').click();
 assert.equal((await mcp('tools/list',{},readKey)).result.tools.some(t=>t.name==='request_payment'),false);
 assert.equal((await agentReq('POST',`/api/v1/jobs/${big.id}/pay`,{},readKey)).status,403);
 // Revoking a key stops it at once.
 await page.getByRole('row').filter({hasText:'Read only'}).getByRole('button',{name:'Revoke'}).click();await toast('Key revoked.');
 assert.equal((await agentReq('GET','/api/v1/jobs',undefined,readKey)).status,401);
 assert.equal(JSON.stringify(await (await page.request.get(url+'/api/state')).json()).includes(apiKey),false,'keys are never sent back');
 // A second customer sees nothing of the first and cannot claim their vault or name.
 const other=await open();await other.goto(url);await viaWallet(other,()=>other.locator('#signin').click(),bob);await other.getByRole('heading',{name:'Create your vault.'}).waitFor();
 const theirs=await (await other.request.get(url+'/api/state')).json();assert.equal(theirs.account,bob);assert.equal(theirs.vault,null);assert.equal(theirs.workspace.jobs.length,0);
 assert.match((await post(other,{action:'pay',id:rejected})).error,/Create your vault first/);
 assert.match((await post(other,{action:'vault-create',name:'acme',fund:1,auto:0.1,max:0.5,daily:1,payees:[]})).error,/taken/);
 assert.match((await post(other,{action:'vault-confirm',txHash:s.workspace.receipts[0].settlement.txHash})).error,/Start creating a vault first/);
 // A wallet that signs but never reports back: PayGate finds the new vault on-chain without a hash.
 const link=(await post(other,{action:'vault-create',name:'bobco',fund:1,auto:0.1,max:0.5,daily:1,payees:[payee]})).url,tx=decodeTransaction(Buffer.from(new URL(link,url).searchParams.get('transactions'),'base64'));
 await accountFor(app.rpcUrl,bob,customers[bob]).signAndSendTransaction({receiverId:tx.receiverId,actions:tx.actions});
 assert.equal((await post(other,{action:'vault-confirm'})).vault.vault,`bobco.${factory}`);
 assert.ok(Number(await provider.callFunction({contractId:`bobco.${factory}`,method:'get_policy',args:{},blockQuery:{finality:'optimistic'}}).then(p=>BigInt(p.balance)))>0.69e24,'the rest of the deposit reaches the vault');
 // A large deposit on a taken name comes back in full, even though it is far larger than the factory's buffer.
 const bobBefore=await balance(bob);await accountFor(app.rpcUrl,bob,customers[bob]).callFunctionRaw({contractId:factory,methodName:'create_vault',args:{name:'acme',agent_key:KeyPair.fromRandom('ed25519').getPublicKey().toString(),limits:{auto_limit:toYocto(0.1),max_payment:toYocto(0.5),daily_limit:toYocto(1)},recipients:[]},deposit:BigInt(toYocto(10)),gas:200000000000000n});
 let lost;for(let i=0;i<15;i++){lost=bobBefore-await balance(bob);if(lost<BigInt(toYocto(0.01)))break;await new Promise(d=>setTimeout(d,1000))}assert.ok(lost<BigInt(toYocto(0.01)),'a failed creation must be refunded');
 // Forged sign-ins: someone else's signature for an account, and a nonce used twice.
 const ch=await (await other.request.post(url+'/api/auth/challenge',{headers:{'X-PayGate':'1'},data:{}})).json(),payload={message:ch.message,nonce:Buffer.from(ch.nonce,'base64'),recipient:ch.recipient,callbackUrl:ch.callbackUrl};
 const bobKey=customers[bob],forged={accountId:alice,publicKey:KeyPair.fromString(bobKey).getPublicKey().toString(),signature:signNep413(bobKey,payload),nonce:ch.nonce};
 assert.equal((await other.request.post(url+'/api/auth/verify',{headers:{'X-PayGate':'1'},data:forged})).status(),401);
 assert.equal((await other.request.post(url+'/api/auth/verify',{headers:{'X-PayGate':'1'},data:{...forged,accountId:bob}})).status(),401,'a used nonce must not work twice');
 await other.locator('nav [data-page="Settings"]').click();await other.getByLabel(`Type ${bob} to confirm`).fill(bob);await other.getByRole('button',{name:'Delete my data'}).click();await other.getByRole('heading',{name:"Give your AI agent a budget it can't overspend."}).waitFor();
 assert.equal((await other.request.get(url+'/api/state')).status(),401);
 await page.reload();await nav('Overview');await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/chain-overview.png',fullPage:true});
 await nav('Controls');await page.screenshot({path:'test-results/chain-controls.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await nav('Jobs');await page.screenshot({path:'test-results/chain-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log('Chain checks passed: public pages, wallet sign-in, vault from the factory (keyless vault, restricted agent, owner on-chain), keys kept from the browser, payee labels, freeze, NEAR AI key, limit errors, agent delivery, USD quote, automatic and approved payments, rejection, receipts and transactions, forged approvals and injected results, limits, payees, withdrawal, agent API keys, REST and MCP payments within limits, read-only and revoked keys, customer isolation, taken names, vault found on-chain without a hash, full refund of a large failed deposit, forged and replayed sign-ins, data deletion, mobile layout.');
}finally{await browser?.close();await app.stop();await stub.close()}
