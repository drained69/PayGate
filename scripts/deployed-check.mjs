import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
// Drives a deployed copy like a visitor would. Usage: npm run check:deployed -- https://your-app.up.railway.app
const url=(process.argv[2]||process.env.DEPLOYED_URL||'').replace(/\/$/,'');
if(!/^https:\/\//.test(url)){console.error('Pass the deployed https URL, for example: npm run check:deployed -- https://your-app.up.railway.app');process.exit(1)}
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
try{
 const health=await (await fetch(url+'/healthz')).json();assert.equal(health.ok,true);
 const a=await browser.newContext({viewport:{width:1440,height:1000}}),page=await a.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text())});
 await page.goto(url);await page.getByRole('heading',{name:'Business, quietly in motion.'}).waitFor();
 const vault=await (await page.request.get(url+'/api/vault')).json();assert.equal(vault.shared,true,'server is not in hosted mode');
 const title='Deployed check '+Date.now();
 await page.getByRole('button',{name:'Create job',exact:false}).click();await page.getByLabel('Job title').fill(title);await page.getByLabel('Brief',{exact:true}).fill('Summarize three competitor pricing pages');await page.getByLabel('Budget (USDC)').fill('25');await page.locator('#job-form button[type=submit]').click();await page.locator('#job-dialog').waitFor({state:'hidden'});
 await page.locator('nav [data-page="Jobs"]').click();const row=page.getByRole('row').filter({hasText:title});await row.getByRole('button',{name:'Run agent'}).click();await row.getByRole('button',{name:'Review & pay'}).waitFor({timeout:150000});await row.getByRole('button',{name:'Review & pay'}).click();
 await page.getByText('Live dry quote: recipient gets',{exact:false}).waitFor({timeout:60000});await page.getByRole('button',{name:'Approve demo payment'}).click();await page.locator('#review-dialog').waitFor({state:'hidden',timeout:120000});
 await page.reload();await page.locator('nav [data-page="Evidence"]').click();await page.getByRole('button',{name:'Verify receipt chain'}).click();await page.getByText('All 1 receipt hashes and links match.',{exact:false}).waitFor();
 if(vault.configured)await page.getByText('On-chain · testnet').first().waitFor();
 await page.getByRole('button',{name:'Check enclave report'}).click();await page.getByText('Model report answers the same nonce',{exact:false}).waitFor({timeout:90000});assert.equal(await page.locator('.proof-list .fail').count(),0);
 await page.locator('nav [data-page="Controls"]').click();await page.getByText('freeze applies to your session only',{exact:false}).waitFor();await page.getByRole('button',{name:'Freeze demo payments'}).click();await page.getByRole('button',{name:'Resume demo payments'}).waitFor();
 const b=await browser.newContext(),other=await b.newPage();await other.goto(url);await other.getByRole('heading',{name:'Business, quietly in motion.'}).waitFor();
 const theirs=await (await other.request.get(url+'/api/state')).json();assert.equal(theirs.jobs.some(j=>j.title===title),false);assert.equal(theirs.freeze,false);
 assert.equal((await other.request.post(url+'/api/action',{data:{action:'freeze',freeze:true}})).status(),403);
 await page.locator('nav [data-page="Jobs"]').click();await page.getByRole('row').filter({hasText:'Competitive landscape report'}).getByRole('button',{name:'Review & pay'}).click();await page.getByRole('button',{name:'Approve demo payment'}).click();await page.locator('#review-error').getByText('Payments are frozen.').waitFor();await page.getByRole('button',{name:'Close review'}).click();
 await page.locator('nav [data-page="Overview"]').click();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/deployed-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/deployed-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log(`Deployed checks passed on ${url}: health, ${vault.configured?'testnet vault payment':'simulated payment'}, agent run, live quote, receipts, enclave report, session freeze, visitor isolation, origin check, mobile layout.`);
}finally{await browser.close()}
