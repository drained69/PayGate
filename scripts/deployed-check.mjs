import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
// Checks a deployed PayGate without moving funds or changing any setting. Usage: PAYGATE_PASSWORD=… npm run check:deployed -- https://your-app.up.railway.app
const url=(process.argv[2]||process.env.DEPLOYED_URL||'').replace(/\/$/,''),password=process.env.PAYGATE_PASSWORD;
if(!/^https:\/\//.test(url)||!password){console.error('Pass the deployed https URL and set PAYGATE_PASSWORD, for example: PAYGATE_PASSWORD=… npm run check:deployed -- https://your-app.up.railway.app');process.exit(1)}
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
try{
 assert.equal((await (await fetch(url+'/healthz')).json()).ok,true);
 const head=await fetch(url+'/');assert.match(head.headers.get('strict-transport-security')||'',/max-age/);assert.match(head.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
 for(const path of ['/api/state','/api/vault'])assert.equal((await fetch(url+path)).status,401,path+' must need a session');
 assert.equal((await fetch(url+'/api/action',{method:'POST',headers:{'X-PayGate':'1','Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status,403);
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 await page.goto(url);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in'}).click();
 await page.getByRole('heading',{name:'Agent payments, on your terms.'}).waitFor();
 const cookie=(await context.cookies()).find(c=>c.name==='paygate_session');assert.ok(cookie?.httpOnly&&cookie.secure,'session cookie must be HttpOnly and Secure');
 const vault=await (await page.request.get(url+'/api/vault')).json();
 if(vault.configured){assert.ok(!vault.error,vault.error);await page.getByText('Vault enforced on').waitFor();await page.locator('nav [data-page="Treasury"]').click();await page.getByText(vault.vault).first().waitFor();await page.locator('nav [data-page="Controls"]').click();await page.getByText('Spending limits').waitFor()}
 await page.locator('nav [data-page="Evidence"]').click();await page.getByRole('button',{name:'Verify receipt chain'}).click();await page.getByText('receipt hashes and links match.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Check enclave report'}).click();await page.getByText('Model report answers the same nonce',{exact:false}).waitFor({timeout:90000});assert.equal(await page.locator('.proof-list .fail').count(),0);
 await page.locator('nav [data-page="Overview"]').click();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/deployed-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/deployed-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log(`Deployed checks passed on ${url}: health, security headers, sign-in required, origin check, secure session, ${vault.configured?`vault ${vault.vault} on ${vault.network} (${vault.spendable} NEAR spendable, ${vault.frozen?'frozen':'active'})`:'no vault connected'}, receipts, enclave report, mobile layout. Nothing was paid or changed.`);
}finally{await browser.close()}
