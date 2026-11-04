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
 // The NEAR Connect wallet list is replaced by a fixture, so the test needs no network and no real wallet.
 await context.route(/near-selector.*manifest\.json|hot-connector.*manifest\.json/,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:'1.0.0',wallets:[{id:'meteor-wallet',name:'Meteor Wallet',icon:'data:,',website:'https://meteorwallet.app',description:'Test entry',version:'1.0.0',type:'sandbox',executor:'https://wallet.example/executor.js',permissions:{storage:true},features:{signMessage:true,signInAndSignMessage:true,signAndSendTransaction:true,signAndSendTransactions:true,testnet:true}}]})}));
 await page.goto(url);await page.getByRole('heading',{name:"Give your AI agent a budget it can't overspend."}).waitFor();
 await page.getByText('Free. You fund your own vault.').waitFor();await page.locator('details.faq').first().click();await page.getByText('Your vault is owned by your account and has no keys.').waitFor();
 await page.locator('nav [data-page="Docs"]').click();await page.getByRole('heading',{name:'What PayGate is'}).waitFor();
 await page.locator('.docs-nav').getByRole('button',{name:'Run your own PayGate'}).click();await page.getByText('platform:deploy').first().waitFor();
 await page.locator('.footer-links [data-page="Terms"]').click();await page.getByRole('heading',{name:'Terms of use'}).waitFor();
 await page.locator('.footer-links [data-page="Privacy"]').click();await page.getByRole('heading',{name:'Privacy notice'}).waitFor();
 // Sign-in opens the NEAR Connect wallet picker, after the server has issued a one-time challenge for this site.
 const challenge=page.waitForResponse(r=>r.url().endsWith('/api/auth/challenge'));await page.locator('#signin').click();
 const ch=await (await challenge).json();assert.equal(ch.message,'Sign in to PayGate');assert.equal(ch.recipient,`localhost:${port}`);assert.equal(Buffer.from(ch.nonce,'base64').length,32);
 await page.locator('.hot-connector-popup').getByText('Meteor Wallet').waitFor();
 const csp=(await page.request.get(url+'/')).headers()['content-security-policy'];assert.match(csp,/script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}'/);assert.equal(/script-src[^;]*https:/.test(csp),false,'scripts from other sites must not be allowed');
 const html=await (await page.request.get(url+'/')).text();assert.match(html,/<meta name="csp-nonce" content="[A-Za-z0-9+/=]{24}">/);
 await page.keyboard.press('Escape');await page.reload();
 assert.equal((await page.request.get(url+'/api/state')).status(),401);
 await page.locator('nav [data-page="Home"]').click();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/home.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/home-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('Browser checks passed: homepage, FAQ, docs, terms, privacy, sign-in challenge, NEAR Connect wallet picker, script nonce policy, sessions required, mobile layout.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));await rm(dir,{recursive:true,force:true});await stub.close()}
