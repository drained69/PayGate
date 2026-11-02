import {createHash,randomUUID} from 'node:crypto';
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function transition(current,c){
 const s=structuredClone(current), cents=n=>{if(typeof n!=='number'||!Number.isFinite(n)||n<1||n>10000||Math.abs(n*100-Math.round(n*100))>1e-7)throw Error('Enter an amount from 1 to 10,000 with at most two decimals.');return Math.round(n*100)};
 if(c.action==='create'){
 const amount=cents(c.amount),pending=s.jobs.filter(j=>!['Paid','Cancelled'].includes(j.status)).reduce((a,j)=>a+Math.round(j.amount*100),0);
 if(amount>Math.round(s.balance*100)-pending)throw Error('Budget exceeds uncommitted balance.');
 for(const [k,max] of [['title',100],['brief',1000]])if(typeof c[k]!=='string'||!c[k].trim()||c[k].length>max)throw Error('Provide a valid '+k+'.');
 if(!['Atlas · Research','Quill · Content','Ledger · Finance'].includes(c.agent))throw Error('Unknown agent.');
 s.jobs.unshift({id:'NC-'+randomUUID().slice(0,8),title:c.title.trim(),brief:c.brief.trim(),agent:c.agent,amount:amount/100,status:'Working',created:new Date().toISOString()});
 }else if(c.action==='limits')s.limit=cents(c.limit)/100;
 else if(c.action==='freeze'){if(typeof c.freeze!=='boolean')throw Error('Invalid freeze state.');s.freeze=c.freeze;}
 else{
 const j=s.jobs.find(j=>j.id===c.id);if(!j)throw Error('Job not found.');
 if(c.action==='complete'){if(j.status!=='Working')throw Error('Job is not running.');j.status='Review';j.deliverable=c.delivery?.text||`DEMO DELIVERY\nAssignment: ${j.title}\nBrief received: ${j.brief}\nReview accuracy and completeness before payment.\nThis sample is not actual agent work.`;if(c.delivery)j.inference=c.delivery.inference;}
 else if(c.action==='quote'){if(j.status!=='Review')throw Error('Job must be awaiting review.');j.quote=c.quote;}
 else if(c.action==='cancel'){if(!['Working','Review'].includes(j.status))throw Error('Job cannot be cancelled.');j.status='Cancelled';}
 else if(c.action==='pay'){
 if(j.status!=='Review')throw Error('Job must be awaiting review.');if(s.freeze)throw Error('Payments are frozen.');if(j.amount>s.limit)throw Error('Payment exceeds your limit.');if(j.amount>s.balance)throw Error('Insufficient balance.');
 s.balance=(Math.round(s.balance*100)-Math.round(j.amount*100))/100;s.spent=(Math.round(s.spent*100)+Math.round(j.amount*100))/100;j.status='Paid';
 const r={id:randomUUID(),job:j.title,jobId:j.id,amount:j.amount,agent:j.agent,date:new Date().toISOString(),policy:{limit:s.limit,approvedBy:'local-owner'},mode:c.settlement?.network||'simulation',hardwareAttested:false,inference:j.inference||null,settlementQuote:j.quote||null,settlement:c.settlement||null,previousHash:s.receipts[0]?.hash||null};s.receipts.unshift({...r,hash:hash(r)});
 }else throw Error('Unknown action.');
 }s.updatedAt=new Date().toISOString();return s;
}
