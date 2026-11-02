import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {initial} from './seed.mjs';
import {pathToFileURL} from 'node:url';
import {transition,hash} from './domain.mjs';
import {quote,attestation,deliver,hasInferenceKey,integrations} from './near.mjs';
import {vaultClient,reason} from './chain.mjs';
const port=Number(process.env.PORT||3000),origin=`http://localhost:${port}`,root=new URL('./public/',import.meta.url),dir=process.env.DATA_DIR?pathToFileURL(process.env.DATA_DIR+'/'):new URL('./data/',import.meta.url),file=new URL('workspace.json',dir);
await mkdir(dir,{recursive:true,mode:0o700});
let state;try{state=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')state=structuredClone(initial);else{console.error(`Cannot read ${file.pathname}. Restore it, or delete it to start from the sample workspace.`);process.exit(1)}}
let queue=Promise.resolve();
const paying=new Set();
const chainFile=process.env.NOCTURNE_CHAIN?pathToFileURL(process.env.NOCTURNE_CHAIN):new URL('chain.json',dir);
let vault=null;try{const config=JSON.parse(await readFile(chainFile,'utf8'));if(!process.env.NEAR_OWNER_KEY){console.error('A vault is configured, so NEAR_OWNER_KEY must be set.');process.exit(1)}vault=vaultClient(config,process.env.NEAR_OWNER_KEY)}catch(e){if(e.code!=='ENOENT')throw e}
const explorer=hash=>vault?.network==='testnet'?`https://testnet.nearblocks.io/txns/${hash}`:null;
const settle=async j=>{const paid=await vault.pay(j);return {...paid,explorer:explorer(paid.txHash)}};
const external=async c=>{const j=state.jobs.find(j=>j.id===c.id);if(c.action==='complete'&&j?.status==='Working'&&hasInferenceKey())return {...c,delivery:await deliver(j)};if(c.action==='quote'){if(j?.status!=='Review')return c;return {...c,quote:await quote(j)}}
// The contract is the authority. Local rules run first so a payment that cannot be recorded is never sent.
if(vault&&c.action==='pay'){transition(state,c);if(paying.has(j.id))throw Error('This payment is already in progress.');paying.add(j.id);try{return {...c,settlement:await settle(j)}}finally{paying.delete(j.id)}}
if(vault&&c.action==='freeze'&&typeof c.freeze==='boolean')await vault.freeze(c.freeze);
if(vault&&c.action==='limits'){transition(state,c);await vault.setMax(c.limit)}
return c};
const routes={'/':'index.html','/app.js':'app.js','/style.css':'style.css'},types={html:'text/html',js:'text/javascript',css:'text/css'};
http.createServer(async(req,res)=>{
const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return json(403,{error:'Invalid host.'});
try{
const path=new URL(req.url,origin).pathname;
if(path==='/api/verify'&&req.method==='GET'){const valid=state.receipts.every((r,i)=>{const {hash:digest,...body}=r;return hash(body)===digest&&r.previousHash===(state.receipts[i+1]?.hash||null)});return json(200,{valid,count:state.receipts.length});}
if(path==='/api/state'&&req.method==='GET')return json(200,state);
if(path==='/api/integrations'&&req.method==='GET')return json(200,[{name:'NEAR spending vault',state:vault?'live':'off',detail:vault?`${vault.vault} on ${vault.network}`:'Run npm run dev:chain to enforce rules on-chain'},...integrations()]);
if(path==='/api/vault'&&req.method==='GET'){if(!vault)return json(200,{configured:false});try{const p=await vault.policy();return json(200,{configured:true,network:vault.network,vault:vault.vault,agent:p.agent,frozen:p.frozen,spendable:p.spendable,spent:p.spent,limits:p.limits})}catch(e){return json(502,{error:reason(e)})}}
if(path==='/api/attestation'&&req.method==='GET'){try{return json(200,await attestation())}catch(e){return json(502,{error:e.message})}}
if(path==='/api/action'&&req.method==='POST'){
if(req.headers['x-nocturne']!=='local'||(req.headers.origin&&![origin,`http://127.0.0.1:${port}`].includes(req.headers.origin)))return json(403,{error:'Request origin rejected.'});
let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return json(413,{error:'Request too large.'});}
let c;try{c=JSON.parse(raw);if(!c||typeof c!=='object')throw Error();delete c.delivery;delete c.quote;delete c.settlement}catch{return json(400,{error:'Invalid JSON.'})}
try{c=await external(c)}catch(e){return json(e.code?502:400,{error:reason(e)})}
const job=queue.then(async()=>{const next=transition(state,c);await writeFile(new URL('workspace.tmp',dir),JSON.stringify(next,null,2),{mode:0o600});await rename(new URL('workspace.tmp',dir),file);state=next;return next});queue=job.catch(()=>{});
try{return json(200,await job)}catch(e){return json(400,{error:e.code?'Unable to save workspace.':e.message})}
}
if(req.method!=='GET')return json(405,{error:'Method not allowed.'});const name=routes[path];if(!name)return json(404,{error:'Not found.'});const data=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':types[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(data);
}catch{return json(400,{error:'Unable to complete request.'})}
}).on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is in use. Stop the other server or set PORT.`:e.message);process.exit(1)}).listen(port,'127.0.0.1',()=>console.log(`Nocturne → ${origin}`));
