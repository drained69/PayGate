import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
// Checks a deployed PayGate from the outside, as a visitor. It signs nothing and changes nothing.
// Usage: npm run check:deployed -- https://your-app.up.railway.app
const url=(process.argv[2]||process.env.DEPLOYED_URL||'').replace(/\/$/,'');
if(!/^https:\/\//.test(url)){console.error('Pass the deployed https URL, for example: npm run check:deployed -- https://your-app.up.railway.app');process.exit(1)}
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
try{
 assert.equal((await (await fetch(url+'/healthz')).json()).ok,true);
 const home=await fetch(url+'/');assert.match(home.headers.get('strict-transport-security')||'',/max-age/);assert.match(home.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
 const config=await (await fetch(url+'/api/config')).json();
 for(const path of ['/api/state','/api/vault','/api/integrations'])assert.equal((await fetch(url+path)).status,401,path+' must need a session');
 assert.equal((await fetch(url+'/api/auth/challenge',{method:'POST',headers:{'X-PayGate':'1','Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status,403);
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 await context.route(/mynearwallet\.com/,r=>r.fulfill({status:200,contentType:'text/html',body:'<title>wallet</title>'}));
 await page.goto(url);await page.getByRole('heading',{name:"Give your AI agent a budget it can't overspend."}).waitFor();
 await page.locator('nav [data-page="Docs"]').click();await page.getByRole('heading',{name:'What PayGate is'}).waitFor();
 await page.locator('.footer-links [data-page="Terms"]').click();await page.getByRole('heading',{name:'Terms of use'}).waitFor();
 const [popup]=await Promise.all([page.waitForEvent('popup'),page.locator('#signin').click()]);await popup.waitForURL(/sign-message/);
 const sign=new URL(popup.url());assert.equal(sign.origin,new URL(config.walletUrl).origin);assert.equal(sign.searchParams.get('recipient'),new URL(url).host);await popup.close();
 await page.locator('nav [data-page="Home"]').click();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/deployed-home.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log(`Deployed checks passed on ${url}: health, security headers, ${config.network}, factory ${config.factory||'not configured'}, sessions required, origin check, homepage, docs, terms, sign-in hand-off to ${sign.origin}, mobile layout. Nothing was signed or changed.`);
}finally{await browser.close()}
