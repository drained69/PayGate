import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {startStub} from '../scripts/near-stub.mjs';
const HOSTED=3093,LOCAL=3094,PUBLIC='demo.example';
let stub,dir;const servers=[];
async function start(port,env){
 const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),NEAR_AI_URL:stub.url,ONECLICK_URL:stub.url,NEAR_AI_API_KEY:'',NOCTURNE_CHAIN_JSON:'',RAILWAY_PUBLIC_DOMAIN:'',...env},stdio:['ignore','pipe','inherit']});servers.push(server);
 await new Promise((ready,fail)=>{server.stdout.once('data',ready);server.once('exit',code=>fail(Error('Server exited: '+code)))});
}
const call=(port,path,{method='GET',host=PUBLIC,headers={},body}={})=>new Promise((done,fail)=>{
 const r=request({host:'127.0.0.1',port,path,method,headers:{Host:host,...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{let data=raw;try{data=JSON.parse(raw)}catch{}done({status:res.statusCode,cookie:res.headers['set-cookie']?.[0]?.split(';')[0],setCookie:res.headers['set-cookie']?.[0],data})})});
 r.once('error',fail);if(body)r.write(JSON.stringify(body));r.end();
});
const act=(cookie,body,extra={})=>call(HOSTED,'/api/action',{method:'POST',headers:{'X-Nocturne':'local','Content-Type':'application/json',Cookie:cookie,...extra},body});
before(async()=>{stub=await startStub();dir=await mkdtemp(tmpdir()+'/nocturne-server-');await start(HOSTED,{DATA_DIR:dir+'/hosted',PUBLIC_URL:'https://'+PUBLIC});await start(LOCAL,{DATA_DIR:dir,PUBLIC_URL:''})});
after(async()=>{for(const s of servers)s.kill();await stub.close();await rm(dir,{recursive:true,force:true})});
test('health check answers for any host, other hosts are rejected',async()=>{
 assert.equal((await call(HOSTED,'/healthz',{host:'healthcheck.railway.app'})).status,200);
 assert.equal((await call(HOSTED,'/api/state',{host:'evil.example'})).status,403);
 assert.equal((await call(HOSTED,'/')).status,200);
});
test('each visitor gets a separate workspace with a secure cookie',async()=>{
 const a=await call(HOSTED,'/'),b=await call(HOSTED,'/');
 assert.match(a.setCookie,/HttpOnly; Secure; SameSite=Lax/);assert.notEqual(a.cookie,b.cookie);
 const made=await act(a.cookie,{action:'create',amount:25,title:'Visitor A job',brief:'Only for A',agent:'Atlas · Research'});
 assert.equal(made.status,200);assert.equal(made.cookie,undefined);
 assert.ok((await call(HOSTED,'/api/state',{headers:{Cookie:a.cookie}})).data.jobs.some(j=>j.title==='Visitor A job'));
 const other=(await call(HOSTED,'/api/state',{headers:{Cookie:b.cookie}})).data;
 assert.equal(other.jobs.some(j=>j.title==='Visitor A job'),false);assert.notEqual(other.workspace,made.data.workspace);
 assert.equal((await act(a.cookie,{action:'freeze',freeze:true})).data.freeze,true);
 assert.equal((await call(HOSTED,'/api/state',{headers:{Cookie:b.cookie}})).data.freeze,false);
 const stale=await call(HOSTED,'/api/state',{headers:{Cookie:'nocturne_sid='+'0'.repeat(32)}});
 assert.ok(stale.cookie);assert.equal(stale.data.jobs.length,3);
});
test('mutations need the app header and an allowed origin',async()=>{
 const {cookie}=await call(HOSTED,'/'),body={action:'freeze',freeze:true};
 assert.equal((await call(HOSTED,'/api/action',{method:'POST',headers:{Cookie:cookie},body})).status,403);
 assert.equal((await act(cookie,body,{Origin:'https://evil.example'})).status,403);
 assert.equal((await act(cookie,body,{Origin:'https://'+PUBLIC})).status,200);
});
test('hosted mode rate limits report checks per visitor address',async()=>{
 const headers={'X-Real-IP':'203.0.113.9'};
 for(let i=0;i<10;i++)assert.equal((await call(HOSTED,'/api/attestation',{headers})).status,200);
 assert.equal((await call(HOSTED,'/api/attestation',{headers})).status,429);
 assert.equal((await call(HOSTED,'/api/attestation',{headers:{'X-Real-IP':'203.0.113.10'}})).status,200);
});
test('hosted mode reports simulated payments when no vault is set',async()=>{
 assert.deepEqual((await call(HOSTED,'/api/vault')).data,{configured:false,shared:true});
 assert.equal((await call(HOSTED,'/api/integrations')).data[0].detail,'Not connected on this deployment');
});
test('local mode keeps one saved workspace with a stable id',async()=>{
 const saved=JSON.parse(await readFile(dir+'/workspace.json','utf8'));assert.match(saved.workspace,/^[a-f0-9]{12}$/);
 const s=(await call(LOCAL,'/api/state',{host:'localhost:'+LOCAL})).data;assert.equal(s.workspace,saved.workspace);
 assert.equal((await call(LOCAL,'/',{host:'localhost:'+LOCAL})).setCookie,undefined);
 assert.equal((await call(LOCAL,'/api/state',{host:PUBLIC})).status,403);
 assert.deepEqual((await call(LOCAL,'/api/vault',{host:'localhost:'+LOCAL})).data,{configured:false,shared:false});
});
