import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startStub} from './near-stub.mjs';
// The public site without a chain: homepage, docs, legal pages, the sign-in hand-off to the wallet, and layout.
const dir=await mkdtemp(tmpdir()+'/paygate-test-'),stub=await startStub(),port=3099,url=`http://localhost:${port}`;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,NEAR_AI_URL:stub.url,ONECLICK_URL:stub.url,NEAR_NETWORK:'testnet',PAYGATE_FACTORY:'paygate.testnet',PAYGATE_SECRET:'',DATABASE_URL:'',PUBLIC_URL:'',RAILWAY_PUBLIC_DOMAIN:'',PAYGATE_DEV_ACCOUNTS:''},stdio:['ignore','pipe','inherit']});
let browser;
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited: '+code)))});
 browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 // The real wallet is replaced by a blank page, so the test only checks what PayGate asks it to sign.
 await context.route('https://testnet.mynearwallet.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<title>wallet</title>'}));
 await page.goto(url);await page.getByRole('heading',{name:"Give your AI agent a budget it can't overspend."}).waitFor();
 await page.getByText('Free. You fund your own vault.').waitFor();await page.locator('details.faq').first().click();await page.getByText('Your vault is owned by your account and has no keys.').waitFor();
 await page.locator('nav [data-page="Docs"]').click();await page.getByRole('heading',{name:'What PayGate is'}).waitFor();
 await page.locator('.docs-nav').getByRole('button',{name:'Run your own PayGate'}).click();await page.getByText('platform:deploy').first().waitFor();
 await page.locator('.footer-links [data-page="Terms"]').click();await page.getByRole('heading',{name:'Terms of use'}).waitFor();
 await page.locator('.footer-links [data-page="Privacy"]').click();await page.getByRole('heading',{name:'Privacy notice'}).waitFor();
 const [popup]=await Promise.all([page.waitForEvent('popup'),page.locator('#signin').click()]);await popup.waitForURL(/mynearwallet/);
 const sign=new URL(popup.url());assert.equal(sign.origin+sign.pathname,'https://testnet.mynearwallet.com/sign-message');
 assert.equal(sign.searchParams.get('message'),'Sign in to PayGate');assert.equal(sign.searchParams.get('recipient'),`localhost:${port}`);assert.equal(sign.searchParams.get('callbackUrl'),`${url}/wallet-callback.html`);assert.equal(Buffer.from(sign.searchParams.get('nonce'),'base64').length,32);
 await popup.close();await page.locator('#toast').getByText('wallet window was closed').waitFor();
 assert.equal((await page.request.get(url+'/api/state')).status(),401);
 await page.locator('nav [data-page="Home"]').click();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/home.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/home-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('Browser checks passed: homepage, FAQ, docs, terms, privacy, sign-in hand-off to the wallet (message, nonce, recipient, callback), closed wallet window, sessions required, mobile layout.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));await rm(dir,{recursive:true,force:true});await stub.close()}
