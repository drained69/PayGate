import assert from 'node:assert/strict';
import {quote,attestation} from '../near.mjs';
const q=await quote({amount:25});assert.equal(q.dry,true);assert.ok(Number(q.amountOut)>0&&Number(q.amountOut)<=25);console.log(`NEAR Intents dry quote: 25 USDC on NEAR to ${q.amountOut} USDC on Base, about ${q.timeEstimate}s (${q.correlationId})`);
const a=await attestation();for(const c of a.checks){console.log(`${c.pass?'pass':'FAIL'}  ${c.label}`);assert.ok(c.pass,c.label)}console.log(`NEAR AI Cloud report: ${a.model}, TCB ${a.tcbStatus}, GPU ${a.gpuVerdict}, quote ${a.quoteSha256}`);
