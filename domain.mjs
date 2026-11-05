import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isAccountId} from './chain.mjs';
import {CHAINS} from './near.mjs';
// A payee on another chain is written chain:address, such as base:0x… or sol:…. NEAR accounts never contain ':'.
export function external(p){
 const m=/^([a-z]+):(.+)$/.exec(typeof p==='string'?p:'');if(!m||!CHAINS[m[1]])return null;
 const [,chain,address]=m,family=CHAINS[chain].family;
 if(family==='evm'&&!/^0x[0-9a-fA-F]{40}$/.test(address))return null;
 if(family==='sol'&&!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return null;
 return {chain,address,name:CHAINS[chain].name};
}
export const isPayee=p=>isAccountId(p)||Boolean(external(p));
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const empty=()=>({workspace:randomBytes(6).toString('hex'),jobs:[],receipts:[],payees:{}});
// Actions a signed-in owner may send. Every other action is created by the server from on-chain or NEAR AI results.
export const CLIENT_ACTIONS=['create','deliver','cancel','label'];
const OPEN=['Working','Review','Awaiting approval'];
// NEAR with at most four decimals, held as integers of 0.0001 NEAR during arithmetic.
const units=n=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0.0001||n>10000||Math.abs(n*1e4-Math.round(n*1e4))>1e-6)throw Error('Enter an amount from 0.0001 to 10,000 NEAR with at most four decimals.');return Math.round(n*1e4)};
export const committed=s=>s.jobs.filter(j=>OPEN.includes(j.status)).reduce((a,j)=>a+Math.round(j.amount*1e4),0)/1e4;
const text=(v,name,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`Provide a valid ${name}.`);return v.trim()};
export function transition(current,c){
 const s=structuredClone(current);
 if(c.action==='create'){
  const amount=units(c.amount);
  const job={id:'PG-'+randomUUID().slice(0,8),title:text(c.title,'title',100),brief:text(c.brief,'brief',2000),payee:c.payee,amount:amount/1e4,status:'Working',created:new Date().toISOString()};
  if(!isPayee(c.payee))throw Error('Choose a payee account.');
  if(s.jobs.length>=2000)throw Error('This workspace has reached its limit of 2,000 jobs.');
  if(c.allowed&&!c.allowed.includes(c.payee))throw Error('That payee is not on the vault allowlist.');
  if(c.max!==undefined&&job.amount>c.max)throw Error(`Budget exceeds the vault's per-payment limit of ${c.max} NEAR.`);
  if(c.available!==undefined&&amount>Math.round((c.available-committed(s))*1e4))throw Error('Budget exceeds the vault balance not already committed to open jobs.');
  s.jobs.unshift(job);
 }else if(c.action==='label'){
  if(!isPayee(c.account))throw Error('Invalid account.');
  if(c.label==='')delete s.payees[c.account];else{if(!(c.account in s.payees)&&Object.keys(s.payees).length>=200)throw Error('You can label at most 200 payees.');s.payees[c.account]=text(c.label,'label',60)}
 }else{
  const j=s.jobs.find(j=>j.id===c.id);if(!j)throw Error('Job not found.');
  if(c.action==='complete'||c.action==='deliver'){
   if(j.status!=='Working')throw Error('Job is not in progress.');
   if(c.action==='complete'){if(!c.delivery?.text)throw Error('No delivery.');j.deliverable=c.delivery.text;j.inference=c.delivery.inference;j.source='NEAR AI Cloud'}
   else{j.deliverable=text(c.text,'delivery note',8000);j.source='Recorded by owner'}
   j.status='Review';
  }
  else if(c.action==='quote'){if(j.status!=='Review')throw Error('Job must be awaiting review.');j.quote=c.quote}
  else if(c.action==='cancel'){if(!['Working','Review'].includes(j.status))throw Error('Only jobs that are in progress or in review can be cancelled.');j.status='Cancelled'}
  else if(c.action==='requested'){if(j.status!=='Review')throw Error('Job must be awaiting review.');j.status='Awaiting approval';j.payment=c.payment}
  else if(c.action==='bridge-quote'){if(j.status!=='Awaiting approval'||!j.payment?.external)throw Error('Job is not awaiting a cross-chain approval.');j.payment.bridge=c.bridge;j.payment.quotes=[c.bridge,...(j.payment.quotes||[])].slice(0,5)}
  else if(c.action==='released'){if(j.status!=='Awaiting approval')throw Error('Job is not awaiting approval.');j.status='Review';delete j.payment}
  else if(c.action==='paid'){
   if(!['Review','Awaiting approval'].includes(j.status))throw Error('Job must be awaiting review.');
   j.status='Paid';j.paidAt=new Date().toISOString();
   const r={id:randomUUID(),job:j.title,jobId:j.id,payee:j.payee,amount:j.amount,currency:c.settlement?.currency||'NEAR',date:j.paidAt,inference:j.inference||null,deliverySource:j.source||null,usdEstimate:j.quote||null,settlement:c.settlement,previousHash:s.receipts[0]?.hash||null};
   s.receipts.unshift({...r,hash:hash(r)});
  }else throw Error('Unknown action.');
 }
 s.updatedAt=new Date().toISOString();return s;
}
export const verify=receipts=>receipts.every((r,i)=>{const {hash:digest,...body}=r;return hash(body)===digest&&r.previousHash===(receipts[i+1]?.hash||null)});
