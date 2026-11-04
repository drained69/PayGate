import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {KeyPair,decodeTransaction} from 'near-api-js';
import {transition,verify,CLIENT_ACTIONS} from './domain.mjs';
import {usdValue,attestation,deliver,integrations} from './near.mjs';
import {vaultClient,factoryClient,verifySignIn,signNep413,accountFor,reason,toNear,toYocto,isAccountId,NETWORKS} from './chain.mjs';
import {openStore} from './store.mjs';
import {sealer} from './secrets.mjs';
const env=process.env,port=Number(env.PORT||3000),root=new URL('./public/',import.meta.url);
const fail=message=>{console.error(message);process.exit(1)};
// A public URL means the server is reachable from the internet.
const publicUrl=env.PUBLIC_URL||(env.RAILWAY_PUBLIC_DOMAIN?'https://'+env.RAILWAY_PUBLIC_DOMAIN:''),hosted=Boolean(publicUrl);
const origins=[`http://localhost:${port}`,`http://127.0.0.1:${port}`,...(hosted?[new URL(publicUrl).origin]:[])],hosts=origins.map(o=>new URL(o).host);
const network=env.NEAR_NETWORK||'testnet';
if(!['mainnet','testnet','sandbox'].includes(network))fail('Set NEAR_NETWORK to mainnet, testnet or sandbox.');
if(network==='sandbox'&&!env.NEAR_RPC_URL)fail('A local node needs NEAR_RPC_URL.');
const rpcUrl=env.NEAR_RPC_URL||NETWORKS[network].rpcUrl,factoryId=env.PAYGATE_FACTORY||'';
if(factoryId&&!isAccountId(factoryId))fail('PAYGATE_FACTORY is not a valid account.');
// A local node has no wallet, so the server offers a stand-in wallet for its test accounts, and only there.
if(env.PAYGATE_DEV_ACCOUNTS&&network!=='sandbox')fail('Remove PAYGATE_DEV_ACCOUNTS. Test accounts are only allowed on a local node.');
const devAccounts=network==='sandbox'&&env.PAYGATE_DEV_ACCOUNTS?JSON.parse(env.PAYGATE_DEV_ACCOUNTS):null;
const walletUrl=devAccounts?'/dev-wallet':NETWORKS[network]?.wallet;
const dir=env.DATA_DIR?pathToFileURL(env.DATA_DIR+'/'):new URL('./data/',import.meta.url);
try{await mkdir(dir,{recursive:true,mode:0o700})}catch(e){fail(`Cannot create ${dir.pathname} (${e.code}). On Railway, attach a volume or set DATABASE_URL.`)}
// Customer keys are sealed with PAYGATE_SECRET. A local run without one keeps a generated secret in the data folder.
let secret=env.PAYGATE_SECRET;
if(!secret&&hosted)fail('Set PAYGATE_SECRET to a random value of at least 32 characters. It encrypts customer keys.');
if(!secret){const f=new URL('secret.key',dir);secret=await readFile(f,'utf8').catch(async()=>{const s=randomBytes(32).toString('hex');await writeFile(f,s,{mode:0o600});return s})}
let box;try{box=sealer(secret)}catch(e){fail(e.message)}
const store=await openStore({databaseUrl:env.DATABASE_URL,dir}).catch(e=>fail('Cannot open the database: '+e.message));
setInterval(()=>store.purge().catch(()=>{}),6e5).unref();
const factory=factoryId?factoryClient({rpcUrl,network,factory:factoryId,walletUrl}):null;
const provider=(factory||factoryClient({rpcUrl,network,factory:'none',walletUrl})).provider;
const explorer=NETWORKS[network]?.explorer||null;
const hits=new Map(),SESSION_MS=7*864e5,MESSAGE='Sign in to PayGate';
const ipOf=req=>(hosted&&String(req.headers['x-real-ip']||req.headers['x-forwarded-for']||'').split(',')[0].trim())||req.socket.remoteAddress;
function limited(key,max,ms){
 const now=Date.now();let h=hits.get(key);
 if(!h||h.reset<=now){if(hits.size>50000)for(const [k,v] of hits)if(v.reset<=now)hits.delete(k);h={count:0,reset:now+ms};hits.set(key,h)}
 return ++h.count>max;
}
const sha=s=>createHash('sha256').update(s).digest('hex');
const cookieOf=req=>/(?:^|;\s*)paygate_session=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1];
const cookie=(value,age)=>`paygate_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${hosted?'; Secure':''}`;
const signedIn=async req=>{const t=cookieOf(req);return t?store.session(sha(t)):null};
const originOf=req=>origins.find(o=>new URL(o).host===req.headers.host)||origins[0];
const callbackFor=req=>originOf(req)+'/wallet-callback.html';
const clients=new Map();
function vaultFor(account,profile){
 const v=profile.vault;if(!v)return null;
 const key=v.vault+v.agentKey;let c=clients.get(account);
 if(c?.key!==key){c={key,client:vaultClient({network,rpcUrl,vault:v.vault,agent:v.agent,owner:account,agentKey:box.open(v.agentKey),walletUrl})};clients.set(account,c)}
 return c.client;
}
const need=v=>{if(!v)throw Error('Create your vault first.');return v};
async function vaultView(v){
 const [p,recipients,pending]=await Promise.all([v.policy(),v.recipients(),v.pending()]);
 return {configured:true,network,vault:v.vault,owner:v.owner,agent:p.agent,frozen:p.frozen,spendable:p.spendable,spent:p.spent,windowEndsMs:p.window_ends_ms,limits:p.limits,recipients,pending:pending.map(x=>({...x,amount:toNear(x.amount)}))};
}
const amount=(n,label)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0.0001||n>1e6)throw Error(`Enter ${label} in NEAR from 0.0001.`);return toYocto(n)};
const validName=n=>typeof n==='string'&&n.length>=2&&n.length<=32&&/^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/.test(n)&&!n.endsWith('-agent');
// What the browser sees of an account: never a key, sealed or not.
async function snapshot(account){
 const r=await store.get(account),p=r?.profile||{};
 return {account,network,factory:factoryId||null,workspace:r?.workspace||null,vault:p.vault?{vault:p.vault.vault,agent:p.vault.agent,createdAt:p.vault.createdAt}:null,pending:p.pending?{name:p.pending.name}:null,aiKey:Boolean(p.aiKey),createdAt:p.createdAt||null};
}
const paying=new Set();
// Turns a request into what the server, the chain or NEAR AI did. Only these results reach the workspace.
async function act(c,account,req){
 const record=await store.get(account),profile=record?.profile||{},workspace=record?.workspace,v=vaultFor(account,profile);
 const commit=cmd=>store.update(account,r=>({...r,workspace:transition(r.workspace,cmd)})).then(()=>snapshot(account));
 const setProfile=fn=>store.update(account,r=>({...r,profile:fn({...r.profile})}));
 const j=workspace?.jobs.find(j=>j.id===c.id),key=j&&`${workspace.workspace}:${j.id}`;
 if(CLIENT_ACTIONS.includes(c.action)){
  if(c.action==='cancel'&&paying.has(key))throw Error('This payment is in progress. Wait for it to finish.');
  if(c.action==='create'){need(v);const p=await v.policy();Object.assign(c,{allowed:await v.recipients(),max:p.limits.max,available:p.spendable})}
  return commit(c);
 }
 if(c.action==='run'){
  if(!profile.aiKey)throw Error('Add your NEAR AI API key in Settings, or record the delivery yourself.');
  if(j?.status!=='Working')throw Error('Job is not in progress.');
  if(limited('agent '+account,30,36e5))throw Error('Too many agent runs. Try again later.');
  return commit({action:'complete',id:c.id,delivery:await deliver(j,box.open(profile.aiKey))});
 }
 if(c.action==='quote'){if(j?.status!=='Review')return snapshot(account);return commit({action:'quote',id:c.id,quote:await usdValue(j)})}
 if(c.action==='pay'){
  need(v);if(!j)throw Error('Job not found.');if(j.status==='Awaiting approval')throw Error('This payment is waiting for your approval in your wallet.');if(j.status!=='Review')throw Error('Job must be awaiting review.');
  if((await v.policy()).frozen)throw Error('The vault is frozen. Unfreeze it in Controls first.');
  if(paying.has(key))throw Error('This payment is already in progress.');
  paying.add(key);try{
   const r=await v.request(j,key),settlement={network,vault:v.vault,paymentId:r.paymentId,amountYocto:r.amountYocto,requestTx:r.txHash};
   if(r.status==='sent')return commit({action:'paid',id:j.id,settlement:{...settlement,route:'auto',txHash:r.txHash,explorer:v.explorer(r.txHash)}});
   return commit({action:'requested',id:j.id,payment:settlement});
  }finally{paying.delete(key)}
 }
 if(c.action==='confirm'){
  need(v);if(j?.status!=='Awaiting approval')throw Error('This job is not waiting for approval.');
  const {outcome,method}=await v.confirmOwner(c.txHash,['approve_payment','reject_payment'],a=>a?.id===j.payment.paymentId);
  if(method==='reject_payment')return commit({action:'released',id:j.id});
  if(v.found(outcome,'payment_failed',j.payment.paymentId))throw Error(`The transfer to ${j.payee} failed and the funds returned to the vault. Check that the account exists.`);
  return commit({action:'paid',id:j.id,settlement:{...j.payment,route:'owner-approved',txHash:c.txHash,explorer:v.explorer(c.txHash)}});
 }
 if(c.action==='owner'){
  need(v);const link=(method,args)=>v.ownerLink(method,args,callbackFor(req));
  if(c.kind==='approve'||c.kind==='reject'){if(j?.status!=='Awaiting approval')throw Error('This job is not waiting for approval.');return {url:await link(c.kind+'_payment',{id:j.payment.paymentId})}}
  if(c.kind==='freeze'){if(typeof c.frozen!=='boolean')throw Error('Invalid freeze state.');return {url:await link('set_frozen',{frozen:c.frozen})}}
  if(c.kind==='payee'){if(!isAccountId(c.account))throw Error('Enter a valid NEAR account, such as name.near.');if(typeof c.allowed!=='boolean')throw Error('Invalid payee change.');return {url:await link('set_recipient',{recipient:c.account,allowed:c.allowed})}}
  if(c.kind==='limits'){const l={auto_limit:amount(c.auto,'limits'),max_payment:amount(c.max,'limits'),daily_limit:amount(c.daily,'limits')};if(!(c.auto<=c.max&&c.max<=c.daily))throw Error('Limits must satisfy automatic ≤ maximum payment ≤ daily.');return {url:await link('set_limits',{limits:l})}}
  if(c.kind==='withdraw')return {url:await link('withdraw',{amount:amount(c.amount,'an amount')})};
  throw Error('Unknown owner action.');
 }
 if(c.action==='vault-create'){
  if(!factory)throw Error('This PayGate server has no factory configured yet.');
  if(v)throw Error('You already have a vault.');
  if(!validName(c.name))throw Error('Use 2 to 32 lowercase letters, digits or single dashes for the vault name. It cannot end in -agent.');
  const limits={auto_limit:amount(c.auto,'limits'),max_payment:amount(c.max,'limits'),daily_limit:amount(c.daily,'limits')};
  if(!(c.auto<=c.max&&c.max<=c.daily))throw Error('Limits must satisfy automatic ≤ maximum payment ≤ daily.');
  if(typeof c.fund!=='number'||!(c.fund>=0.4)||c.fund>1e6)throw Error('Fund the vault with at least 0.4 NEAR: 0.3 pays for the agent account and its gas.');
  const payees=[...new Set((Array.isArray(c.payees)?c.payees:[]).map(p=>String(p).trim().toLowerCase()).filter(Boolean))];
  if(payees.length>20)throw Error('Add at most 20 payees now. You can add more later.');
  for(const p of payees){if(!isAccountId(p))throw Error(`${p} is not a valid NEAR account.`);if(!await factory.exists(p))throw Error(`${p} does not exist on ${network}. A payment to it would fail.`)}
  if(await factory.exists(`${c.name}.${factory.factory}`))throw Error(`The vault name ${c.name} is taken. Choose another.`);
  const agentKey=KeyPair.fromRandom('ed25519'),publicKey=agentKey.getPublicKey().toString();
  await setProfile(p=>({...p,pending:{name:c.name,publicKey,agentKey:box.seal(agentKey.toString()),createdAt:new Date().toISOString()}}));
  return {url:await factory.createLink({owner:account,name:c.name,agentKey:publicKey,limits,payees,fund:c.fund,callbackUrl:callbackFor(req)})};
 }
 if(c.action==='vault-confirm'){
  if(v)throw Error('You already have a vault.');
  const p=profile.pending;if(!p)throw Error('Start creating a vault first.');
  try{
   const {vault,agent}=await factory.confirmCreated(c.txHash,{owner:account,name:p.name,agentKey:p.publicKey});
   await setProfile(x=>{const n={...x,vault:{vault,agent,agentKey:p.agentKey,createdAt:new Date().toISOString()}};delete n.pending;return n});
  }catch(e){if(/taken|was not/.test(e.message))await setProfile(x=>{delete x.pending;return x});throw e}
  return snapshot(account);
 }
 if(c.action==='vault-cancel'){await setProfile(x=>{delete x.pending;return x});return snapshot(account)}
 if(c.action==='ai-key'){
  if(c.key===''){await setProfile(x=>{delete x.aiKey;return x});return snapshot(account)}
  if(typeof c.key!=='string'||c.key.trim().length<10||c.key.length>500)throw Error('Paste the API key from cloud.near.ai.');
  await setProfile(x=>({...x,aiKey:box.seal(c.key.trim())}));return snapshot(account);
 }
 if(c.action==='delete-account'){
  if(c.confirm!==account)throw Error('Type your account name to confirm.');
  await store.remove(account);clients.delete(account);return {deleted:true};
 }
 throw Error('Unknown action.');
}
// Local node only: stands in for the wallet so local runs and tests take the same path as a real customer.
async function devWallet(url,req,res){
 if(!devAccounts||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return false;
 const callback=new URL(url.searchParams.get('callbackUrl')||'/',originOf(req));if(callback.origin!==originOf(req))throw Error('Invalid callback.');
 const back=()=>{res.writeHead(303,{Location:callback.pathname+callback.search+callback.hash});res.end();return true};
 if(url.pathname==='/dev-wallet/sign'){
  const tx=decodeTransaction(Buffer.from(url.searchParams.get('transactions')||'','base64')),key=devAccounts[tx.signerId];
  if(!key)throw Error('The local wallet has no key for '+tx.signerId+'.');
  try{const r=await accountFor(rpcUrl,tx.signerId,key).signAndSendTransaction({receiverId:tx.receiverId,actions:tx.actions});callback.searchParams.set('transactionHashes',r.transaction.hash)}catch{callback.searchParams.set('errorCode','failed')}
  return back();
 }
 if(url.pathname==='/dev-wallet/sign-message'){
  const account=url.searchParams.get('account');
  if(!account){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><title>Local wallet</title><body style="font-family:sans-serif;padding:24px"><h1>Local wallet</h1><p>Choose an account to sign in with.</p>${Object.keys(devAccounts).map(a=>{const u=new URL(url);u.searchParams.set('account',a);return `<p><a href="${u.pathname+u.search}">${a}</a></p>`}).join('')}</body>`);return true}
  const key=devAccounts[account];if(!key)throw Error('Unknown local account.');
  const payload={message:url.searchParams.get('message'),nonce:Buffer.from(url.searchParams.get('nonce'),'base64'),recipient:url.searchParams.get('recipient'),callbackUrl:url.searchParams.get('callbackUrl')};
  callback.hash=new URLSearchParams({accountId:account,publicKey:KeyPair.fromString(key).getPublicKey().toString(),signature:signNep413(key,payload)}).toString();
  return back();
 }
 return false;
}
const routes={'/':'index.html','/app.js':'app.js','/docs.js':'docs.js','/legal.js':'legal.js','/style.css':'style.css','/wallet-callback.html':'wallet-callback.html','/callback.js':'callback.js'},types={html:'text/html',js:'text/javascript',css:'text/css'};
http.createServer(async(req,res)=>{
const json=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))};
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
if(hosted)res.setHeader('Strict-Transport-Security','max-age=31536000');
if(req.url==='/healthz'&&req.method==='GET')return json(200,{ok:true});if(!hosts.includes(req.headers.host))return json(403,{error:'Invalid host.'});
try{
const url=new URL(req.url,origins[0]),path=url.pathname,ip=ipOf(req),body=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw Error('Request too large.')}const c=JSON.parse(raw);if(!c||typeof c!=='object'||Array.isArray(c))throw Error();return c};
if(path.startsWith('/dev-wallet/')&&req.method==='GET'){if(await devWallet(url,req,res))return;return json(404,{error:'Not found.'})}
if(path.startsWith('/api/')&&req.method==='POST'&&(req.headers['x-paygate']!=='1'||(req.headers.origin&&!origins.includes(req.headers.origin))))return json(403,{error:'Request origin rejected.'});
if(path==='/api/config'&&req.method==='GET')return json(200,{network,factory:factoryId||null,ready:Boolean(factoryId),walletUrl,explorer,minDeposit:0.4});
if(path==='/api/session'&&req.method==='GET')return json(200,{account:await signedIn(req)});
if(path==='/api/auth/challenge'&&req.method==='POST'){
 if(limited('challenge '+ip,30,6e5))return json(429,{error:'Too many sign-in attempts. Try again in a few minutes.'});
 const nonce=randomBytes(32).toString('base64');await store.addNonce(nonce,Date.now()+3e5);
 return json(200,{message:MESSAGE,nonce,recipient:new URL(originOf(req)).host,callbackUrl:callbackFor(req),walletUrl});
}
if(path==='/api/auth/verify'&&req.method==='POST'){
 if(limited('verify '+ip,20,6e5))return json(429,{error:'Too many sign-in attempts. Try again in a few minutes.'});
 let c;try{c=await body()}catch{return json(400,{error:'Invalid request.'})}
 if(typeof c.nonce!=='string'||!await store.useNonce(c.nonce))return json(401,{error:'This sign-in request expired. Try again.'});
 try{await verifySignIn(provider,{accountId:c.accountId,publicKey:c.publicKey,signature:c.signature,message:MESSAGE,nonce:Buffer.from(c.nonce,'base64'),recipient:new URL(originOf(req)).host,callbackUrl:callbackFor(req)})}catch(e){return json(401,{error:e.message})}
 await store.update(c.accountId,r=>r);
 const t=randomBytes(32).toString('hex');await store.addSession(sha(t),c.accountId,Date.now()+SESSION_MS);
 return json(200,{account:c.accountId},{'Set-Cookie':cookie(t,SESSION_MS/1000)});
}
if(path==='/api/logout'&&req.method==='POST'){const t=cookieOf(req);if(t)await store.dropSession(sha(t));return json(200,{account:null},{'Set-Cookie':cookie('',0)})}
if(path.startsWith('/api/')){
 const account=await signedIn(req);if(!account)return json(401,{error:'Sign in first.'});
 if(path==='/api/state'&&req.method==='GET')return json(200,await snapshot(account));
 if(path==='/api/verify'&&req.method==='GET'){const w=(await store.get(account))?.workspace;return json(200,{valid:verify(w?.receipts||[]),count:w?.receipts.length||0})}
 if(path==='/api/integrations'&&req.method==='GET'){const r=await store.get(account),v=r?.profile?.vault;return json(200,[{name:'NEAR spending vault',state:v?'live':'off',detail:v?`${v.vault} on ${network}`:'Create your vault to start paying'},...integrations(Boolean(r?.profile?.aiKey))])}
 if(path==='/api/vault'&&req.method==='GET'){const r=await store.get(account),v=vaultFor(account,r?.profile||{});if(!v)return json(200,{configured:false});try{return json(200,await vaultView(v))}catch(e){return json(502,{error:'Cannot reach the NEAR node: '+reason(e)})}}
 if(path==='/api/attestation'&&req.method==='GET'){if(limited('attestation '+account,10,6e4))return json(429,{error:'Too many report checks. Try again in a minute.'});try{return json(200,await attestation())}catch(e){return json(502,{error:e.message})}}
 if(path==='/api/action'&&req.method==='POST'){
  if(limited('action '+account,120,6e4))return json(429,{error:'Too many requests. Try again in a minute.'});
  let c;try{c=await body()}catch(e){return json(e.message==='Request too large.'?413:400,{error:e.message||'Invalid JSON.'})}
  // Results come only from the server, the chain or NEAR AI, never from the browser.
  for(const k of ['delivery','quote','settlement','payment'])delete c[k];
  if(c.action==='create')for(const k of ['allowed','max','available'])delete c[k];
  if(['complete','requested','released','paid'].includes(c.action))return json(400,{error:'Unknown action.'});
  try{const out=await act(c,account,req);return json(200,out,out?.deleted?{'Set-Cookie':cookie('',0)}:{})}catch(e){return json(400,{error:reason(e)})}
 }
 return json(404,{error:'Not found.'});
}
if(req.method!=='GET')return json(405,{error:'Method not allowed.'});const name=routes[path]||(!path.includes('.')?'index.html':null);if(!name)return json(404,{error:'Not found.'});const data=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':types[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(data);
}catch(e){return json(400,{error:reason(e)||'Unable to complete request.'})}
}).on('error',e=>fail(e.code==='EADDRINUSE'?`Port ${port} is in use. Stop the other server or set PORT.`:e.message)).listen(port,env.HOST||(hosted?'0.0.0.0':'127.0.0.1'),()=>console.log(`PayGate → ${hosted?publicUrl:origins[0]} · ${network}${factoryId?' · factory '+factoryId:' · no factory'} · ${store.kind} storage`));
