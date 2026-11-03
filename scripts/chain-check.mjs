import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {JsonRpcProvider} from 'near-api-js';
import {accountFor} from '../chain.mjs';
import {startChainApp} from './dev-chain.mjs';
import {startStub} from './near-stub.mjs';
const stub=await startStub(),port=3097,url=`http://localhost:${port}`,app=await startChainApp(port,{ONECLICK_URL:stub.url,NEAR_AI_URL:stub.url});
let browser;
try{
 const provider=new JsonRpcProvider({url:app.config.rpcUrl}),worker=async()=>BigInt((await provider.viewAccount({accountId:app.config.worker,blockQuery:{finality:'optimistic'}})).amount);
 browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const post=async data=>page.request.post(url+'/api/action',{headers:{'X-Nocturne':'local'},data});
 await page.goto(url);await page.getByText('Vault enforced on-chain').waitFor();
 const pay=async title=>{const row=page.getByRole('row').filter({hasText:title});await row.getByRole('button',{name:'Review & pay'}).click();await page.getByRole('button',{name:'Approve demo payment'}).click()};
 const start=await worker();
 await page.locator('nav [data-page="Jobs"]').click();await pay('Competitive landscape report');await page.locator('#review-dialog').waitFor({state:'hidden'});
 assert.equal(await worker()-start,180n*BigInt(app.config.unitYocto));
 await page.getByRole('button',{name:'Create job',exact:false}).click();await page.getByLabel('Job title').fill('Small chain job');await page.getByLabel('Brief',{exact:true}).fill('Pays automatically');await page.getByLabel('Budget (USDC)').fill('25');await page.locator('#job-form button[type=submit]').click();await page.locator('#job-dialog').waitFor({state:'hidden'});
 const row=page.getByRole('row').filter({hasText:'Small chain job'});await row.getByRole('button',{name:'Run agent'}).click();await pay('Small chain job');await page.locator('#review-dialog').waitFor({state:'hidden'});
 assert.equal(await worker()-start,205n*BigInt(app.config.unitYocto));
 await page.locator('nav [data-page="Evidence"]').click();await page.getByText('On-chain · sandbox').first().waitFor();await page.getByText('paid automatically',{exact:false}).waitFor();await page.getByText('paid with owner approval',{exact:false}).waitFor();await page.getByRole('button',{name:'Verify receipt chain'}).click();await page.getByText('All 2 receipt hashes and links match.',{exact:false}).waitFor();
 const state=await (await page.request.get(url+'/api/state')).json();for(const r of state.receipts){const tx=await provider.viewTransactionStatus({txHash:r.settlement.txHash,accountId:r.settlement.route==='auto'?app.config.agent:app.config.owner,waitUntil:'EXECUTED_OPTIMISTIC'});assert.ok(tx.status.SuccessValue!==undefined)}
 assert.equal((await (await post({action:'pay',id:state.jobs.find(j=>j.title==='Small chain job').id,settlement:{txHash:'forged'}})).json()).error,'Job must be awaiting review.');
 await page.locator('nav [data-page="Controls"]').click();await page.getByRole('button',{name:'Freeze demo payments'}).click();await page.locator('#vault-panel').getByText('Frozen').waitFor();
 await post({action:'freeze',freeze:false});await post({action:'complete',id:'NC-103'});
 const big=await post({action:'pay',id:'NC-103'});assert.equal(big.status(),200);assert.equal((await big.json()).receipts[0].settlement.route,'owner-approved');
 const agent=accountFor(app.config.rpcUrl,app.config.agent,app.config.agentKey),ask=(job_id,amount)=>agent.callFunction({contractId:app.config.vault,methodName:'request_payment',args:{recipient:app.config.worker,amount,job_id},gas:60000000000000n}),ownerCall=(methodName,args)=>app.owner.callFunction({contractId:app.config.vault,methodName,args,deposit:1n,gas:60000000000000n}),job=async title=>{const s=await (await post({action:'create',amount:300,title,brief:'Chain recovery',agent:'Atlas · Research'})).json(),{id}=s.jobs[0];await post({action:'complete',id});return id},onChain=id=>state.workspace+':'+id;
 const resumed=await job('Interrupted payment');await ask(onChain(resumed),String(300n*BigInt(app.config.unitYocto)));await ownerCall('set_recipient',{recipient:app.config.worker,allowed:false});
 const refused=await post({action:'pay',id:resumed});assert.equal(refused.status(),400);assert.match((await refused.json()).error,/allowlist/);await ownerCall('set_recipient',{recipient:app.config.worker,allowed:true});
 const retried=await post({action:'pay',id:resumed});assert.equal(retried.status(),200,await retried.text());const recovered=(await retried.json()).receipts[0];assert.equal(recovered.jobId,resumed);assert.equal(recovered.settlement.route,'owner-approved');
 const tampered=await job('Tampered payment');await ask(onChain(tampered),String(150n*BigInt(app.config.unitYocto)));const wrong=await post({action:'pay',id:tampered});assert.equal(wrong.status(),400);assert.match((await wrong.json()).error,/different terms/);
 const over=await post({action:'limits',limit:5000});assert.equal(over.status(),400);assert.match((await over.json()).error,/Limits must satisfy/);
 const lowered=await post({action:'limits',limit:50});assert.equal(lowered.status(),200);assert.equal((await (await page.request.get(url+'/api/vault')).json()).limits.max,0.05);
 await mkdir('test-results',{recursive:true});await page.reload();await page.locator('nav [data-page="Controls"]').click();await page.locator('#vault-panel').waitFor();await page.screenshot({path:'test-results/vault.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Chain checks passed: on-chain payout, automatic and owner-approved routes, receipts, real transactions, forged settlement, interrupted-payment recovery, tampered pending payments, freeze, limit changes.');
}finally{await browser?.close();await app.stop();await stub.close()}
