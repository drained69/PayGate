import {createHash,randomBytes} from 'node:crypto';
const env=process.env,cloud=()=>env.NEAR_AI_URL||'https://cloud-api.near.ai/v1',oneClick=()=>env.ONECLICK_URL||'https://1click.chaindefuser.com/v0',model=()=>env.NEAR_AI_MODEL||'qwen/qwen3.5-397b-a17b';
const WNEAR='nep141:wrap.near',USDC_NEAR='nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function request(url,options,ms,label){let r;try{r=await fetch(url,{...options,signal:AbortSignal.timeout(ms)})}catch{throw Error(label+' is unreachable.')}if(!r.ok)throw Error(`${label} returned ${r.status}.`);return r}
export const integrations=hasKey=>[
 {name:'NEAR AI Cloud inference',state:hasKey?'live':'off',detail:hasKey?`Your agent runs on ${model()}`:'Add your NEAR AI API key in Settings so the agent can do the work. Until then, record deliveries yourself.'},
 {name:'NEAR AI Cloud attestation',state:'live',detail:'Public report, checked from the Evidence room'},
 {name:'NEAR Intents 1Click',state:'live',detail:'Live NEAR to USDC price for each payment. Quotes only, no swap is made.'}
];
// Values a payment in dollars with a dry 1Click quote. `dry` returns no deposit address, so nothing can be sent through it.
// The quote prices NEAR, not the payee, so it names the `near` account: 1Click rejects accounts that do not exist on mainnet.
export async function usdValue(job){
 const r=await request(oneClick()+'/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dry:true,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:WNEAR,depositType:'ORIGIN_CHAIN',destinationAsset:USDC_NEAR,amount:String(BigInt(Math.round(job.amount*1e4))*10n**20n),refundTo:'near',refundType:'ORIGIN_CHAIN',recipient:'near',recipientType:'DESTINATION_CHAIN',deadline:new Date(Date.now()+36e5).toISOString()})},25000,'NEAR Intents');
 const {quote:q,correlationId,timestamp}=await r.json();
 if(!q?.amountOutFormatted)throw Error('NEAR Intents returned no quote.');
 return {source:'NEAR Intents 1Click',usd:Number(q.amountInUsd||q.amountOutUsd||q.amountOutFormatted),usdc:q.amountOutFormatted,correlationId,quotedAt:timestamp};
}
// Cross-chain payouts: a USDC vault pays a NEAR Intents deposit address, and 1Click delivers USDC to the payee's
// address on another chain. Only these chains are offered; their USDC asset IDs are read from 1Click itself.
export const CHAINS={base:{name:'Base',family:'evm'},arb:{name:'Arbitrum',family:'evm'},eth:{name:'Ethereum',family:'evm'},op:{name:'Optimism',family:'evm'},pol:{name:'Polygon',family:'evm'},avax:{name:'Avalanche',family:'evm'},sol:{name:'Solana',family:'sol'}};
const jwt=()=>env.ONECLICK_JWT?{Authorization:'Bearer '+env.ONECLICK_JWT}:{};
let assets=null;
export async function crossChainAssets(){
 if(assets&&assets.until>Date.now())return assets.list;
 const r=await request(oneClick()+'/tokens',{headers:{Accept:'application/json'}},15000,'NEAR Intents');
 const list=(await r.json()).filter(t=>t.symbol==='USDC'&&CHAINS[t.blockchain]).map(t=>({chain:t.blockchain,name:CHAINS[t.blockchain].name,assetId:t.assetId,decimals:t.decimals}));
 assets={list,until:Date.now()+36e5};return list;
}
// A live quote with a deposit address. Unfilled or failed swaps refund to the vault owner's NEAR account, because
// a plain token transfer back to the vault would not be counted by its ledger.
export async function crossChainQuote({originAsset,amountUnits,chain,address,refundTo,minutes=30}){
 const asset=(await crossChainAssets()).find(a=>a.chain===chain);if(!asset)throw Error('NEAR Intents does not offer USDC on that chain right now.');
 const r=await request(oneClick()+'/quote',{method:'POST',headers:{'Content-Type':'application/json',...jwt()},body:JSON.stringify({dry:false,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:'nep141:'+originAsset,depositType:'ORIGIN_CHAIN',destinationAsset:asset.assetId,amount:String(amountUnits),refundTo,refundType:'ORIGIN_CHAIN',recipient:address,recipientType:'DESTINATION_CHAIN',deadline:new Date(Date.now()+minutes*6e4).toISOString(),referral:'paygate'})},20000,'NEAR Intents');
 const {quote:q,correlationId,timestamp}=await r.json();
 if(!q?.depositAddress||!/^[0-9a-f]{64}$/.test(q.depositAddress))throw Error('NEAR Intents returned no NEAR deposit address.');
 if(q.amountIn&&q.amountIn!==String(amountUnits))throw Error('NEAR Intents quoted a different amount.');
 return {depositAddress:q.depositAddress,amountOut:q.amountOutFormatted,minAmountOut:q.minAmountOut,deadline:q.deadline,timeEstimate:q.timeEstimate,correlationId,quotedAt:timestamp,chain,address,refundTo};
}
export async function crossChainSubmit(txHash,depositAddress){await fetch(oneClick()+'/deposit/submit',{method:'POST',headers:{'Content-Type':'application/json',...jwt()},body:JSON.stringify({txHash,depositAddress}),signal:AbortSignal.timeout(10000)}).catch(()=>{})}
export async function crossChainStatus(depositAddress){
 const url=new URL(oneClick()+'/status');url.search=new URLSearchParams({depositAddress});
 const d=await (await request(url,{headers:{Accept:'application/json',...jwt()}},15000,'NEAR Intents')).json();
 const tx=d.swapDetails?.destinationChainTxHashes?.[0];
 return {status:d.status||'UNKNOWN',destinationTx:tx?.hash||null,destinationExplorer:/^https:\/\//.test(tx?.explorerUrl||'')?tx.explorerUrl:null,amountOut:d.swapDetails?.amountOutFormatted||null,checkedAt:new Date().toISOString()};
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
// Runs a job on NEAR AI Cloud with the customer's own key. Prompts and replies are stored in their workspace and never logged.
export async function deliver(job,apiKey){
 const auth={Authorization:'Bearer '+apiKey},body=JSON.stringify({model:model(),max_tokens:900,messages:[{role:'system',content:`You are an AI agent working for a company through PayGate. Complete the assignment in under 300 words. If it needs facts you do not have, say so instead of inventing them.`},{role:'user',content:`Assignment: ${job.title}\nBrief: ${job.brief}`}]});
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
