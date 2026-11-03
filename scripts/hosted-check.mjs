import assert from 'node:assert/strict';
import {request} from 'node:http';
import {JsonRpcProvider} from 'near-api-js';
import {startChainApp} from './dev-chain.mjs';
import {startStub} from './near-stub.mjs';
// Hosted mode against a local NEAR node: visitors share one vault but never each other's workspace or its controls.
const stub=await startStub(),port=3096,host='demo.example',app=await startChainApp(port,{ONECLICK_URL:stub.url,NEAR_AI_URL:stub.url,PUBLIC_URL:'https://'+host});
const call=(path,cookie,body)=>new Promise((done,fail)=>{const r=request({host:'127.0.0.1',port,path,method:body?'POST':'GET',headers:{Host:host,'X-Nocturne':'local','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>done({status:res.statusCode,cookie:res.headers['set-cookie']?.[0]?.split(';')[0],data:JSON.parse(raw||'null')}))});r.once('error',fail);if(body)r.write(JSON.stringify(body));r.end()});
try{
 const provider=new JsonRpcProvider({url:app.config.rpcUrl}),worker=async()=>BigInt((await provider.viewAccount({accountId:app.config.worker,blockQuery:{finality:'optimistic'}})).amount),unit=BigInt(app.config.unitYocto),start=await worker();
 const a=(await call('/api/state')).cookie,b=(await call('/api/state')).cookie;
 for(const visitor of [a,b]){const paid=await call('/api/action',visitor,{action:'pay',id:'NC-104'});assert.equal(paid.status,200,JSON.stringify(paid.data));assert.equal(paid.data.receipts[0].settlement.route,'owner-approved')}
 assert.equal(await worker()-start,360n*unit);
 assert.equal((await call('/api/action',a,{action:'pay',id:'NC-104'})).status,400);
 assert.equal((await call('/api/action',a,{action:'freeze',freeze:true})).data.freeze,true);
 assert.equal((await call('/api/action',a,{action:'limits',limit:50})).data.limit,50);
 const vault=(await call('/api/vault',b)).data;assert.equal(vault.shared,true);assert.equal(vault.frozen,false);assert.equal(vault.limits.max,0.5);
 const made=await call('/api/action',b,{action:'create',amount:25,title:'Small job',brief:'Pays automatically',agent:'Atlas · Research'}),id=made.data.jobs[0].id;
 await call('/api/action',b,{action:'complete',id});const small=await call('/api/action',b,{action:'pay',id});
 assert.equal(small.status,200,JSON.stringify(small.data));assert.equal(small.data.receipts[0].settlement.route,'auto');
 assert.equal(await worker()-start,385n*unit);
 const blocked=await call('/api/action',a,{action:'pay',id:(await call('/api/action',a,{action:'complete',id:'NC-103'})).data.jobs.find(j=>j.id==='NC-103').id});
 assert.equal(blocked.data.error,'Payments are frozen.');
 console.log('Hosted check passed: two visitors paid the same seeded job on-chain, one visitor\'s freeze and limit stayed in that session, and the shared vault stayed active.');
}finally{await app.stop();await stub.close()}
