import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {KeyPair,decodeTransaction} from 'near-api-js';
import {transition,verify,CLIENT_ACTIONS} from './domain.mjs';
import {usdValue,attestation,deliver,integrations} from './near.mjs';
import {vaultClient,factoryClient,verifySignIn,signNep413,accountFor,reason,toNear,toYocto,toUnits,isAccountId,NETWORKS,USDC,TOKEN_STORAGE} from './chain.mjs';
import {openStore} from './store.mjs';
import {sealer} from './secrets.mjs';
import {checkWebhook,sendWebhook,telegram} from './alerts.mjs';
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
// On testnet and mainnet, customers connect their own wallet through NEAR Connect in the browser.
const walletUrl=devAccounts?'/dev-wallet':null;
const dir=env.DATA_DIR?pathToFileURL(env.DATA_DIR+'/'):new URL('./data/',import.meta.url);
try{await mkdir(dir,{recursive:true,mode:0o700})}catch(e){fail(`Cannot create ${dir.pathname} (${e.code}). On Railway, attach a volume or set DATABASE_URL.`)}
// Customer keys are sealed with PAYGATE_SECRET. A local run without one keeps a generated secret in the data folder.
let secret=env.PAYGATE_SECRET;
if(!secret&&hosted)fail('Set PAYGATE_SECRET to a random value of at least 32 characters. It encrypts customer keys.');
if(!secret){const f=new URL('secret.key',dir);secret=await readFile(f,'utf8').catch(async()=>{const s=randomBytes(32).toString('hex');await writeFile(f,s,{mode:0o600});return s})}
let box;try{box=sealer(secret)}catch(e){fail(e.message)}
const raw=await openStore({databaseUrl:env.DATABASE_URL,dir}).catch(e=>fail('Cannot open the database: '+e.message));
// Each network keeps its own customers: a testnet vault must never appear on mainnet, and implicit accounts share names
// across networks. Testnet keys stay unprefixed so the existing testnet beta keeps its data.
const scope=a=>network==='testnet'?a:`${network}/${a}`,mine=k=>network==='testnet'?!k.includes('/'):k.startsWith(network+'/');
const store={...raw,get:a=>raw.get(scope(a)),update:(a,fn)=>raw.update(scope(a),fn),remove:a=>raw.remove(scope(a)),addSession:(h,a,e)=>raw.addSession(h,scope(a),e),
 async session(h){const k=await raw.session(h);return k&&mine(k)?k.slice(network==='testnet'?0:network.length+1):null},
 addApiKey:(h,a)=>raw.addApiKey(h,scope(a)),
 async apiKey(h){const k=await raw.apiKey(h);return k&&mine(k)?k.slice(network==='testnet'?0:network.length+1):null}};
