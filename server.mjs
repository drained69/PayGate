import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {initial} from './seed.mjs';
import {transition,hash} from './domain.mjs';
import {quote,attestation,deliver,hasInferenceKey,integrations} from './near.mjs';
import {vaultClient,reason} from './chain.mjs';
const env=process.env,port=Number(env.PORT||3000),root=new URL('./public/',import.meta.url);
// A public URL switches on hosted mode: one in-memory workspace per visitor, rate limits, and a shared vault that visitors cannot freeze or reconfigure.
const publicUrl=env.PUBLIC_URL||(env.RAILWAY_PUBLIC_DOMAIN?'https://'+env.RAILWAY_PUBLIC_DOMAIN:''),hosted=Boolean(publicUrl);
const origins=[`http://localhost:${port}`,`http://127.0.0.1:${port}`,...(hosted?[new URL(publicUrl).origin]:[])],hosts=origins.map(o=>new URL(o).host);
const fresh=()=>({...structuredClone(initial),workspace:randomBytes(6).toString('hex')});
const dir=env.DATA_DIR?pathToFileURL(env.DATA_DIR+'/'):new URL('./data/',import.meta.url),file=new URL('workspace.json',dir);
const saveFile=async next=>{await writeFile(new URL('workspace.tmp',dir),JSON.stringify(next,null,2),{mode:0o600});await rename(new URL('workspace.tmp',dir),file)};
let local=null;
if(!hosted){
 await mkdir(dir,{recursive:true,mode:0o700});
 let state;try{state=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')state=fresh();else{console.error(`Cannot read ${file.pathname}. Restore it, or delete it to start from the sample workspace.`);process.exit(1)}}
 // The workspace id prefixes on-chain job ids, so it is saved before any payment can use it.
 if(!state.workspace||!(await readFile(file).catch(()=>null))){state.workspace||=randomBytes(6).toString('hex');await saveFile(state)}
 local={state,queue:Promise.resolve(),save:saveFile};
}
async function chainConfig(){
 if(env.NOCTURNE_CHAIN_JSON)return JSON.parse(env.NOCTURNE_CHAIN_JSON);
 try{return JSON.parse(await readFile(env.NOCTURNE_CHAIN?pathToFileURL(env.NOCTURNE_CHAIN):new URL('chain.json',dir),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}
}
const config=await chainConfig();
if(config&&!env.NEAR_OWNER_KEY){console.error('A vault is configured, so NEAR_OWNER_KEY must be set.');process.exit(1)}
const vault=config?vaultClient(config,env.NEAR_OWNER_KEY):null;
const sessions=new Map(),DAY=864e5,MAX_SESSIONS=2000;
function workspace(req,res){
 if(!hosted)return local;
 const sid=/(?:^|;\s*)nocturne_sid=([a-f0-9]{32})/.exec(req.headers.cookie||'')?.[1];let w=sid&&sessions.get(sid);
 if(w&&Date.now()-w.seen<DAY){sessions.delete(sid);sessions.set(sid,w)}
 else{
  if(sid)sessions.delete(sid);
  const id=randomBytes(16).toString('hex');w={state:fresh(),queue:Promise.resolve(),save:async()=>{}};sessions.set(id,w);
  res.setHeader('Set-Cookie',`nocturne_sid=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
  while(sessions.size>MAX_SESSIONS)sessions.delete(sessions.keys().next().value);
 }
 w.seen=Date.now();return w;
}
const hits=new Map();
function limited(req,kind,max,ms){
 if(!hosted)return false;
 const ip=String(req.headers['x-real-ip']||req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress,k=kind+' '+ip,now=Date.now();let h=hits.get(k);
 if(!h||h.reset<=now){if(hits.size>20000)for(const [key,v] of hits)if(v.reset<=now)hits.delete(key);h={count:0,reset:now+ms};hits.set(k,h)}
 return ++h.count>max;
}
const paying=new Set();
const explorer=hash=>vault?.network==='testnet'?`https://testnet.nearblocks.io/txns/${hash}`:null;
const external=async(c,w,req)=>{
 const s=w.state,j=s.jobs.find(j=>j.id===c.id);
 if(c.action==='complete'&&j?.status==='Working'&&hasInferenceKey()){if(limited(req,'agent',30,36e5))throw Error('Too many agent runs. Try again later.');return {...c,delivery:await deliver(j)}}
 if(c.action==='quote'){if(j?.status!=='Review')return c;return {...c,quote:await quote(j)}}
 // The contract is the authority. Local rules run first so a payment that cannot be recorded is never sent.
 if(vault&&c.action==='pay'){
  transition(s,c);const key=s.workspace+':'+j.id;
  if(paying.has(key))throw Error('This payment is already in progress.');
  if(limited(req,'pay',20,36e5))throw Error('Too many payments. Try again later.');
  paying.add(key);try{const paid=await vault.pay({...j,id:key});return {...c,settlement:{...paid,explorer:explorer(paid.txHash)}}}finally{paying.delete(key)}
 }
 if(vault&&!hosted&&c.action==='freeze'&&typeof c.freeze==='boolean')await vault.freeze(c.freeze);
 if(vault&&!hosted&&c.action==='limits'){transition(s,c);await vault.setMax(c.limit)}
 return c;
};
const routes={'/':'index.html','/app.js':'app.js','/style.css':'style.css'},types={html:'text/html',js:'text/javascript',css:'text/css'};
http.createServer(async(req,res)=>{
const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
if(hosted)res.setHeader('Strict-Transport-Security','max-age=31536000');
if(req.url==='/healthz'&&req.method==='GET')return json(200,{ok:true});if(!hosts.includes(req.headers.host))return json(403,{error:'Invalid host.'});
try{
const path=new URL(req.url,origins[0]).pathname;
if(path==='/api/verify'&&req.method==='GET'){const {state}=workspace(req,res),valid=state.receipts.every((r,i)=>{const {hash:digest,...body}=r;return hash(body)===digest&&r.previousHash===(state.receipts[i+1]?.hash||null)});return json(200,{valid,count:state.receipts.length});}
if(path==='/api/state'&&req.method==='GET')return json(200,workspace(req,res).state);
if(path==='/api/integrations'&&req.method==='GET')return json(200,[{name:'NEAR spending vault',state:vault?'live':'off',detail:vault?`${vault.vault} on ${vault.network}`:hosted?'Not connected on this deployment':'Run npm run dev:chain to enforce rules on-chain'},...integrations()]);
if(path==='/api/vault'&&req.method==='GET'){if(!vault)return json(200,{configured:false,shared:hosted});try{const p=await vault.policy();return json(200,{configured:true,shared:hosted,network:vault.network,vault:vault.vault,agent:p.agent,frozen:p.frozen,spendable:p.spendable,spent:p.spent,limits:p.limits})}catch(e){return json(502,{error:reason(e)})}}
if(path==='/api/attestation'&&req.method==='GET'){if(limited(req,'attestation',10,6e4))return json(429,{error:'Too many report checks. Try again in a minute.'});try{return json(200,await attestation())}catch(e){return json(502,{error:e.message})}}
if(path==='/api/action'&&req.method==='POST'){
if(req.headers['x-nocturne']!=='local'||(req.headers.origin&&!origins.includes(req.headers.origin)))return json(403,{error:'Request origin rejected.'});
if(limited(req,'action',120,6e4))return json(429,{error:'Too many requests. Try again in a minute.'});
let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return json(413,{error:'Request too large.'});}
let c;try{c=JSON.parse(raw);if(!c||typeof c!=='object')throw Error();delete c.delivery;delete c.quote;delete c.settlement}catch{return json(400,{error:'Invalid JSON.'})}
const w=workspace(req,res);
try{c=await external(c,w,req)}catch(e){return json(e.code?502:400,{error:reason(e)})}
const job=w.queue.then(async()=>{const next=transition(w.state,c);await w.save(next);w.state=next;return next});w.queue=job.catch(()=>{});
try{return json(200,await job)}catch(e){return json(400,{error:e.code?'Unable to save workspace.':e.message})}
}
if(req.method!=='GET')return json(405,{error:'Method not allowed.'});const name=routes[path];if(!name)return json(404,{error:'Not found.'});if(path==='/')workspace(req,res);const data=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':types[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(data);
}catch{return json(400,{error:'Unable to complete request.'})}
}).on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is in use. Stop the other server or set PORT.`:e.message);process.exit(1)}).listen(port,env.HOST||(hosted?'0.0.0.0':'127.0.0.1'),()=>console.log(`Nocturne → ${hosted?publicUrl:origins[0]}${hosted?` (hosted, port ${port})`:''}`));
