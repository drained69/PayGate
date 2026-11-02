import {createHash,randomBytes} from 'node:crypto';
const env=process.env,cloud=()=>env.NEAR_AI_URL||'https://cloud-api.near.ai/v1',oneClick=()=>env.ONECLICK_URL||'https://1click.chaindefuser.com/v0',model=()=>env.NEAR_AI_MODEL||'qwen/qwen3.5-397b-a17b';
const USDC_NEAR='nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',USDC_BASE='nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function request(url,options,ms,label){let r;try{r=await fetch(url,{...options,signal:AbortSignal.timeout(ms)})}catch{throw Error(label+' is unreachable.')}if(!r.ok)throw Error(`${label} returned ${r.status}.`);return r}
export const hasInferenceKey=()=>Boolean(env.NEAR_AI_API_KEY);
export const integrations=()=>[
 {name:'NEAR AI Cloud inference',state:hasInferenceKey()?'live':'off',detail:hasInferenceKey()?`Agents run on ${model()}`:'Set NEAR_AI_API_KEY to replace sample deliveries'},
 {name:'NEAR AI Cloud attestation',state:'live',detail:'Public report, checked from the Evidence room'},
 {name:'NEAR Intents 1Click',state:'live',detail:'Dry quotes only. No deposit address, no funds moved'},
 {name:'NEAR Business',state:'off',detail:'Not connected'},
 {name:'OutLayer',state:'off',detail:'Not connected'},
 {name:'Agent Market',state:'off',detail:'Not connected'}
];
// Dry quote for paying an agent. Without `dry` the API would return a live deposit address, so it stays hard-coded.
export async function quote(job){
 const recipient=env.PAYOUT_RECIPIENT||'0x1111111111111111111111111111111111111111';
 const r=await request(oneClick()+'/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dry:true,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:USDC_NEAR,depositType:'ORIGIN_CHAIN',destinationAsset:USDC_BASE,amount:String(Math.round(job.amount*100)*10000),refundTo:env.PAYOUT_REFUND||'sample.near',refundType:'ORIGIN_CHAIN',recipient,recipientType:'DESTINATION_CHAIN',deadline:new Date(Date.now()+36e5).toISOString()})},25000,'NEAR Intents');
 const {quote:q,signature,correlationId,timestamp}=await r.json();
 if(!q?.amountOutFormatted)throw Error('NEAR Intents returned no quote.');
 return {dry:true,source:'NEAR Intents 1Click',route:'USDC on NEAR to USDC on Base',recipient,amountOut:q.amountOutFormatted,minAmountOut:q.minAmountOut,timeEstimate:q.timeEstimate,signature,correlationId,quotedAt:timestamp};
}
// Reads the TDX quote directly, because the JSON fields around it are only copies. Offsets: 48-byte header, then MRCONFIGID at +184 and REPORTDATA at +520 of the report body.
export function checkReport(report,nonce){
 const g=report.gateway_attestation,quoteBytes=Buffer.from(g?.intel_quote||'','hex');
 const tdx=quoteBytes.length>632&&quoteBytes.readUInt16LE(0)===4&&quoteBytes.readUInt32LE(4)===0x81;
 const tcb=g?.info?.tcb_info,compose=(typeof tcb==='string'?JSON.parse(tcb):tcb)?.app_compose,m=report.model_attestations?.[0];
 return {checks:[
  {label:'Report is an Intel TDX v4 quote',pass:tdx},
  {label:'Quote is bound to the nonce this server generated',pass:tdx&&quoteBytes.subarray(568,632).toString('hex')===g.signing_address+nonce},
  {label:'Quote matches the gateway configuration in the report',pass:tdx&&typeof compose==='string'&&quoteBytes.subarray(232,280).toString('hex')==='01'+sha(compose)+'00'.repeat(15)},
  {label:'Model report answers the same nonce',pass:m?.nonce===nonce}
 ],signingAddress:g?.signing_address||null,quoteSha256:quoteBytes.length?sha(quoteBytes):null,model:m?.model||model(),modelProvider:m?.provider||null,tcbStatus:m?.tcb_status||null,gpuVerdict:m?.gpu_verdict||null,dcapVerified:false};
}
export async function attestation(){
 const nonce=randomBytes(32).toString('hex'),url=new URL(cloud()+'/attestation/report');
 url.search=new URLSearchParams({model:model(),nonce,signing_algo:'ed25519'});
 const r=await request(url,{headers:{Accept:'application/json'}},60000,'NEAR AI Cloud');
 return {...checkReport(await r.json(),nonce),nonce,checkedAt:new Date().toISOString()};
}
// Runs a job on NEAR AI Cloud. Prompts and replies stay in the local workspace and are never logged.
export async function deliver(job){
 const auth={Authorization:'Bearer '+env.NEAR_AI_API_KEY},body=JSON.stringify({model:model(),max_tokens:900,messages:[{role:'system',content:`You are ${job.agent}, an agent hired by a small company. Complete the assignment in under 300 words. If it needs facts you do not have, say so instead of inventing them.`},{role:'user',content:`Assignment: ${job.title}\nBrief: ${job.brief}`}]});
 const r=await request(cloud()+'/chat/completions',{method:'POST',headers:{...auth,'Content-Type':'application/json','Accept-Encoding':'identity'},body},120000,'NEAR AI Cloud');
 const raw=await r.text(),reply=JSON.parse(raw),text=reply.choices?.[0]?.message?.content;
 if(!text)throw Error('NEAR AI Cloud returned no delivery.');
 return {text:text.slice(0,8000),inference:{provider:'NEAR AI Cloud',model:reply.model||model(),chatId:reply.id,requestHash:sha(body),responseHash:sha(raw),signature:await signature(reply.id,auth)}};
}
// The signature can lag the reply, so this retries briefly. A missing signature is recorded as null, never treated as verified.
async function signature(id,auth){
 for(let i=0;i<3;i++){
  if(i)await new Promise(done=>setTimeout(done,1500));
  const r=await fetch(`${cloud()}/signature/${encodeURIComponent(id)}?signing_algo=ed25519`,{headers:auth,signal:AbortSignal.timeout(15000)}).catch(()=>null);
  if(r?.ok){const s=await r.json();if(s.signature)return {text:s.text,signature:s.signature,signingAddress:s.signing_address,algorithm:s.signing_algo}}
 }
 return null;
}
