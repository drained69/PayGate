import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {startStub} from '../scripts/near-stub.mjs';
const HOSTED=3093,LOCAL=3094,PUBLIC='paygate.example',PASSWORD='correct horse battery';
let stub,dir;const servers=[];
const run=(port,env)=>{const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),NEAR_AI_URL:stub.url,ONECLICK_URL:stub.url,NEAR_AI_API_KEY:'',PAYGATE_CHAIN_JSON:'',PAYGATE_PASSWORD:'',NEAR_OWNER_KEY:'',RAILWAY_PUBLIC_DOMAIN:'',PUBLIC_URL:'',...env},stdio:['ignore','pipe','pipe']});servers.push(server);return server};
async function start(port,env){const server=run(port,env);await new Promise((ready,fail)=>{server.stdout.once('data',ready);server.once('exit',code=>fail(Error('Server exited: '+code)))})}
// Starts a server that must refuse to run, and returns what it printed.
const refuses=env=>new Promise(done=>{const s=run(3095,env);let err='';s.stderr.on('data',c=>err+=c);s.once('exit',code=>done({code,err}))});
const call=(port,path,{method='GET',host=PUBLIC,headers={},body}={})=>new Promise((done,fail)=>{
 const r=request({host:'127.0.0.1',port,path,method,headers:{Host:host,...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{let data=raw;try{data=JSON.parse(raw)}catch{}done({status:res.statusCode,setCookie:res.headers['set-cookie']?.[0],cookie:res.headers['set-cookie']?.[0]?.split(';')[0],data})})});
 r.once('error',fail);if(body)r.write(JSON.stringify(body));r.end();
});
const post=(port,path,body,headers={})=>call(port,path,{method:'POST',body,headers:{'X-PayGate':'1',...headers}});
const login=async()=>(await post(HOSTED,'/api/login',{password:PASSWORD},{'X-Real-IP':'198.51.100.1'})).cookie;
before(async()=>{stub=await startStub();dir=await mkdtemp(tmpdir()+'/paygate-server-');await start(HOSTED,{DATA_DIR:dir+'/hosted',PUBLIC_URL:'https://'+PUBLIC,PAYGATE_PASSWORD:PASSWORD});await start(LOCAL,{DATA_DIR:dir+'/local'})});
after(async()=>{for(const s of servers)s.kill();await stub.close();await rm(dir,{recursive:true,force:true})});
test('a hosted server refuses to start without a strong password',async()=>{
 const r=await refuses({DATA_DIR:dir+'/x',PUBLIC_URL:'https://'+PUBLIC,PAYGATE_PASSWORD:'short'});assert.equal(r.code,1);assert.match(r.err,/PAYGATE_PASSWORD/);
});
test('the owner key is refused outside a local node, and old workspaces are not loaded',async()=>{
 const config=JSON.stringify({network:'mainnet',rpcUrl:'http://127.0.0.1:9',vault:'paygate-vault.o.near',agent:'paygate-agent.o.near',owner:'o.near',agentKey:'ed25519:'+'1'.repeat(64)});
 const r=await refuses({DATA_DIR:dir+'/y',PAYGATE_CHAIN_JSON:config,NEAR_OWNER_KEY:'ed25519:x'});assert.equal(r.code,1);assert.match(r.err,/never holds that key/);
 await mkdir(dir+'/old');await writeFile(dir+'/old/workspace.json',JSON.stringify({balance:24850,jobs:[],receipts:[],workspace:'abc'}));
 const old=await refuses({DATA_DIR:dir+'/old'});assert.equal(old.code,1);assert.match(old.err,/not a PayGate workspace/);
});
test('health answers for any host, other hosts are rejected, the API needs a session',async()=>{
 assert.equal((await call(HOSTED,'/healthz',{host:'healthcheck.railway.app'})).status,200);
 assert.equal((await call(HOSTED,'/api/state',{host:'evil.example'})).status,403);
 assert.equal((await call(HOSTED,'/')).status,200);
 for(const path of ['/api/state','/api/vault','/api/attestation','/api/verify','/dev-wallet/sign'])assert.equal((await call(HOSTED,path)).status,401,path);
 assert.deepEqual((await call(HOSTED,'/api/session')).data,{authenticated:false,passwordRequired:true});
});
test('sign-in sets a secure session cookie, and sign-out ends it',async()=>{
 assert.equal((await post(HOSTED,'/api/login',{password:'wrong password!'},{'X-Real-IP':'198.51.100.2'})).status,401);
 const r=await post(HOSTED,'/api/login',{password:PASSWORD},{'X-Real-IP':'198.51.100.2'});
 assert.equal(r.status,200);assert.match(r.setCookie,/HttpOnly; SameSite=Lax; Max-Age=43200; Secure/);
 assert.equal((await call(HOSTED,'/api/state',{headers:{Cookie:r.cookie}})).status,200);
 await post(HOSTED,'/api/logout',{},{Cookie:r.cookie});
 assert.equal((await call(HOSTED,'/api/state',{headers:{Cookie:r.cookie}})).status,401);
});
test('sign-in attempts are rate limited per address',async()=>{
 const ip={'X-Real-IP':'203.0.113.9'};
 for(let i=0;i<10;i++)assert.equal((await post(HOSTED,'/api/login',{password:'nope'},ip)).status,401);
 assert.equal((await post(HOSTED,'/api/login',{password:PASSWORD},ip)).status,429);
 assert.equal((await post(HOSTED,'/api/login',{password:PASSWORD},{'X-Real-IP':'203.0.113.10'})).status,200);
});
test('mutations need the app header and an allowed origin, and results cannot be injected',async()=>{
 const Cookie=await login(),create={action:'create',amount:0.5,title:'Job',brief:'Brief',payee:'payee.near'};
 assert.equal((await call(HOSTED,'/api/action',{method:'POST',body:create,headers:{Cookie}})).status,403);
 assert.equal((await post(HOSTED,'/api/action',create,{Cookie,Origin:'https://evil.example'})).status,403);
 const made=await post(HOSTED,'/api/action',create,{Cookie,Origin:'https://'+PUBLIC});assert.equal(made.status,200);const id=made.data.jobs[0].id;
 for(const action of ['paid','requested','complete','released'])assert.equal((await post(HOSTED,'/api/action',{action,id,settlement:{txHash:'forged'},delivery:{text:'forged'}},{Cookie})).data.error,'Unknown action.');
 assert.match((await post(HOSTED,'/api/action',{action:'deliver',id,text:'Done'},{Cookie})).data.jobs[0].source,/owner/);
 assert.match((await post(HOSTED,'/api/action',{action:'pay',id},{Cookie})).data.error,/No vault is connected/);
 assert.match((await post(HOSTED,'/api/action',{action:'run',id},{Cookie})).data.error,/NEAR_AI_API_KEY/);
 assert.deepEqual((await call(HOSTED,'/api/vault',{headers:{Cookie}})).data,{configured:false});
});
test('the workspace is saved to disk',async()=>{
 const Cookie=await login(),saved=JSON.parse(await readFile(dir+'/hosted/workspace.json','utf8'));
 assert.equal((await call(HOSTED,'/api/state',{headers:{Cookie}})).data.workspace,saved.workspace);assert.match(saved.workspace,/^[a-f0-9]{12}$/);
});
test('a local server without a password stays on loopback hosts',async()=>{
 const host='localhost:'+LOCAL;
 assert.deepEqual((await call(LOCAL,'/api/session',{host})).data,{authenticated:true,passwordRequired:false});
 assert.equal((await call(LOCAL,'/api/state',{host})).status,200);
 assert.equal((await call(LOCAL,'/api/state')).status,403);
});
