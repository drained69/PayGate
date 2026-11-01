import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {initial} from './seed.mjs';
import {pathToFileURL} from 'node:url';
import {transition,hash} from './domain.mjs';
import {quote,attestation,deliver,hasInferenceKey,integrations} from './near.mjs';
const port=Number(process.env.PORT||3000),origin=`http://localhost:${port}`,root=new URL('./public/',import.meta.url),dir=process.env.DATA_DIR?pathToFileURL(process.env.DATA_DIR+'/'):new URL('./data/',import.meta.url),file=new URL('workspace.json',dir);
await mkdir(dir,{recursive:true,mode:0o700});
let state;try{state=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')state=structuredClone(initial);else{console.error(`Cannot read ${file.pathname}. Restore it, or delete it to start from the sample workspace.`);process.exit(1)}}
let queue=Promise.resolve();
const external=async c=>{const j=state.jobs.find(j=>j.id===c.id);if(c.action==='complete'&&j?.status==='Working'&&hasInferenceKey())return {...c,delivery:await deliver(j)};if(c.action==='quote'){if(j?.status!=='Review')return c;return {...c,quote:await quote(j)}}return c};
const routes={'/':'index.html','/app.js':'app.js','/style.css':'style.css'},types={html:'text/html',js:'text/javascript',css:'text/css'};
http.createServer(async(req,res)=>{
const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return json(403,{error:'Invalid host.'});
const path=new URL(req.url,origin).pathname;
try{
if(path==='/api/verify'&&req.method==='GET'){const valid=state.receipts.every((r,i)=>{const {hash:digest,...body}=r;return hash(body)===digest&&r.previousHash===(state.receipts[i+1]?.hash||null)});return json(200,{valid,count:state.receipts.length});}
if(path==='/api/state'&&req.method==='GET')return json(200,state);
if(path==='/api/integrations'&&req.method==='GET')return json(200,integrations());
if(path==='/api/attestation'&&req.method==='GET'){try{return json(200,await attestation())}catch(e){return json(502,{error:e.message})}}
if(path==='/api/action'&&req.method==='POST'){
if(req.headers['x-nocturne']!=='local'||(req.headers.origin&&![origin,`http://127.0.0.1:${port}`].includes(req.headers.origin)))return json(403,{error:'Request origin rejected.'});
let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return json(413,{error:'Request too large.'});}
let c;try{c=JSON.parse(raw);if(!c||typeof c!=='object')throw Error();delete c.delivery;delete c.quote}catch{return json(400,{error:'Invalid JSON.'})}
try{c=await external(c)}catch(e){return json(502,{error:e.message})}
const job=queue.then(async()=>{const next=transition(state,c);await writeFile(new URL('workspace.tmp',dir),JSON.stringify(next,null,2),{mode:0o600});await rename(new URL('workspace.tmp',dir),file);state=next;return next});queue=job.catch(()=>{});
try{return json(200,await job)}catch(e){return json(400,{error:e.code?'Unable to save workspace.':e.message})}
}
if(req.method!=='GET')return json(405,{error:'Method not allowed.'});const name=routes[path];if(!name)return json(404,{error:'Not found.'});const data=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':types[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(data);
}catch{return json(500,{error:'Unable to complete request.'})}
}).listen(port,'127.0.0.1',()=>console.log(`Nocturne → ${origin}`));
