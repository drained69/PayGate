import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transition,empty,verify,committed,external} from '../domain.mjs';
const job={action:'create',amount:0.25,title:'Report',brief:'Prepare report',payee:'payee.near'};
const settlement={network:'sandbox',vault:'v.near',paymentId:1,route:'auto',txHash:'tx'};
test('a job runs from creation to a hash-linked receipt, and is paid once',()=>{
 let s=transition(empty(),job);const id=s.jobs[0].id;assert.match(id,/^PG-[a-f0-9]{8}$/);
 assert.throws(()=>transition(s,{action:'paid',id,settlement}),/awaiting review/);
 s=transition(s,{action:'deliver',id,text:'Report delivered at https://example.com/r'});assert.equal(s.jobs[0].source,'Recorded by owner');
 s=transition(s,{action:'paid',id,settlement});assert.equal(s.jobs[0].status,'Paid');assert.throws(()=>transition(s,{action:'paid',id,settlement}));
 s=transition(s,{...job,title:'Second'});s=transition(transition(s,{action:'deliver',id:s.jobs[0].id,text:'x'}),{action:'paid',id:s.jobs[0].id,settlement});assert.equal(s.receipts[0].previousHash,s.receipts[1].hash);
 assert.equal(s.receipts[0].currency,'NEAR');assert.equal(s.receipts[0].amount,0.25);assert.ok(verify(s.receipts));
 const forged=structuredClone(s.receipts);forged[0].amount=99;assert.equal(verify(forged),false);
});
test('large payments wait for approval and a rejection returns the job to review',()=>{
 let s=transition(empty(),job);const id=s.jobs[0].id;s=transition(s,{action:'deliver',id,text:'done'});
 s=transition(s,{action:'requested',id,payment:{paymentId:7}});assert.equal(s.jobs[0].status,'Awaiting approval');assert.throws(()=>transition(s,{action:'cancel',id}));
 s=transition(s,{action:'released',id});assert.equal(s.jobs[0].status,'Review');assert.equal(s.jobs[0].payment,undefined);
});
test('validates amounts, payees and the vault limits passed in by the server',()=>{
 for(const amount of [-1,0,NaN,Infinity,0.00001,10001])assert.throws(()=>transition(empty(),{...job,amount}),/0.0001 to 10,000/);
 for(const payee of ['','Bad Name','a','x'.repeat(65),undefined])assert.throws(()=>transition(empty(),{...job,payee}),/payee/);
 assert.throws(()=>transition(empty(),{...job,allowed:['other.near']}),/allowlist/);
 assert.throws(()=>transition(empty(),{...job,max:0.2}),/per-payment limit/);
 const s=transition(empty(),{...job,available:0.4});assert.equal(committed(s),0.25);
 assert.throws(()=>transition(s,{...job,available:0.4}),/not already committed/);
 assert.throws(()=>transition(empty(),{...job,title:' '}),/title/);
});
test('owner deliveries, cancellation and payee labels',()=>{
 let s=transition(empty(),job);const id=s.jobs[0].id;
 assert.throws(()=>transition(s,{action:'deliver',id,text:''}),/delivery/);
 s=transition(s,{action:'cancel',id});assert.equal(s.jobs[0].status,'Cancelled');assert.equal(committed(s),0);
 s=transition(s,{action:'label',account:'payee.near',label:'Research'});assert.equal(s.payees['payee.near'],'Research');
 s=transition(s,{action:'label',account:'payee.near',label:''});assert.equal(s.payees['payee.near'],undefined);
 assert.throws(()=>transition(s,{action:'label',account:'NOPE',label:'x'}));
});
test('a workspace cannot grow without bound',()=>{
 const s=empty();s.jobs=Array.from({length:2000},(_,i)=>({id:'PG-'+i,status:'Cancelled',amount:1}));assert.throws(()=>transition(s,job),/2,000 jobs/);
 const t=empty();for(let i=0;i<200;i++)t.payees[`p${i}.near`]='x';assert.throws(()=>transition(t,{action:'label',account:'new.near',label:'y'}),/200 payees/);assert.equal(transition(t,{action:'label',account:'p1.near',label:'z'}).payees['p1.near'],'z');
});
test('payees on other chains are checked per chain and need the owner to approve with a quote',()=>{
 const evm='0x'+'ab'.repeat(20);
 assert.deepEqual(external('base:'+evm),{chain:'base',address:evm,name:'Base'});
 assert.equal(external('sol:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').name,'Solana');
 for(const bad of ['base:0x123','sol:0x'+'ab'.repeat(20),'doge:'+evm,'base:'+evm+'00','payee.near',''])assert.equal(external(bad),null,bad);
 let s=transition(empty(),{...job,payee:'base:'+evm,allowed:['base:'+evm]});const id=s.jobs[0].id;
 assert.throws(()=>transition(empty(),{...job,payee:'base:0x123'}),/Choose a payee/);
 s=transition(s,{action:'deliver',id,text:'Done'});
 assert.throws(()=>transition(s,{action:'bridge-quote',id,bridge:{}}),/cross-chain approval/);
 s=transition(s,{action:'requested',id,payment:{paymentId:null,external:{chain:'base',address:evm}}});
 s=transition(s,{action:'bridge-quote',id,bridge:{depositAddress:'cd'.repeat(32)}});assert.equal(s.jobs[0].payment.bridge.depositAddress,'cd'.repeat(32));
 s=transition(s,{action:'label',account:'base:'+evm,label:'Designer'});assert.equal(s.payees['base:'+evm],'Designer');
});
