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
 const seen={quotes:[],chats:[]};
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const url=new URL(req.url,'http://stub'),send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
  if(url.pathname==='/quote'){const body=JSON.parse(raw);seen.quotes.push(body);return send(201,{quote:{amountInUsd:'3.83',amountOutFormatted:'3.80',minAmountOut:'3760000',timeEstimate:22},signature:'ed25519:stub',correlationId:'stub-quote',timestamp:'2026-11-01T00:00:00.000Z'})}
  if(url.pathname==='/chat/completions'){if(!String(req.headers.authorization).startsWith('Bearer test-key'))return send(401,{});seen.chats.push(JSON.parse(raw));return send(200,{id:'chatcmpl-stub',model:'stub/model',choices:[{message:{content:'Stub delivery written by the model <b>stub</b>.'}}]})}
  if(url.pathname==='/signature/chatcmpl-stub')return send(200,{text:'a:b',signature:'0xstub',signing_address:'ab'.repeat(32),signing_algo:'ed25519'});
  if(url.pathname==='/attestation/report')return send(200,report(url.searchParams.get('nonce')));
  send(404,{});
 });
 await new Promise(ready=>server.listen(port,'127.0.0.1',ready));
 return {url:`http://127.0.0.1:${server.address().port}`,seen,close:()=>new Promise(done=>{server.close(done);server.closeAllConnections()})};
}
