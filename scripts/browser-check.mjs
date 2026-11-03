import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startStub} from './near-stub.mjs';
// The app with a password and no vault: sign-in, setup guidance, evidence checks and layout. Payments are covered by test:chain.
const dir=await mkdtemp(tmpdir()+'/paygate-test-'),stub=await startStub(),port=3099,url=`http://localhost:${port}`,password='browser check password';
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,NEAR_AI_URL:stub.url,ONECLICK_URL:stub.url,NEAR_AI_API_KEY:'test-key',PAYGATE_PASSWORD:password,PAYGATE_CHAIN_JSON:'',PUBLIC_URL:'',RAILWAY_PUBLIC_DOMAIN:'',NEAR_OWNER_KEY:''},stdio:['ignore','pipe','inherit']});
let browser;
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited: '+code)))});
 browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error'&&!/401|Failed to load resource/.test(m.text()))errors.push(m.text())});
 await page.goto(url);await page.getByRole('heading',{name:'Sign in to PayGate'}).waitFor();
 assert.equal((await page.request.get(url+'/api/state')).status(),401);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1440,height:1000});
 await page.getByLabel('Password').fill('not it');await page.getByRole('button',{name:'Sign in'}).click();await page.getByText('Wrong password.').waitFor();
 await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in'}).click();
 await page.getByRole('heading',{name:'Agent payments, on your terms.'}).waitFor();await page.getByText('No vault is connected.').first().waitFor();await page.getByText('◉ No vault connected').waitFor();
 assert.equal(await page.getByRole('button',{name:'Create job'}).count(),0);
 await page.locator('nav [data-page="Controls"]').click();await page.getByText('npm run vault:deploy').waitFor();
 await page.locator('nav [data-page="Evidence"]').click();await page.getByRole('button',{name:'Verify receipt chain'}).click();await page.getByText('All 0 receipt hashes and links match.').waitFor();
 await page.getByRole('button',{name:'Check enclave report'}).click();await page.getByText('Quote is bound to the nonce this server generated').waitFor();assert.equal(await page.locator('.proof-list .fail').count(),0);
 // Navigating before the workspace has loaded must not break the page.
 let release,seen;const asked=new Promise(done=>seen=done),hold=new Promise(done=>release=done);await page.route('**/api/state',async r=>{seen();await hold;await r.continue()});
 page.reload().catch(()=>{});await asked;await page.locator('nav [data-page="Treasury"]').click();release();await page.getByRole('heading',{name:'Every payment, accounted for.'}).waitFor();await page.unroute('**/api/state');
 await mkdir('test-results',{recursive:true});await page.locator('nav [data-page="Overview"]').click();await page.screenshot({path:'test-results/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByRole('heading',{name:'Sign in to PayGate'}).waitFor();assert.equal((await page.request.get(url+'/api/state')).status(),401);
 assert.deepEqual(errors,[]);console.log('Browser checks passed: sign-in, wrong password, setup guidance without a vault, receipt verification, enclave report, navigation before data loads, sign-out, mobile layout.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));await rm(dir,{recursive:true,force:true});await stub.close()}
