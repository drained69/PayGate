import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {openStore} from '../src/store.mjs';
// Runs the store against a real Postgres. Uses DATABASE_URL if set, otherwise a throwaway Docker container.
let url=process.env.DATABASE_URL,container;
if(!url){
 container=execFileSync('docker',['run','-d','--rm','-e','POSTGRES_PASSWORD=paygate-test','-p','127.0.0.1:55432:5432','postgres:16'],{encoding:'utf8'}).trim();
 url='postgres://postgres:paygate-test@127.0.0.1:55432/postgres';
}
const stop=()=>{if(container)execFileSync('docker',['rm','-f',container],{stdio:'ignore'})};
try{
 let store;for(let i=0;i<60&&!store;i++){try{store=await openStore({databaseUrl:url})}catch{await new Promise(r=>setTimeout(r,1000))}}
 assert.ok(store,'Postgres did not start');assert.equal(store.kind,'postgres');
 // Twenty concurrent updates to one account must all land, in order, thanks to the row lock.
 await Promise.all(Array.from({length:20},()=>store.update('a.near',async r=>{await new Promise(d=>setTimeout(d,5));return {...r,profile:{...r.profile,n:(r.profile.n||0)+1}}})));
 assert.equal((await store.get('a.near')).profile.n,20);
 await assert.rejects(store.update('a.near',()=>{throw Error('boom')}),/boom/);assert.equal((await store.get('a.near')).profile.n,20,'a failed update must roll back');
 await store.addSession('h1','a.near',Date.now()+6e4);await store.addSession('h2','a.near',Date.now()-36e5);
 assert.equal(await store.session('h1'),'a.near');assert.equal(await store.session('h2'),null,'expired sessions do not count');
 await store.addNonce('n1',Date.now()+6e4);assert.equal(await store.useNonce('n1'),true);assert.equal(await store.useNonce('n1'),false);
 await store.purge();assert.equal((await store.stats()).accounts,1);
 await store.remove('a.near');assert.equal(await store.get('a.near'),null);assert.equal(await store.session('h1'),null,'deleting an account ends its sessions');
 await store.close();
 // The server creates its tables and starts on Postgres.
 const server=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,PORT:'3092',DATABASE_URL:url,NEAR_NETWORK:'testnet',PAYGATE_SECRET:'p'.repeat(40),PUBLIC_URL:'',PAYGATE_FACTORY:'',DATA_DIR:'/tmp/paygate-pg-check'},stdio:['ignore','pipe','inherit']});
 const line=await new Promise((ok,fail)=>{server.stdout.once('data',d=>ok(String(d)));server.once('exit',c=>fail(Error('Server exited: '+c)))});server.kill();
 assert.match(line,/postgres storage/);
 console.log('Postgres checks passed: schema, locked concurrent updates, rollback, sessions, nonces, purge, account deletion, server start.');
}finally{stop()}
