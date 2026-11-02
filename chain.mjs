import {readFile} from 'node:fs/promises';
import {Account,JsonRpcProvider,KeyPair,KeyPairSigner,actions,nearToYocto} from 'near-api-js';
const TGAS=1000000000000n,ONE_YOCTO=1n,GAS=60n*TGAS;
export const CODE=new URL('./contract/res/nocturne_vault.wasm',import.meta.url);
export const accountFor=(rpcUrl,id,secretKey)=>new Account(id,new JsonRpcProvider({url:rpcUrl}),KeyPairSigner.fromSecretKey(secretKey));
// Node errors arrive in several shapes. Contract panics are reduced to the contract's own sentence.
export function reason(e){const m=String(e?.message||e);return m.match(/Smart contract panicked: ([^"\n]+)/)?.[1]?.trim()||m.slice(0,300)}
export const txHash=r=>r.transaction?.hash||r.transaction_outcome?.id;
// Creates the vault, a restricted agent and a worker under the owner account. The agent ends with one key, which can call only request_payment on the vault.
export async function provision({rpcUrl,owner,limits,vaultNear='5',unitYocto}){
 const id=name=>`${name}.${owner.accountId}`,vaultKey=KeyPair.fromRandom('ed25519'),agentKey=KeyPair.fromRandom('ed25519'),workerKey=KeyPair.fromRandom('ed25519'),agentFullKey=KeyPair.fromRandom('ed25519');
 const code=new Uint8Array(await readFile(CODE));
 await owner.signAndSendTransaction({receiverId:id('vault'),actions:[actions.createAccount(),actions.transfer(nearToYocto(vaultNear)),actions.addFullAccessKey(vaultKey.getPublicKey()),actions.deployContract(code)]});
 const vaultAdmin=accountFor(rpcUrl,id('vault'),vaultKey.toString());
 await vaultAdmin.callFunction({contractId:id('vault'),methodName:'new',args:{owner:owner.accountId,agent:id('agent'),limits},gas:GAS});
 await owner.createAccount({newAccountId:id('agent'),publicKey:agentFullKey.getPublicKey(),nearToTransfer:nearToYocto('1')});
 await owner.createAccount({newAccountId:id('worker'),publicKey:workerKey.getPublicKey(),nearToTransfer:nearToYocto('0.01')});
 const agentAdmin=accountFor(rpcUrl,id('agent'),agentFullKey.toString());
 await agentAdmin.addFunctionCallAccessKey({publicKey:agentKey.getPublicKey(),contractId:id('vault'),methodNames:['request_payment'],allowance:nearToYocto('0.5')});
 await agentAdmin.deleteKey(agentFullKey.getPublicKey());
 // The vault is left with no keys, so the rules can only change through its owner methods.
 await owner.callFunction({contractId:id('vault'),methodName:'set_recipient',args:{recipient:id('worker'),allowed:true},deposit:ONE_YOCTO,gas:GAS});
 await vaultAdmin.deleteKey(vaultKey.getPublicKey());
 return {rpcUrl,vault:id('vault'),agent:id('agent'),worker:id('worker'),owner:owner.accountId,agentKey:agentKey.toString(),unitYocto:String(unitYocto||0)};
}
// All signing goes through one queue, because concurrent transactions from one key collide on its nonce.
export function vaultClient(config,ownerKey){
 const {rpcUrl,vault,agent,worker,owner}=config,provider=new JsonRpcProvider({url:rpcUrl}),unit=BigInt(config.unitYocto),agentAccount=accountFor(rpcUrl,agent,config.agentKey),ownerAccount=accountFor(rpcUrl,owner,ownerKey);
 let queue=Promise.resolve();const serial=fn=>{const run=queue.then(fn);queue=run.catch(()=>{});return run};
 const view=(method,args={})=>provider.callFunction({contractId:vault,method,args,blockQuery:{finality:'optimistic'}});
 const ownerCall=(methodName,args)=>serial(()=>ownerAccount.callFunctionRaw({contractId:vault,methodName,args,deposit:ONE_YOCTO,gas:GAS}));
 const yocto=usdc=>String(BigInt(Math.round(usdc*100))*unit/100n);
 const toNear=y=>Number(BigInt(y)/1000000000000000000n)/1e6;
 return {
  network:config.network,vault,
  async policy(){const p=await view('get_policy');return {...p,spendable:toNear(p.balance),spent:toNear(p.spent_in_window),limits:{auto:toNear(p.limits.auto_limit),max:toNear(p.limits.max_payment),daily:toNear(p.limits.daily_limit)}}},
  // Asks as the agent, then approves as the owner only when the contract holds the payment back.
  async pay(job){
   const amount=yocto(job.amount);let requested=null,id,status;
   try{
    requested=await serial(()=>agentAccount.callFunctionRaw({contractId:vault,methodName:'request_payment',args:{recipient:worker,amount,job_id:job.id},gas:GAS}));
    ({id,status}=JSON.parse(Buffer.from(requested.status.SuccessValue,'base64').toString()));
   }catch(e){
    // An earlier attempt may have stopped after the request landed. Resume it only if it asks for exactly what this job owes, because the agent key could have placed it.
    const held=/already been paid or requested/.test(reason(e))?(await view('get_pending')).find(p=>p.job_id===job.id):null;
    if(!held)throw e;
    if(held.recipient!==worker||held.amount!==amount)throw Error('A pending payment for this job has different terms. Review it on-chain.');
    ({id}=held);status='pending';
   }
   let approved=null;
   if(status==='pending'){try{approved=await ownerCall('approve_payment',{id})}catch(e){await ownerCall('reject_payment',{id}).catch(()=>{});throw e}}
   return {network:config.network,vault,recipient:worker,paymentId:id,route:approved?'owner-approved':'auto',amountYocto:amount,txHash:txHash(approved||requested)};
  },
  freeze:frozen=>ownerCall('set_frozen',{frozen}),
  async setMax(usdc){const {limits}=await view('get_policy'),max=yocto(usdc),auto=BigInt(limits.auto_limit)<BigInt(max)?limits.auto_limit:max;return ownerCall('set_limits',{limits:{...limits,auto_limit:auto,max_payment:max}})}
 };
}
