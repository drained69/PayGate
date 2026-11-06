import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {KeyPair} from 'near-api-js';
import {startStub} from '../scripts/near-stub.mjs';
import {signNep413} from '../src/chain.mjs';
import {openStore} from '../src/store.mjs';
const HOSTED=3093,PUBLIC='paygate.example',SECRET='s'.repeat(40);
let stub,dir;const servers=[];
const run=(port,env)=>{const server=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,PORT:String(port),NEAR_AI_URL:stub.url,ONECLICK_URL:stub.url,NEAR_NETWORK:'testnet',NEAR_RPC_URL:'http://127.0.0.1:9',PAYGATE_FACTORY:'',PAYGATE_SECRET:'',PAYGATE_DEV_ACCOUNTS:'',DATABASE_URL:'',RAILWAY_PUBLIC_DOMAIN:'',PUBLIC_URL:'',...env},stdio:['ignore','pipe','pipe']});servers.push(server);return server};
async function start(port,env){const server=run(port,env);await new Promise((ready,fail)=>{server.stdout.once('data',ready);server.once('exit',code=>fail(Error('Server exited: '+code)))})}
// Starts a server that must refuse to run, and returns what it printed.
const refuses=env=>new Promise(done=>{const s=run(3095,env);let err='';s.stderr.on('data',c=>err+=c);s.once('exit',code=>done({code,err}))});
const call=(path,{method='GET',host=PUBLIC,headers={},body}={})=>new Promise((done,fail)=>{
 const r=request({host:'127.0.0.1',port:HOSTED,path,method,headers:{Host:host,...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{let data=raw;try{data=JSON.parse(raw)}catch{}done({status:res.statusCode,headers:res.headers,data})})});
 r.once('error',fail);if(body)r.write(JSON.stringify(body));r.end();
});
const post=(path,body,headers={})=>call(path,{method:'POST',body,headers:{'X-PayGate':'1',...headers}});
before(async()=>{stub=await startStub();dir=await mkdtemp(tmpdir()+'/paygate-server-');await start(HOSTED,{DATA_DIR:dir+'/hosted',PUBLIC_URL:'https://'+PUBLIC,PAYGATE_SECRET:SECRET})});
after(async()=>{for(const s of servers)s.kill();await stub.close();await rm(dir,{recursive:true,force:true})});
test('a hosted server refuses to start without a strong secret',async()=>{
 for(const secret of ['','short']){const r=await refuses({DATA_DIR:dir+'/x',PUBLIC_URL:'https://'+PUBLIC,PAYGATE_SECRET:secret});assert.equal(r.code,1);assert.match(r.err,/PAYGATE_SECRET/)}
});
test('test accounts and unknown networks are refused outside a local node',async()=>{
 const dev=await refuses({DATA_DIR:dir+'/y',PAYGATE_DEV_ACCOUNTS:'{"a.near":"ed25519:x"}'});assert.equal(dev.code,1);assert.match(dev.err,/only allowed on a local node/);
 const net=await refuses({DATA_DIR:dir+'/z',NEAR_NETWORK:'devnet'});assert.equal(net.code,1);assert.match(net.err,/NEAR_NETWORK/);
});
test('public pages load, other hosts are rejected, and account data needs a session',async()=>{
 assert.equal((await call('/healthz',{host:'healthcheck.railway.app'})).status,200);
 assert.equal((await call('/',{host:'evil.example'})).status,403);
 for(const path of ['/','/docs.js','/legal.js','/wallet-callback.html','/callback.js','/terms'])assert.equal((await call(path)).status,200,path);
 assert.equal((await call('/nope.php')).status,404);
 for(const path of ['/api/state','/api/vault','/api/attestation','/api/integrations','/api/verify'])assert.equal((await call(path)).status,401,path);
 assert.equal((await post('/api/action',{action:'create'})).status,401);
 assert.deepEqual((await call('/api/session')).data,{account:null});
 assert.deepEqual((await call('/api/session',{headers:{Cookie:'paygate_session='+'a'.repeat(64)}})).data,{account:null});
 const config=(await call('/api/config')).data;assert.equal(config.network,'testnet');assert.equal(config.ready,false);assert.equal(config.walletUrl,null);assert.equal(config.rpcUrl,'https://test.rpc.fastnear.com');
 const page=await call('/'),again=await call('/');assert.match(page.headers['strict-transport-security'],/max-age/);assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
 const nonce=/'nonce-([^']+)'/.exec(page.headers['content-security-policy'])[1];assert.ok(page.data.includes(`content="${nonce}"`),'the page carries its own nonce');assert.notEqual(nonce,/'nonce-([^']+)'/.exec(again.headers['content-security-policy'])[1],'each response gets a fresh nonce');
 assert.equal((await call('/vendor/near-connect.js')).status,200);
});
test('mutations need the app header and an allowed origin',async()=>{
 assert.equal((await call('/api/auth/challenge',{method:'POST',body:{}})).status,403);
 assert.equal((await post('/api/auth/challenge',{},{Origin:'https://evil.example'})).status,403);
 assert.equal((await post('/api/auth/challenge',{},{Origin:'https://'+PUBLIC,'X-Real-IP':'198.51.100.7'})).status,200);
});
test('sign-in challenges are single use and bound to this site',async()=>{
 const ip={'X-Real-IP':'198.51.100.8'},ch=(await post('/api/auth/challenge',{},ip)).data;
 assert.equal(ch.message,'Sign in to PayGate');assert.equal(ch.recipient,PUBLIC);assert.equal(ch.callbackUrl,`https://${PUBLIC}/wallet-callback.html`);assert.equal(Buffer.from(ch.nonce,'base64').length,32);
 const k=KeyPair.fromRandom('ed25519'),signature=signNep413(k.toString(),{message:ch.message,nonce:Buffer.from(ch.nonce,'base64'),recipient:'evil.example',callbackUrl:ch.callbackUrl});
 const wrong=await post('/api/auth/verify',{accountId:'someone.near',publicKey:k.getPublicKey().toString(),signature,nonce:ch.nonce},ip);
 assert.equal(wrong.status,401);assert.match(wrong.data.error,/signature does not match/);
 const again=await post('/api/auth/verify',{accountId:'someone.near',publicKey:k.getPublicKey().toString(),signature,nonce:ch.nonce},ip);
 assert.equal(again.status,401);assert.match(again.data.error,/expired/);
 assert.match((await post('/api/auth/verify',{accountId:'someone.near',nonce:Buffer.alloc(32).toString('base64')},ip)).data.error,/expired/);
});
test('sign-in attempts are rate limited per address',async()=>{
 const ip={'X-Real-IP':'203.0.113.9'};
 for(let i=0;i<30;i++)assert.equal((await post('/api/auth/challenge',{},ip)).status,200);
 assert.equal((await post('/api/auth/challenge',{},ip)).status,429);
 assert.equal((await post('/api/auth/challenge',{},{'X-Real-IP':'203.0.113.10'})).status,200);
});
test('the file store applies concurrent updates in order and deletes cleanly',async()=>{
 const store=await openStore({dir:new URL(`file://${dir}/store/`)});
 await Promise.all(Array.from({length:20},(_,i)=>store.update('a.near',r=>({...r,profile:{...r.profile,n:(r.profile.n||0)+1,last:i}}))));
 const r=await store.get('a.near');assert.equal(r.profile.n,20);assert.equal(r.workspace.jobs.length,0);
 await store.addSession('h','a.near',Date.now()+1e4);assert.equal(await store.session('h'),'a.near');
 await store.addNonce('n',Date.now()+1e4);assert.equal(await store.useNonce('n'),true);assert.equal(await store.useNonce('n'),false);
 await store.remove('a.near');assert.equal(await store.get('a.near'),null);assert.equal(await store.session('h'),null);
 await store.update('mainnet/b.near',r=>r);assert.equal((await store.get('mainnet/b.near')).account,'mainnet/b.near');assert.equal(await store.get('b.near'),null,'network-scoped keys stay separate');
});
test('the agent API needs a valid key and the MCP endpoint accepts only POST',async()=>{
 assert.equal((await call('/api/v1/vault')).status,401);
 assert.equal((await call('/api/v1/vault',{headers:{Authorization:'Bearer pg_test_'+'a'.repeat(32)}})).status,401);
 assert.equal((await call('/api/v1/jobs',{method:'POST',body:{},headers:{Authorization:'Bearer nope'}})).status,401);
 assert.match((await call('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).headers['www-authenticate'],/Bearer/);
});
