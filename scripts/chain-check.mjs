import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {JsonRpcProvider} from 'near-api-js';
import {accountFor,toYocto} from '../chain.mjs';
import {startChainApp} from './dev-chain.mjs';
import {startStub} from './near-stub.mjs';
// Drives the real UI against a local NEAR node. Owner actions go through the built-in local wallet, the same redirect a real wallet uses.
const stub=await startStub(),port=3097,url=`http://localhost:${port}`,password='local test password';
const app=await startChainApp(port,{ONECLICK_URL:stub.url,NEAR_AI_URL:stub.url,NEAR_AI_API_KEY:'test-key',PAYGATE_PASSWORD:password});
let browser;
try{
 const {config,payee}=app,provider=new JsonRpcProvider({url:config.rpcUrl}),balance=async id=>BigInt((await provider.viewAccount({accountId:id,blockQuery:{finality:'optimistic'}})).amount);
 browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',d=>d.accept());
 const post=async data=>(await page.request.post(url+'/api/action',{headers:{'X-PayGate':'1'},data})),toast=text=>page.locator('#toast').getByText(text,{exact:false}).waitFor();
 const viaWallet=async click=>{const signed=page.waitForResponse(r=>r.url().includes('/dev-wallet/sign'));await click;await signed;await page.waitForLoadState()};
 const nav=name=>page.locator(`nav [data-page="${name}"]`).click(),row=title=>page.getByRole('row').filter({hasText:title});
 await page.goto(url);await page.getByLabel('Password').fill('wrong password');await page.getByRole('button',{name:'Sign in'}).click();await page.getByText('Wrong password.').waitFor();
 await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in'}).click();await page.getByText('Vault enforced on local NEAR node').waitFor();
 await nav('Controls');await page.locator(`form[data-account="${payee}"] input`).fill('Research contractor');await page.locator(`form[data-account="${payee}"] button`).click();await toast('Label saved.');
 await viaWallet(page.getByRole('button',{name:'Freeze in wallet'}).click());await page.getByText('Vault status: Frozen').waitFor();await toast('Wallet transaction confirmed');
 const create=async(title,amount)=>{await nav('Jobs');await page.getByRole('button',{name:'Create job'}).click();await page.getByLabel('Job title').fill(title);await page.getByLabel('Brief',{exact:true}).fill('Summarize three competitor pricing pages');await page.getByLabel('Payee').selectOption(payee);await page.getByLabel('Budget (NEAR)').fill(String(amount));await page.locator('#job-form button[type=submit]').click()};
 await create('Too large',0.6);await page.locator('#form-error').getByText("per-payment limit of 0.5 NEAR").waitFor();await page.locator('#job-dialog .close').click();
 await create('Small job',0.05);await page.locator('#job-dialog').waitFor({state:'hidden'});
 await row('Small job').getByRole('button',{name:'Run agent'}).click();await row('Small job').getByRole('button',{name:'Review & pay'}).click();
 await page.getByText('Written on NEAR AI Cloud · stub/model').waitFor();await page.getByText('≈ $3.83').waitFor();
 await page.getByRole('button',{name:'Pay 0.05 NEAR'}).click();await page.locator('#review-error').getByText('The vault is frozen').waitFor();await page.getByRole('button',{name:'Close review'}).click();
 await nav('Controls');await viaWallet(page.getByRole('button',{name:'Unfreeze in wallet'}).click());await page.getByText('Vault status: Active').waitFor();
 const start=await balance(payee);
 await nav('Jobs');await row('Small job').getByRole('button',{name:'Review & pay'}).click();await page.getByRole('button',{name:'Pay 0.05 NEAR'}).click();await toast('Paid from the vault.');
 assert.equal(await balance(payee)-start,BigInt(toYocto(0.05)));
 await create('Large job',0.3);await page.locator('#job-dialog').waitFor({state:'hidden'});
 await row('Large job').getByRole('button',{name:'Record delivery'}).click();await page.getByLabel('Delivery').fill('Report: https://example.com/report.pdf');await page.getByRole('button',{name:'Save delivery'}).click();await toast('Delivery recorded');
 await row('Large job').getByRole('button',{name:'Review & pay'}).click();await page.locator('#review-dialog').getByText('Recorded by owner').waitFor();await page.getByRole('button',{name:'Request payment'}).click();
 await viaWallet(page.getByRole('button',{name:'Approve in wallet'}).click());await toast('Payment approved and sent.');
 assert.equal(await balance(payee)-start,BigInt(toYocto(0.35)));
 await create('Rejected job',0.2);await page.locator('#job-dialog').waitFor({state:'hidden'});await row('Rejected job').getByRole('button',{name:'Record delivery'}).click();await page.getByLabel('Delivery').fill('Draft');await page.getByRole('button',{name:'Save delivery'}).click();await toast('Delivery recorded');
 await row('Rejected job').getByRole('button',{name:'Review & pay'}).click();await page.getByRole('button',{name:'Request payment'}).click();await viaWallet(page.getByRole('button',{name:'Reject in wallet'}).click());await toast('Payment rejected');
 await row('Rejected job').getByText('Review',{exact:true}).waitFor();assert.equal(await balance(payee)-start,BigInt(toYocto(0.35)));
 await nav('Evidence');await page.getByText('paid automatically',{exact:false}).waitFor();await page.getByText('paid with owner approval',{exact:false}).waitFor();await page.getByRole('button',{name:'Verify receipt chain'}).click();await page.getByText('All 2 receipt hashes and links match.').waitFor();
 let state=await (await page.request.get(url+'/api/state')).json();
 for(const r of state.receipts){const tx=await provider.viewTransactionStatus({txHash:r.settlement.txHash,accountId:r.settlement.route==='auto'?config.agent:config.owner,waitUntil:'EXECUTED_OPTIMISTIC'});assert.ok(tx.status.SuccessValue!==undefined)}
 // A transaction hash proves nothing unless the chain shows the owner approving this exact payment.
 const rejected=state.jobs.find(j=>j.title==='Rejected job').id;assert.equal((await (await post({action:'pay',id:rejected})).json()).jobs.find(j=>j.id===rejected).status,'Awaiting approval');
 assert.match((await (await post({action:'confirm',id:rejected,txHash:state.receipts[0].settlement.txHash})).json()).error,/not the expected owner action/);
 assert.match((await (await post({action:'confirm',id:rejected,txHash:'11111111111111111111111111111111111111111111'})).json()).error,/not found/);
 await nav('Controls');await page.getByLabel('Paid automatically up to').fill('0.6');await page.getByRole('button',{name:'Update limits in wallet'}).click();await page.locator('#limits-error').getByText('Limits must satisfy').waitFor();
 await page.getByLabel('Paid automatically up to').fill('0.2');await page.getByLabel('Maximum per payment').fill('0.4');await viaWallet(page.getByRole('button',{name:'Update limits in wallet'}).click());await toast('Wallet transaction confirmed');
 const limits=(await (await page.request.get(url+'/api/vault')).json()).limits;assert.deepEqual(limits,{auto:0.2,max:0.4,daily:1});
 await page.getByLabel('NEAR account').fill('second.test.near');await viaWallet(page.getByRole('button',{name:'Add in wallet'}).click());await page.locator('form[data-account="second.test.near"]').waitFor();
 await viaWallet(page.locator('[data-account="second.test.near"][data-action="remove-payee"]').click());await toast('Wallet transaction confirmed');assert.equal(await page.locator('form[data-account="second.test.near"]').count(),0);
 await nav('Treasury');await page.getByText('Waiting on-chain for your approval').waitFor();await page.getByRole('row').filter({hasText:'Payment #'}).filter({hasText:'Research contractor'}).filter({hasText:'0.2 NEAR'}).first().waitFor();
 const ownerBefore=await balance(config.owner);await page.getByLabel('Amount (NEAR)').fill('1');await viaWallet(page.getByRole('button',{name:'Withdraw in wallet'}).click());await toast('Wallet transaction confirmed');assert.ok(await balance(config.owner)-ownerBefore>BigInt(toYocto(0.99)));
 // An interrupted request is resumed only if the pending payment has exactly this job's terms.
 const agent=accountFor(config.rpcUrl,config.agent,config.agentKey),ask=(id,amount)=>agent.callFunction({contractId:config.vault,methodName:'request_payment',args:{recipient:payee,amount:toYocto(amount),job_id:state.workspace+':'+id},gas:60000000000000n});
 const job=async(title,amount)=>{const s=await (await post({action:'create',amount,title,brief:'Recovery',payee})).json(),{id}=s.jobs[0];await post({action:'deliver',id,text:'Done'});return id};
 const resumed=await job('Interrupted payment',0.3);await ask(resumed,0.3);const r=await (await post({action:'pay',id:resumed})).json();assert.equal(r.jobs.find(j=>j.id===resumed).status,'Awaiting approval');
 const tampered=await job('Tampered payment',0.3);await ask(tampered,0.25);assert.match((await (await post({action:'pay',id:tampered})).json()).error,/different terms/);
 let refused;for(let i=0;i<20&&!refused;i++)refused=(await (await post({action:'create',amount:0.4,title:'Budget '+i,brief:'x',payee})).json()).error;assert.match(refused||'',/not already committed/);
 await page.reload();await nav('Overview');await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/chain-overview.png',fullPage:true});
 await nav('Controls');await page.screenshot({path:'test-results/chain-controls.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await nav('Jobs');await page.screenshot({path:'test-results/chain-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log('Chain checks passed: sign-in, payee labels, freeze and unfreeze in the wallet, limit errors, NEAR AI delivery, USD quote, automatic payment, owner-approved payment, rejection, receipts and real transactions, forged approvals, limit and payee changes, withdrawal, interrupted-payment recovery, tampered pending payments, mobile layout.');
}finally{await browser?.close();await app.stop();await stub.close()}