setInterval(()=>store.purge().catch(()=>{}),6e5).unref();
const factory=factoryId?factoryClient({rpcUrl,network,factory:factoryId,walletUrl}):null;
// Optional gas relayer: an operator account holding only gas money pays for agents' payment requests.
if(Boolean(env.PAYGATE_RELAYER_ACCOUNT)!==Boolean(env.PAYGATE_RELAYER_KEY))fail('Set both PAYGATE_RELAYER_ACCOUNT and PAYGATE_RELAYER_KEY, or neither.');
if(env.PAYGATE_RELAYER_ACCOUNT&&(!isAccountId(env.PAYGATE_RELAYER_ACCOUNT)||!/^ed25519:/.test(env.PAYGATE_RELAYER_KEY)))fail('PAYGATE_RELAYER_ACCOUNT or PAYGATE_RELAYER_KEY is not valid.');
const relayer=env.PAYGATE_RELAYER_ACCOUNT?{accountId:env.PAYGATE_RELAYER_ACCOUNT,key:env.PAYGATE_RELAYER_KEY}:null;
// USDC budgets: vaults can hold Circle's USDC on this network instead of NEAR.
const usdc=env.PAYGATE_USDC||USDC[network]||null;
if(usdc&&!isAccountId(usdc))fail('PAYGATE_USDC is not a valid account.');
// Only factories built with token support can create USDC vaults; older ones would silently create NEAR vaults.
let factoryTokens=false;
const provider=(factory||factoryClient({rpcUrl,network,factory:'none',walletUrl})).provider;
if(factory)factory.config().then(c=>{factoryTokens=c?.tokens===true}).catch(()=>{});
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
 if(c?.key!==key){c={key,client:vaultClient({network,rpcUrl,vault:v.vault,agent:v.agent,owner:account,agentKey:box.open(v.agentKey),walletUrl,relayer,token:v.token||null,decimals:v.decimals,symbol:v.symbol})};clients.set(account,c)}
 return c.client;
}
const need=v=>{if(!v)throw Error('Create your vault first.');return v};
async function vaultView(v){
 const [p,recipients,pending]=await Promise.all([v.policy(),v.recipients(),v.pending()]);
 return {configured:true,network,vault:v.vault,owner:v.owner,agent:p.agent,frozen:p.frozen,spendable:p.spendable,spent:p.spent,windowEndsMs:p.window_ends_ms,limits:p.limits,recipients,currency:v.symbol,token:v.token,registered:await v.registered(recipients),pending:pending.map(x=>({...x,amount:v.fromUnits(x.amount)}))};
}
const amount=(n,label,decimals=24)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0.0001||n>1e9)throw Error(`Enter ${label} from 0.0001.`);return toUnits(n,decimals)};
const validName=n=>typeof n==='string'&&n.length>=2&&n.length<=32&&/^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/.test(n)&&!n.endsWith('-agent');
// What the browser sees of an account: never a key, sealed or not.
async function snapshot(account){
 const r=await store.get(account),p=r?.profile||{};
 return {account,network,factory:factoryId||null,workspace:r?.workspace||null,vault:p.vault?{vault:p.vault.vault,agent:p.vault.agent,currency:p.vault.symbol||'NEAR',createdAt:p.vault.createdAt}:null,pending:p.pending?{name:p.pending.name}:null,aiKey:Boolean(p.aiKey),apiKeys:(p.apiKeys||[]).map(({hash,...k})=>k),alerts:{webhook:p.alerts?.webhook?.host||null,telegram:p.alerts?.telegram?.name||null,last:p.alerts?.last||null},createdAt:p.createdAt||null};
}
// Alerts: a customer's webhook and Telegram. Failures are recorded for the customer to see, never thrown at the action that caused them.
const allowPrivate=network==='sandbox'&&env.PAYGATE_ALLOW_PRIVATE_WEBHOOKS==='1';
const tg=env.TELEGRAM_BOT_TOKEN?telegram(env.TELEGRAM_BOT_TOKEN,{base:env.TELEGRAM_API_URL}):null,tgCodes=new Map();let tgBot=null;
const appUrl=()=>publicUrl||origins[0];
async function notify(account,event,text,data={}){
 const r=await store.get(account),a=r?.profile?.alerts;if(!a)return;
 const link=data.jobId?`${appUrl()}/?job=${encodeURIComponent(data.jobId)}`:appUrl(),full=`${text}\n${link}`,errors=[];
 if(a.webhook)await sendWebhook({url:box.open(a.webhook.url),secret:box.open(a.webhook.secret),event,text:full,data:{...data,link},allowPrivate}).catch(e=>errors.push('Webhook: '+e.message));
 if(a.telegram&&tg)await tg.send(a.telegram.chatId,full).catch(e=>errors.push(e.message));
 await store.update(account,x=>({...x,profile:{...x.profile,alerts:{...x.profile.alerts,last:{event,at:new Date().toISOString(),error:errors.join(' ')||null}}}})).catch(()=>{});
}
const alert=(...args)=>{notify(...args).catch(()=>{})};
async function telegramUpdate(u){
 const m=u.message,code=/^\/start\s+([A-Za-z0-9_-]{16,64})$/.exec(m?.text||'')?.[1];if(!m?.chat?.id)return;
 const pending=code&&tgCodes.get(code);
 if(!pending||pending.until<Date.now()){await tg.send(m.chat.id,'Open PayGate, go to Settings → Alerts and select Connect Telegram to link this chat.').catch(()=>{});return}
 tgCodes.delete(code);
 await store.update(pending.account,x=>({...x,profile:{...x.profile,alerts:{...x.profile.alerts,telegram:{chatId:m.chat.id,name:m.chat.username||m.chat.first_name||'Telegram'}}}}));
 await tg.send(m.chat.id,`Connected to PayGate for ${pending.account}. You will get a message when a payment needs your approval.`).catch(()=>{});
}
// Hosted servers receive Telegram updates by webhook, checked with a secret header; local runs poll.
const tgPath='/telegram/'+sha('telegram-path:'+secret).slice(0,32),tgSecret=sha('telegram-secret:'+secret).slice(0,48);
if(tg){
 tg.call('getMe').then(async me=>{tgBot=me.username;
  if(hosted)await tg.call('setWebhook',{url:publicUrl+tgPath,secret_token:tgSecret,allowed_updates:['message']});
  else{await tg.call('deleteWebhook').catch(()=>{});let offset=0;(async function poll(){try{for(const u of await tg.call('getUpdates',{offset,timeout:25,allowed_updates:['message']})){offset=u.update_id+1;await telegramUpdate(u)}}catch{await new Promise(d=>setTimeout(d,5000))}setTimeout(poll,100)})()}
 }).catch(e=>console.error('Telegram alerts are off: '+e.message));
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
 if(c.action==='quote'){if(j?.status!=='Review')return snapshot(account);return commit({action:'quote',id:c.id,quote:v?.token?{source:'USDC',usd:j.amount,usdc:String(j.amount)}:await usdValue(j)})}
 if(c.action==='pay'){
  need(v);if(!j)throw Error('Job not found.');if(j.status==='Awaiting approval')throw Error('This payment is waiting for your approval in your wallet.');if(j.status!=='Review')throw Error('Job must be awaiting review.');
  if((await v.policy()).frozen)throw Error('The vault is frozen. Unfreeze it in Controls first.');
  if(paying.has(key))throw Error('This payment is already in progress.');
  paying.add(key);try{
   const r=await v.request(j,key),settlement={network,vault:v.vault,currency:v.symbol,token:v.token,paymentId:r.paymentId,amountUnits:r.amountYocto,requestTx:r.txHash};
   if(r.status==='sent'){alert(account,'payment.paid',`PayGate: paid ${j.amount} ${v.symbol} to ${j.payee} for "${j.title}".`,{jobId:j.id,amount:j.amount,payee:j.payee,txHash:r.txHash});return commit({action:'paid',id:j.id,settlement:{...settlement,route:'auto',txHash:r.txHash,explorer:v.explorer(r.txHash)}})}
   alert(account,'payment.held',`PayGate: ${j.amount} ${v.symbol} to ${j.payee} for "${j.title}" is waiting for your approval.`,{jobId:j.id,amount:j.amount,payee:j.payee,paymentId:r.paymentId});
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
  if(c.kind==='approve'||c.kind==='reject'){if(j?.status!=='Awaiting approval')throw Error('This job is not waiting for approval.');return link(c.kind+'_payment',{id:j.payment.paymentId})}
  if(c.kind==='freeze'){if(typeof c.frozen!=='boolean')throw Error('Invalid freeze state.');return link('set_frozen',{frozen:c.frozen})}
  if(c.kind==='payee'){if(!isAccountId(c.account))throw Error('Enter a valid NEAR account, such as name.near.');if(typeof c.allowed!=='boolean')throw Error('Invalid payee change.');return link('set_recipient',{recipient:c.account,allowed:c.allowed})}
  if(c.kind==='limits'){const l={auto_limit:amount(c.auto,'limits',v.decimals),max_payment:amount(c.max,'limits',v.decimals),daily_limit:amount(c.daily,'limits',v.decimals)};if(!(c.auto<=c.max&&c.max<=c.daily))throw Error('Limits must satisfy automatic ≤ maximum payment ≤ daily.');return link('set_limits',{limits:l})}
  if(c.kind==='withdraw')return link('withdraw',{amount:amount(c.amount,'an amount',v.decimals)});
  // USDC deposits register the vault with the token and send the USDC in one wallet transaction.
  if(c.kind==='deposit'){if(!v.token)throw Error('Send NEAR to the vault account from any wallet.');return v.tokenLink([{method:'storage_deposit',args:{account_id:v.vault,registration_only:true},deposit:TOKEN_STORAGE},{method:'ft_transfer_call',args:{receiver_id:v.vault,amount:amount(c.amount,'an amount',v.decimals),msg:''},deposit:'1',gas:100000000000000n}],callbackFor(req))}
  if(c.kind==='register'){if(!v.token)throw Error('NEAR vaults need no registration.');if(!isAccountId(c.account))throw Error('Invalid account.');return v.tokenLink([{method:'storage_deposit',args:{account_id:c.account,registration_only:true},deposit:TOKEN_STORAGE}],callbackFor(req))}
  throw Error('Unknown owner action.');
 }
 if(c.action==='vault-create'){
  if(!factory)throw Error('This PayGate server has no factory configured yet.');
  if(v)throw Error('You already have a vault.');
  if(!validName(c.name))throw Error('Use 2 to 32 lowercase letters, digits or single dashes for the vault name. It cannot end in -agent.');
  const token=c.currency==='USDC'?usdc:null;if(c.currency==='USDC'&&!(usdc&&factoryTokens))throw Error('USDC vaults are not available on this PayGate yet.');
  const dec=token?6:24,limits={auto_limit:amount(c.auto,'limits',dec),max_payment:amount(c.max,'limits',dec),daily_limit:amount(c.daily,'limits',dec)};
  if(!(c.auto<=c.max&&c.max<=c.daily))throw Error('Limits must satisfy automatic ≤ maximum payment ≤ daily.');
  if(typeof c.fund!=='number'||!(c.fund>=0.4)||c.fund>1e6)throw Error('Fund the vault with at least 0.4 NEAR: 0.3 pays for the agent account and its gas.');
  const payees=[...new Set((Array.isArray(c.payees)?c.payees:[]).map(p=>String(p).trim().toLowerCase()).filter(Boolean))];
  if(payees.length>20)throw Error('Add at most 20 payees now. You can add more later.');
  for(const p of payees){if(!isAccountId(p))throw Error(`${p} is not a valid NEAR account.`);if(!await factory.exists(p))throw Error(`${p} does not exist on ${network}. A payment to it would fail.`)}
  if(await factory.exists(`${c.name}.${factory.factory}`))throw Error(`The vault name ${c.name} is taken. Choose another.`);
  const agentKey=KeyPair.fromRandom('ed25519'),publicKey=agentKey.getPublicKey().toString();
  // Earlier attempts are kept: a wallet may still sign an older link, and its agent key must not be lost.
  await setProfile(p=>({...p,pending:{name:c.name,publicKey,agentKey:box.seal(agentKey.toString()),createdAt:new Date().toISOString()},attempts:[{name:c.name,publicKey,agentKey:box.seal(agentKey.toString()),token},...(p.attempts||[])].slice(0,5)}));
  return factory.createLink({owner:account,name:c.name,agentKey:publicKey,limits,payees,fund:c.fund,token,callbackUrl:callbackFor(req)});
 }
 if(c.action==='vault-confirm'){
  if(v)throw Error('You already have a vault.');
  const attempts=profile.attempts||(profile.pending?[profile.pending]:[]);if(!attempts.length)throw Error('Start creating a vault first.');
  if(!factory)throw Error('This PayGate server has no factory configured yet.');
  // The vault's currency is read from the chain, not taken from the request.
  const save=async(a,{vault,agent})=>{const token=(await provider.callFunction({contractId:vault,method:'get_policy',args:{},blockQuery:{finality:'optimistic'}}).catch(()=>({})))?.token||null;if(token&&token!==usdc)throw Error('That vault holds a token PayGate does not support.');return setProfile(x=>{const n={...x,vault:{vault,agent,agentKey:a.agentKey,token,decimals:token?6:24,symbol:token?'USDC':'NEAR',createdAt:new Date().toISOString()}};delete n.pending;delete n.attempts;return n})};
  // With a hash, the transaction is checked; without one, the chain itself is read. Either way the result must match an agent key PayGate issued.
  if(!c.txHash){for(const a of attempts){const found=await factory.findCreated({owner:account,name:a.name,agentKey:a.publicKey});if(found){await save(a,found);return snapshot(account)}}throw Error('Your vault is not on-chain yet. If you signed in your wallet, wait a moment and check again.')}
  let last;
  for(const a of attempts){try{await save(a,await factory.confirmCreated(c.txHash,{owner:account,name:a.name,agentKey:a.publicKey}));return snapshot(account)}catch(e){last=e;if(/taken|was not/.test(e.message))break}}
  if(/taken|was not/.test(last?.message))await setProfile(x=>{delete x.pending;delete x.attempts;return x});
  throw last;
 }
 if(c.action==='vault-cancel'){await setProfile(x=>{delete x.pending;return x});return snapshot(account)}
 if(c.action==='alerts-webhook'){
  if(c.url===''){await setProfile(x=>{const a={...x.alerts};delete a.webhook;return {...x,alerts:a}});return snapshot(account)}
  const url=await checkWebhook(c.url,{allowPrivate}),signing=randomBytes(24).toString('base64url');
  await sendWebhook({url,secret:signing,event:'alerts.test',text:'PayGate alerts are connected. You will hear here when a payment needs your approval.',data:{},allowPrivate});
  await setProfile(x=>({...x,alerts:{...x.alerts,webhook:{url:box.seal(url),secret:box.seal(signing),host:new URL(url).hostname}}}));
  return {...await snapshot(account),signingSecret:signing};
 }
 if(c.action==='alerts-telegram'){
  if(c.remove===true){await setProfile(x=>{const a={...x.alerts};delete a.telegram;return {...x,alerts:a}});return snapshot(account)}
  if(!tg||!tgBot)throw Error('Telegram alerts are not set up on this server.');
  const code=randomBytes(18).toString('base64url');tgCodes.set(code,{account,until:Date.now()+6e5});
  for(const [k,v] of tgCodes)if(v.until<Date.now())tgCodes.delete(k);
  return {...await snapshot(account),telegramLink:`https://t.me/${tgBot}?start=${code}`};
 }
 if(c.action==='alerts-test'){if(!profile.alerts?.webhook&&!profile.alerts?.telegram)throw Error('Connect a webhook or Telegram first.');await notify(account,'alerts.test','PayGate test alert: this is how payment approvals will reach you.');return snapshot(account)}
 if(c.action==='ai-key'){
  if(c.key===''){await setProfile(x=>{delete x.aiKey;return x});return snapshot(account)}
  if(typeof c.key!=='string'||c.key.trim().length<10||c.key.length>500)throw Error('Paste the API key from cloud.near.ai.');
  await setProfile(x=>({...x,aiKey:box.seal(c.key.trim())}));return snapshot(account);
 }
 if(c.action==='api-key-create'){
  const name=typeof c.name==='string'?c.name.trim():'';if(!name||name.length>40)throw Error('Name the key, for example "Research agent".');
  if((profile.apiKeys||[]).length>=10)throw Error('You can have at most 10 API keys. Revoke one first.');
  // Shown once. Only its SHA-256 hash is stored.
  const key=`pg_${network==='mainnet'?'live':'test'}_${randomBytes(24).toString('base64url')}`,hash=sha(key);
  await store.addApiKey(hash,account);
  await setProfile(x=>({...x,apiKeys:[...(x.apiKeys||[]),{id:hash.slice(0,12),hash,name,pay:c.pay===true,prefix:key.slice(0,12),createdAt:new Date().toISOString()}]}));
  return {...await snapshot(account),newKey:key};
 }
 if(c.action==='api-key-revoke'){
  const k=(profile.apiKeys||[]).find(k=>k.id===c.id);if(!k)throw Error('Key not found.');
  await raw.dropApiKey(k.hash);await setProfile(x=>({...x,apiKeys:(x.apiKeys||[]).filter(y=>y.id!==c.id)}));return snapshot(account);
 }
 if(c.action==='delete-account'){
  if(c.confirm!==account)throw Error('Type your account name to confirm.');
  for(const k of profile.apiKeys||[])await raw.dropApiKey(k.hash);
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
// Agent API: REST under /api/v1 and an MCP server at /mcp, both authenticated with a customer's API key.
// Agents run the same actions, rules and on-chain checks as the dashboard. They can never approve, freeze,
// change limits or payees, or withdraw: those stay with the owner's wallet.
const jobView=(w,j,currency='NEAR')=>{const r=w.receipts.find(r=>r.jobId===j.id);return {id:j.id,title:j.title,brief:j.brief,payee:j.payee,amount:j.amount,currency,status:j.status,created:j.created,delivery:j.deliverable||null,payment:j.payment?{id:j.payment.paymentId,awaitingApproval:j.status==='Awaiting approval'}:null,receipt:r?{route:r.settlement.route,txHash:r.settlement.txHash,explorer:r.settlement.explorer,paidAt:r.date}:null}};
async function agentCall(account,key,name,a={}){
 const cur=(await store.get(account))?.profile?.vault?.symbol||'NEAR',view=(w,j)=>jobView(w,j,cur);
 const job=async id=>{const w=(await snapshot(account)).workspace,j=w?.jobs.find(j=>j.id===id);if(!j)throw Error('Job not found.');return view(w,j)};
 const run=async(c,id)=>{const s=await act(c,account,{headers:{}});return id?view(s.workspace,s.workspace.jobs.find(j=>j.id===id)):s};
 if(name==='get_vault'){const r=await store.get(account),v=vaultFor(account,r?.profile||{});if(!v)return {configured:false,message:'The owner has not created a vault yet.'};const view=await vaultView(v);const w=r.workspace;return {...view,payees:view.recipients.map(a=>({account:a,label:w.payees[a]||null})),committed:w.jobs.filter(j=>['Working','Review','Awaiting approval'].includes(j.status)).reduce((s,j)=>s+j.amount,0)}}
 if(name==='list_payees'){const r=await store.get(account),v=vaultFor(account,r?.profile||{});if(!v)return [];return (await v.recipients()).map(a=>({account:a,label:r.workspace.payees[a]||null}))}
 if(name==='list_jobs'){const w=(await snapshot(account)).workspace;return w.jobs.filter(j=>!a.status||j.status===a.status).slice(0,100).map(j=>view(w,j))}
 if(name==='get_job')return job(a.id);
 if(name==='create_job'){const s=await run({action:'create',title:a.title,brief:a.brief,payee:a.payee,amount:typeof a.amount==='string'?Number(a.amount):a.amount});return view(s.workspace,s.workspace.jobs[0])}
 if(name==='deliver_job'){const out=await run({action:'deliver',id:a.id,text:a.text},a.id);alert(account,'job.delivered',`PayGate: your agent delivered "${out.title}". Review it before paying.`,{jobId:out.id});return out}
 if(name==='cancel_job')return run({action:'cancel',id:a.id},a.id);
 if(name==='request_payment'){if(!key.pay)throw Object.assign(Error('This API key cannot request payments. Create a key with payments allowed.'),{status:403});return run({action:'pay',id:a.id},a.id)}
 throw Object.assign(Error('Unknown tool.'),{status:404});
}
const TOOLS=[
 {name:'get_vault',description:'Read the vault: spendable balance in NEAR, limits (automatic, per payment, daily), today\'s spending, whether it is frozen, its payees and the budget already committed to open jobs.',inputSchema:{type:'object',properties:{}}},
 {name:'list_payees',description:'List the accounts the vault may pay, with their labels. Payments to any other account are refused by the vault.',inputSchema:{type:'object',properties:{}}},
 {name:'list_jobs',description:'List jobs, newest first. Optionally filter by status: Working, Review, Awaiting approval, Paid or Cancelled.',inputSchema:{type:'object',properties:{status:{type:'string',enum:['Working','Review','Awaiting approval','Paid','Cancelled']}}}},
 {name:'get_job',description:'Get one job, its delivery, and its payment or receipt.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}},
 {name:'create_job',description:'Create a job for an allowlisted payee with a budget in NEAR (at most 4 decimals). The budget must fit the per-payment limit and the balance not committed to other open jobs.',inputSchema:{type:'object',properties:{title:{type:'string',maxLength:100},brief:{type:'string',maxLength:2000},payee:{type:'string',description:'NEAR account on the allowlist'},amount:{type:'number',minimum:0.0001}},required:['title','brief','payee','amount']}},
 {name:'deliver_job',description:'Record what was delivered for a job in progress (a summary, a link, an invoice number). The job then waits for payment review.',inputSchema:{type:'object',properties:{id:{type:'string'},text:{type:'string',maxLength:8000}},required:['id','text']}},
 {name:'request_payment',description:'Ask the vault to pay a delivered job. At or below the automatic limit it is paid at once and returns a receipt with the NEAR transaction. Above it, the vault holds the payment and the owner approves or rejects it in their wallet; check back with get_job.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}},
 {name:'cancel_job',description:'Cancel a job that is in progress or in review and release its budget.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}}
];
async function agentApi(url,req,res,json,body,ip){
 const token=/^Bearer\s+(pg_(?:live|test)_[A-Za-z0-9_-]{32})$/.exec(req.headers.authorization||'')?.[1];
 if(limited('agent-auth '+ip,300,6e4))return json(429,{error:'Too many requests. Try again in a minute.'});
 const account=token&&await store.apiKey(sha(token)),record=account&&await store.get(account),key=record?.profile?.apiKeys?.find(k=>k.hash===sha(token));
 if(!key)return json(401,{error:'Send a valid PayGate API key as "Authorization: Bearer pg_…". Create one in Settings.'},{'WWW-Authenticate':'Bearer'});
 if(limited('action '+account,120,6e4))return json(429,{error:'Too many requests. Try again in a minute.'});
 if(!key.lastUsedAt||Date.now()-Date.parse(key.lastUsedAt)>6e5)store.update(account,r=>({...r,profile:{...r.profile,apiKeys:(r.profile.apiKeys||[]).map(k=>k.hash===key.hash?{...k,lastUsedAt:new Date().toISOString()}:k)}})).catch(()=>{});
 const fail=e=>json(e.status||400,{error:reason(e)});
 if(url.pathname==='/mcp'){
  if(req.method!=='POST')return json(405,{error:'This MCP server accepts POST requests (streamable HTTP, JSON responses).'},{Allow:'POST'});
  let m;try{m=await body()}catch{return json(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})}
  const reply=result=>json(200,{jsonrpc:'2.0',id:m.id??null,result}),error=(code,message)=>json(200,{jsonrpc:'2.0',id:m.id??null,error:{code,message}});
  if(m.id===undefined){res.writeHead(202);return res.end()}
  if(m.method==='initialize')return reply({protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'paygate',title:'PayGate',version:'1.0.0'},instructions:`PayGate lets you spend from ${account}'s NEAR vault within limits enforced on-chain. Create a job for an allowlisted payee, deliver the work, then request payment. Small payments go out at once; larger ones wait for the owner's wallet approval. You cannot change limits, payees or approvals.`});
  if(m.method==='ping')return reply({});
  if(m.method==='tools/list')return reply({tools:TOOLS.filter(t=>t.name!=='request_payment'||key.pay)});
  if(m.method==='tools/call'){try{const out=await agentCall(account,key,m.params?.name,m.params?.arguments||{});return reply({content:[{type:'text',text:JSON.stringify(out,null,2)}],structuredContent:Array.isArray(out)?{items:out}:out,isError:false})}catch(e){return reply({content:[{type:'text',text:reason(e)}],isError:true})}}
  return error(-32601,'Method not found');
 }
 const parts=url.pathname.replace(/^\/api\/v1\/?/,'').split('/').filter(Boolean),post=req.method==='POST';
 let c={};if(post){try{c=await body()}catch{c={}}}
 const route=!post&&parts[0]==='vault'&&parts.length===1?['get_vault']:!post&&parts[0]==='payees'&&parts.length===1?['list_payees']:!post&&parts[0]==='jobs'&&parts.length===1?['list_jobs',{status:url.searchParams.get('status')||undefined}]:!post&&parts[0]==='jobs'&&parts.length===2?['get_job',{id:parts[1]}]:post&&parts[0]==='jobs'&&parts.length===1?['create_job',c]:post&&parts[0]==='jobs'&&parts.length===3&&{deliver:1,pay:1,cancel:1}[parts[2]]?[{deliver:'deliver_job',pay:'request_payment',cancel:'cancel_job'}[parts[2]],{...c,id:parts[1]}]:null;
 if(!route)return json(404,{error:'Not found. See the HTTP API in the docs.'});
 try{return json(post&&route[0]==='create_job'?201:200,await agentCall(account,key,route[0],route[1]))}catch(e){return fail(e)}
}
const routes={'/':'index.html','/app.js':'app.js','/docs.js':'docs.js','/legal.js':'legal.js','/vendor/near-connect.js':'vendor/near-connect.js','/logo.svg':'logo.svg','/style.css':'style.css','/wallet-callback.html':'wallet-callback.html','/callback.js':'callback.js'},types={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml'};
http.createServer(async(req,res)=>{
const json=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))};
// Wallets connected through NEAR Connect run in sandboxed iframes that inherit this policy. Their inline code
// carries the per-response nonce, and they may reach their own wallet services over https; nothing else runs.
const nonce=randomBytes(16).toString('base64');
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-src 'self' https:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
if(hosted)res.setHeader('Strict-Transport-Security','max-age=31536000');
if(req.url==='/healthz'&&req.method==='GET')return json(200,{ok:true});if(!hosts.includes(req.headers.host))return json(403,{error:'Invalid host.'});
try{
const url=new URL(req.url,origins[0]),path=url.pathname,ip=ipOf(req),body=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw Error('Request too large.')}const c=JSON.parse(raw);if(!c||typeof c!=='object'||Array.isArray(c))throw Error();return c};
if(tg&&path===tgPath&&req.method==='POST'){if(req.headers['x-telegram-bot-api-secret-token']!==tgSecret)return json(403,{error:'Forbidden.'});try{await telegramUpdate(await body())}catch{}return json(200,{ok:true})}
if(path.startsWith('/dev-wallet/')&&req.method==='GET'){if(await devWallet(url,req,res))return;return json(404,{error:'Not found.'})}
if(path.startsWith('/api/v1/')||path==='/mcp')return agentApi(url,req,res,json,body,ip);
if(path.startsWith('/api/')&&req.method==='POST'&&(req.headers['x-paygate']!=='1'||(req.headers.origin&&!origins.includes(req.headers.origin))))return json(403,{error:'Request origin rejected.'});
if(path==='/api/config'&&req.method==='GET')return json(200,{network,factory:factoryId||null,ready:Boolean(factoryId),walletUrl,rpcUrl:NETWORKS[network]?.rpcUrl||null,explorer,minDeposit:0.4,telegram:Boolean(tgBot),usdc:Boolean(usdc&&factoryTokens)});
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
 if(path==='/api/integrations'&&req.method==='GET'){const r=await store.get(account),v=r?.profile?.vault;return json(200,[{name:'NEAR spending vault',state:v?'live':'off',detail:v?`${v.vault} on ${network}`:'Create your vault to start paying'},{name:'Gas relayer (NEP-366)',state:relayer?'live':'off',detail:relayer?`${relayer.accountId} pays your agent's gas, so its allowance never runs out`:'Not enabled on this server. Your agent pays its own gas from a 0.25 NEAR allowance'},...integrations(Boolean(r?.profile?.aiKey))])}
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
if(req.method!=='GET')return json(405,{error:'Method not allowed.'});const name=routes[path]||(!path.includes('.')?'index.html':null);if(!name)return json(404,{error:'Not found.'});let data=await readFile(new URL(name,root));if(name.endsWith('.html'))data=String(data).replaceAll('__CSP_NONCE__',nonce);res.writeHead(200,{'Content-Type':types[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(data);
}catch(e){return json(400,{error:reason(e)||'Unable to complete request.'})}
}).on('error',e=>fail(e.code==='EADDRINUSE'?`Port ${port} is in use. Stop the other server or set PORT.`:e.message)).listen(port,env.HOST||(hosted?'0.0.0.0':'127.0.0.1'),()=>console.log(`PayGate → ${hosted?publicUrl:origins[0]} · ${network}${factoryId?' · factory '+factoryId:' · no factory'}${relayer?' · relayer '+relayer.accountId:''} · ${store.kind} storage`));
