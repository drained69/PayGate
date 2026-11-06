import assert from 'node:assert/strict';
import {usdValue,attestation} from '../src/near.mjs';
const q=await usdValue({amount:1,payee:'wrap.near'});assert.ok(q.usd>0);console.log(`NEAR Intents dry quote: 1 NEAR is worth about $${q.usd} (${q.usdc} USDC after fees, ${q.correlationId})`);
const a=await attestation();for(const c of a.checks){console.log(`${c.pass?'pass':'FAIL'}  ${c.label}`);assert.ok(c.pass,c.label)}console.log(`NEAR AI Cloud report: ${a.model}, TCB ${a.tcbStatus}, GPU ${a.gpuVerdict}, quote ${a.quoteSha256}`);
