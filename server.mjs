import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {decodeTransaction} from 'near-api-js';
import {transition,empty,verify,CLIENT_ACTIONS} from './domain.mjs';
import {usdValue,attestation,deliver,hasInferenceKey,integrations} from './near.mjs';
import {vaultClient,accountFor,reason,toNear,isAccountId} from './chain.mjs';
const env=process.env,port=Number(env.PORT||3000),root=new URL('./public/',import.meta.url);
const fail=message=>{console.error(message);process.exit(1)};
// A public URL means the server is reachable from the internet, so it then requires the owner's password.
const publicUrl=env.PUBLIC_URL||(env.RAILWAY_PUBLIC_DOMAIN?'https://'+env.RAILWAY_PUBLIC_DOMAIN:''),hosted=Boolean(publicUrl);
const origins=[`http://localhost:${port}`,`http://127.0.0.1:${port}`,...(hosted?[new URL(publicUrl).origin]:[])],hosts=origins.map(o=>new URL(o).host);
const password=env.PAYGATE_PASSWORD||'';
if(hosted&&password.length<12)fail('Set PAYGATE_PASSWORD to at least 12 characters. It protects the hosted app.');
const digest=s=>createHash('sha256').update(s).digest();
const dir=env.DATA_DIR?pathToFileURL(env.DATA_DIR+'/'):new URL('./data/',import.meta.url),file=new URL('workspace.json',dir);
try{await mkdir(dir,{recursive:true,mode:0o700})}catch(e){fail(`Cannot create ${dir.pathname} (${e.code}). On Railway, attach a volume and set DATA_DIR to its mount path.`)}
const save=async next=>{await writeFile(new URL('workspace.tmp',dir),JSON.stringify(next,null,2),{mode:0o600});await rename(new URL('workspace.tmp',dir),file)};
let state;try{state=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')fail(`Cannot read ${file.pathname}. Restore it from a backup before starting.`);state=empty();await save(state)}
if(!Array.isArray(state.jobs)||!Array.isArray(state.receipts)||!state.workspace||'balance' in state)fail(`${file.pathname} is not a PayGate workspace. It may come from an older version; move it aside to start fresh.`);
state.payees||={};
let queue=Promise.resolve();
const commit=c=>{const job=queue.then(async()=>{const next=transition(state,c);await save(next);state=next;return next});queue=job.catch(()=>{});return job};
async function chainConfig(){
 if(env.PAYGATE_CHAIN_JSON)return JSON.parse(env.PAYGATE_CHAIN_JSON);
 try{return JSON.parse(await readFile(env.PAYGATE_CHAIN?pathToFileURL(env.PAYGATE_CHAIN):new URL('chain.json',dir),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}
}
const config=await chainConfig().catch(e=>fail('The vault settings are not valid JSON: '+e.message));
if(config&&!['mainnet','testnet','sandbox'].includes(config.network))fail('The vault settings need a network of mainnet, testnet or sandbox.');
if(config&&!config.agentKey)fail('The vault settings have no agent key. Use the chain.json written by npm run vault:deploy.');
// A local node has no wallet, so the server signs owner actions itself, and only there.
const devWallet=config?.network==='sandbox'&&env.NEAR_OWNER_KEY?accountFor(config.rpcUrl,config.owner,env.NEAR_OWNER_KEY):null;
if(config&&config.network!=='sandbox'&&env.NEAR_OWNER_KEY)fail('Remove NEAR_OWNER_KEY. On testnet and mainnet the owner signs in their own wallet, and the server never holds that key.');
const vault=config?vaultClient(devWallet?{...config,walletUrl:'/dev-wallet'}:config):null;
const sessions=new Map(),hits=new Map(),SESSION_MS=12*36e5;
const ipOf=req=>(hosted&&String(req.headers['x-real-ip']||req.headers['x-forwarded-for']||'').split(',')[0].trim())||req.socket.remoteAddress;
function limited(req,kind,max,ms){
 const k=kind+' '+ipOf(req),now=Date.now();let h=hits.get(k);
 if(!h||h.reset<=now){if(hits.size>20000)for(const [key,v] of hits)if(v.reset<=now)hits.delete(key);h={count:0,reset:now+ms};hits.set(k,h)}
 return ++h.count>max;
}
const cookieOf=req=>/(?:^|;\s*)paygate_session=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1];
function signedIn(req){
 if(!password)return true;
 const t=cookieOf(req),until=t&&sessions.get(t);
 if(until&&until>Date.now())return true;
 if(t)sessions.delete(t);return false;
}
const originOf=req=>origins.find(o=>new URL(o).host===req.headers.host)||origins[0];
const need=()=>{if(!vault)throw Error('No vault is connected. Deploy one with npm run vault:deploy and restart.')};
async function vaultView(){
 const [p,recipients,pending]=await Promise.all([vault.policy(),vault.recipients(),vault.pending()]);
 return {configured:true,network:vault.network,vault:vault.vault,owner:vault.owner,agent:p.agent,frozen:p.frozen,spendable:p.spendable,spent:p.spent,windowEndsMs:p.window_ends_ms,limits:p.limits,recipients,pending:pending.map(x=>({...x,amount:toNear(x.amount)}))};
}
const paying=new Set();
// Turns a request into what the server, the chain or NEAR AI did. Only these results reach the workspace.
async function act(c,req){
 const j=state.jobs.find(j=>j.id===c.id),key=j&&state.workspace+':'+j.id;
 if(CLIENT_ACTIONS.includes(c.action)){
  // A cancel landing while the payment is on its way would leave sent NEAR without a receipt.
  if(c.action==='cancel'&&paying.has(key))throw Error('This payment is in progress. Wait for it to finish.');
  if(c.action==='create'){delete c.allowed;delete c.max;delete c.available;if(vault){const p=await vault.policy();Object.assign(c,{allowed:await vault.recipients(),max:p.limits.max,available:p.spendable})}}
  return commit(c);
 }
 if(c.action==='run'){
  if(!hasInferenceKey())throw Error('Set NEAR_AI_API_KEY so the agent can do the work, or record the delivery yourself.');
  if(j?.status!=='Working')throw Error('Job is not in progress.');
  if(limited(req,'agent',30,36e5))throw Error('Too many agent runs. Try again later.');
  return commit({action:'complete',id:c.id,delivery:await deliver(j)});
 }
 if(c.action==='quote'){if(j?.status!=='Review')return state;return commit({action:'quote',id:c.id,quote:await usdValue(j)})}
 if(c.action==='pay'){
  need();if(!j)throw Error('Job not found.');if(j.status==='Awaiting approval')throw Error('This payment is waiting for your approval in your wallet.');if(j.status!=='Review')throw Error('Job must be awaiting review.');
  if((await vault.policy()).frozen)throw Error('The vault is frozen. Unfreeze it in Controls first.');
  if(paying.has(key))throw Error('This payment is already in progress.');
  paying.add(key);try{
   const r=await vault.request(j,key),settlement={network:vault.network,vault:vault.vault,paymentId:r.paymentId,amountYocto:r.amountYocto,requestTx:r.txHash};
   if(r.status==='sent')return commit({action:'paid',id:j.id,settlement:{...settlement,route:'auto',txHash:r.txHash,explorer:vault.explorer(r.txHash)}});
   return commit({action:'requested',id:j.id,payment:settlement});
  }finally{paying.delete(key)}
 }
 if(c.action==='confirm'){
  need();if(j?.status!=='Awaiting approval')throw Error('This job is not waiting for approval.');
  const {outcome,method}=await vault.confirmOwner(c.txHash,['approve_payment','reject_payment'],a=>a?.id===j.payment.paymentId);
  if(method==='reject_payment')return commit({action:'released',id:j.id});
  if(vault.found(outcome,'payment_failed',j.payment.paymentId))throw Error(`The transfer to ${j.payee} failed and the funds returned to the vault. Check that the account exists.`);
  return commit({action:'paid',id:j.id,settlement:{...j.payment,route:'owner-approved',txHash:c.txHash,explorer:vault.explorer(c.txHash)}});
 }
 if(c.action==='owner'){
  need();const back=new URL('/',originOf(req));back.searchParams.set('wallet',c.kind);
  const link=(method,args)=>vault.ownerLink(method,args,back.toString());
  if(c.kind==='approve'||c.kind==='reject'){if(j?.status!=='Awaiting approval')throw Error('This job is not waiting for approval.');back.searchParams.set('job',j.id);return {url:await link(c.kind+'_payment',{id:j.payment.paymentId})}}
  if(c.kind==='freeze'){if(typeof c.frozen!=='boolean')throw Error('Invalid freeze state.');return {url:await link('set_frozen',{frozen:c.frozen})}}
  if(c.kind==='payee'){if(!isAccountId(c.account))throw Error('Enter a valid NEAR account, such as name.near.');if(typeof c.allowed!=='boolean')throw Error('Invalid payee change.');return {url:await link('set_recipient',{recipient:c.account,allowed:c.allowed})}}
  const yocto=n=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0.0001||n>1e6)throw Error('Enter amounts in NEAR from 0.0001.');return String(BigInt(Math.round(n*1e4))*10n**20n)};
  if(c.kind==='limits'){const l={auto_limit:yocto(c.auto),max_payment:yocto(c.max),daily_limit:yocto(c.daily)};if(!(c.auto<=c.max&&c.max<=c.daily))throw Error('Limits must satisfy automatic ≤ maximum payment ≤ daily.');return {url:await link('set_limits',{limits:l})}}
  if(c.kind==='withdraw')return {url:await link('withdraw',{amount:yocto(c.amount)})};
  throw Error('Unknown owner action.');
 }
 throw Error('Unknown action.');
}
// Sandbox only: stands in for the wallet so local runs and tests take the same path as a real owner.
async function devSign(url,req,res){
 if(!devWallet)return false;
 const callback=new URL(url.searchParams.get('callbackUrl')||'/',originOf(req));if(callback.origin!==originOf(req))throw Error('Invalid callback.');
 const tx=decodeTransaction(Buffer.from(url.searchParams.get('transactions')||'','base64'));
 if(tx.signerId!==config.owner||tx.receiverId!==config.vault)throw Error('The local wallet signs only owner calls to the vault.');
 try{const r=await devWallet.signAndSendTransaction({receiverId:tx.receiverId,actions:tx.actions});callback.searchParams.set('transactionHashes',r.transaction.hash)}catch(e){callback.searchParams.set('errorCode','failed');callback.searchParams.set('errorMessage',reason(e))}
 res.writeHead(303,{Location:callback.pathname+callback.search});res.end();return true;
}
const routes={'/':'index.html','/app.js':'app.js','/style.css':'style.css'},types={html:'text/html',js:'text/javascript',css:'text/css'};
http.createServer(async(req,res)=>{
const json=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))};
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
if(hosted)res.setHeader('Strict-Transport-Security','max-age=31536000');
if(req.url==='/healthz'&&req.method==='GET')return json(200,{ok:true});if(!hosts.includes(req.headers.host))return json(403,{error:'Invalid host.'});
try{
const url=new URL(req.url,origins[0]),path=url.pathname,body=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw Error('Request too large.')}const c=JSON.parse(raw);if(!c||typeof c!=='object'||Array.isArray(c))throw Error();return c};
if(path.startsWith('/api/')&&req.method==='POST'&&(req.headers['x-paygate']!=='1'||(req.headers.origin&&!origins.includes(req.headers.origin))))return json(403,{error:'Request origin rejected.'});
if(path==='/api/session'&&req.method==='GET')return json(200,{authenticated:signedIn(req),passwordRequired:Boolean(password)});
if(path==='/api/login'&&req.method==='POST'){
 if(limited(req,'login',10,9e5))return json(429,{error:'Too many sign-in attempts. Try again in 15 minutes.'});
 let c;try{c=await body()}catch{return json(400,{error:'Invalid request.'})}
 if(!password||typeof c.password!=='string'||!timingSafeEqual(digest(c.password),digest(password)))return json(401,{error:'Wrong password.'});
 const t=randomBytes(32).toString('hex');sessions.set(t,Date.now()+SESSION_MS);for(const [k,v] of sessions)if(v<Date.now())sessions.delete(k);
 return json(200,{authenticated:true},{'Set-Cookie':`paygate_session=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS/1000}${hosted?'; Secure':''}`});
}
if(path==='/api/logout'&&req.method==='POST'){sessions.delete(cookieOf(req));return json(200,{authenticated:false},{'Set-Cookie':`paygate_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${hosted?'; Secure':''}`})}
if(path.startsWith('/api/')||path.startsWith('/dev-wallet/')){if(!signedIn(req))return json(401,{error:'Sign in first.'})}
if(path==='/dev-wallet/sign'&&req.method==='GET'){if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return json(403,{error:'Request origin rejected.'});if(await devSign(url,req,res))return;return json(404,{error:'Not found.'})}
if(path==='/api/state'&&req.method==='GET')return json(200,state);
if(path==='/api/verify'&&req.method==='GET')return json(200,{valid:verify(state.receipts),count:state.receipts.length});
if(path==='/api/integrations'&&req.method==='GET')return json(200,[{name:'NEAR spending vault',state:vault?'live':'off',detail:vault?`${vault.vault} on ${vault.network}`:'Not connected. Run npm run vault:deploy'},...integrations()]);
if(path==='/api/vault'&&req.method==='GET'){if(!vault)return json(200,{configured:false});try{return json(200,await vaultView())}catch(e){return json(502,{error:'Cannot reach the NEAR node: '+reason(e)})}}
if(path==='/api/attestation'&&req.method==='GET'){if(limited(req,'attestation',10,6e4))return json(429,{error:'Too many report checks. Try again in a minute.'});try{return json(200,await attestation())}catch(e){return json(502,{error:e.message})}}
if(path==='/api/action'&&req.method==='POST'){
 if(limited(req,'action',120,6e4))return json(429,{error:'Too many requests. Try again in a minute.'});
 let c;try{c=await body()}catch(e){return json(e.message==='Request too large.'?413:400,{error:e.message||'Invalid JSON.'})}
 // Results come only from the server, the chain or NEAR AI, never from the browser.
 for(const k of ['delivery','quote','settlement','payment'])delete c[k];
 if(['complete','requested','released','paid'].includes(c.action))return json(400,{error:'Unknown action.'});
 try{return json(200,await act(c,req))}catch(e){return json(400,{error:e.code==='ENOSPC'||e.code==='EACCES'?'Unable to save workspace.':reason(e)})}
}
if(req.method!=='GET')return json(405,{error:'Method not allowed.'});const name=routes[path];if(!name)return json(404,{error:'Not found.'});const data=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':types[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(data);
}catch(e){return json(400,{error:reason(e)||'Unable to complete request.'})}
}).on('error',e=>fail(e.code==='EADDRINUSE'?`Port ${port} is in use. Stop the other server or set PORT.`:e.message)).listen(port,env.HOST||(hosted?'0.0.0.0':'127.0.0.1'),()=>console.log(`PayGate → ${hosted?publicUrl:origins[0]}${vault?` · vault ${vault.vault} on ${vault.network}`:' · no vault connected'}${password?'':' · no password set'}`));
