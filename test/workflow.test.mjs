import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transition,hash} from '../domain.mjs';
import {initial} from '../seed.mjs';
test('freeze and limits reject payments without modifying ledger',()=>{
for(const extra of [{freeze:true},{limit:100}]){const s={...structuredClone(initial),...extra};assert.throws(()=>transition(s,{action:'pay',id:'NC-104'}));assert.equal(s.balance,24850);}
});
test('settlement is once only, with hash-linked evidence',()=>{const s=transition(initial,{action:'pay',id:'NC-104'});assert.equal(s.balance,24670);assert.throws(()=>transition(s,{action:'pay',id:'NC-104'}));const {hash:digest,...body}=s.receipts[0];assert.equal(hash(body),digest);assert.equal(body.hardwareAttested,false);});
test('validates amounts and available funds',()=>{for(const amount of [-1,NaN,Infinity,1.111,10001])assert.throws(()=>transition(initial,{action:'create',amount}));assert.throws(()=>transition({...initial,balance:500},{action:'create',amount:20,title:'a',brief:'b',agent:'Atlas · Research'}));});
test('full job lifecycle and cancellation',()=>{let s=transition(initial,{action:'create',amount:20,title:'Report',brief:'Prepare report',agent:'Atlas · Research'});const id=s.jobs[0].id;assert.throws(()=>transition(s,{action:'pay',id}));s=transition(s,{action:'complete',id});assert.match(s.jobs[0].deliverable,/DEMO/);s=transition(s,{action:'cancel',id});assert.equal(s.jobs[0].status,'Cancelled');assert.throws(()=>transition(s,{action:'pay',id}));});
