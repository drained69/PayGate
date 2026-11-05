import http from 'node:http';
import {createHash} from 'node:crypto';
export function report(nonce,overrides={}){
 const signing_address='ab'.repeat(32),app_compose='{"sample":true}',quote=Buffer.alloc(5000);
 quote.writeUInt16LE(4,0);quote.writeUInt32LE(0x81,4);
 Buffer.from('01'+createHash('sha256').update(app_compose).digest('hex')+'00'.repeat(15),'hex').copy(quote,232);
 Buffer.from(signing_address+nonce,'hex').copy(quote,568);
 return {gateway_attestation:{signing_address,request_nonce:nonce,intel_quote:quote.toString('hex'),info:{tcb_info:{app_compose}}},model_attestations:[{model:'stub/model',provider:'stub',nonce,tcb_status:'UpToDate',gpu_verdict:'PASS'}],...overrides};
}
// Stands in for NEAR AI Cloud and 1Click so tests need no network or API key.
export async function startStub(port=0){
 const seen={quotes:[],chats:[],deposits:[],submitted:[]};
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const url=new URL(req.url,'http://stub'),send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
  if(url.pathname==='/tokens')return send(200,[{assetId:'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',decimals:6,blockchain:'base',symbol:'USDC'},{assetId:'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',decimals:6,blockchain:'sol',symbol:'USDC'},{assetId:'nep141:base-0xother.omft.near',decimals:18,blockchain:'base',symbol:'ETH'}]);
  // A real quote returns a fresh deposit address, here an implicit account the local node accepts.
  if(url.pathname==='/quote'&&JSON.parse(raw).dry===false){const body=JSON.parse(raw),depositAddress=createHash('sha256').update(raw+seen.quotes.length).digest('hex');seen.quotes.push(body);seen.deposits.push(depositAddress);return send(201,{quote:{depositAddress,amountIn:body.amount,amountOutFormatted:String(Number(body.amount)/1e6*0.998),minAmountOut:String(Math.floor(Number(body.amount)*0.99)),deadline:body.deadline,timeEstimate:40},correlationId:'stub-live-quote',timestamp:new Date().toISOString()})}
  if(url.pathname==='/deposit/submit'){seen.submitted.push(JSON.parse(raw));return send(200,{status:'KNOWN_DEPOSIT_TX'})}
  if(url.pathname==='/status')return send(200,{status:seen.submitted.some(s=>s.depositAddress===url.searchParams.get('depositAddress'))?'SUCCESS':'PENDING_DEPOSIT',swapDetails:{amountOutFormatted:'4.99',destinationChainTxHashes:[{hash:'0xstubdest',explorerUrl:'https://basescan.org/tx/0xstubdest'}]}});
  if(url.pathname==='/quote'){const body=JSON.parse(raw);seen.quotes.push(body);return send(201,{quote:{amountInUsd:'3.83',amountOutFormatted:'3.80',minAmountOut:'3760000',timeEstimate:22},signature:'ed25519:stub',correlationId:'stub-quote',timestamp:'2026-11-01T00:00:00.000Z'})}
  if(url.pathname==='/chat/completions'){if(!String(req.headers.authorization).startsWith('Bearer test-key'))return send(401,{});seen.chats.push(JSON.parse(raw));return send(200,{id:'chatcmpl-stub',model:'stub/model',choices:[{message:{content:'Stub delivery written by the model <b>stub</b>.'}}]})}
  if(url.pathname==='/signature/chatcmpl-stub')return send(200,{text:'a:b',signature:'0xstub',signing_address:'ab'.repeat(32),signing_algo:'ed25519'});
  if(url.pathname==='/attestation/report')return send(200,report(url.searchParams.get('nonce')));
  send(404,{});
 });
 await new Promise(ready=>server.listen(port,'127.0.0.1',ready));
 return {url:`http://127.0.0.1:${server.address().port}`,seen,close:()=>new Promise(done=>{server.close(done);server.closeAllConnections()})};
}
