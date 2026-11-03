import {readFile} from 'node:fs/promises';
import {Account,JsonRpcProvider,KeyPair,KeyPairSigner,actions,createTransaction,encodeTransaction,baseDecode,nearToYocto} from 'near-api-js';
const TGAS=1000000000000n,ONE_YOCTO=1n,GAS=60n*TGAS,UNIT=10n**20n;
export const CODE=new URL('./contract/res/paygate_vault.wasm',import.meta.url);
export const NETWORKS={
 mainnet:{rpcUrl:'https://free.rpc.fastnear.com',wallet:'https://app.mynearwallet.com',explorer:'https://nearblocks.io/txns/'},
 testnet:{rpcUrl:'https://test.rpc.fastnear.com',wallet:'https://testnet.mynearwallet.com',explorer:'https://testnet.nearblocks.io/txns/'}
};
export const accountFor=(rpcUrl,id,secretKey)=>new Account(id,new JsonRpcProvider({url:rpcUrl}),KeyPairSigner.fromSecretKey(secretKey));
// Node errors arrive in several shapes. Contract panics are reduced to the contract's own sentence.
export function reason(e){const m=String(e?.message||e);return m.match(/Smart contract panicked: ([^"\n]+)/)?.[1]?.trim()||m.slice(0,300)}
export const txHash=r=>r.transaction?.hash||r.transaction_outcome?.id;
// Amounts are NEAR with at most four decimals, kept as integers of 0.0001 NEAR so no float reaches the chain.
export const toYocto=n=>String(BigInt(Math.round(n*1e4))*UNIT);
export const toNear=y=>Number(BigInt(y)/UNIT)/1e4;
export const isAccountId=s=>typeof s==='string'&&s.length>=2&&s.length<=64&&/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s);
const events=outcome=>(outcome?.receipts_outcome||[]).flatMap(r=>r.outcome.logs).filter(l=>l.startsWith('EVENT_JSON:')).map(l=>{try{return JSON.parse(l.slice(11))}catch{return null}}).filter(e=>e?.standard==='paygate_vault');
const found=(outcome,event,id)=>events(outcome).some(e=>e.event===event&&e.data?.some(d=>d.id===id));
// Creates the vault and a restricted agent under the owner account. The agent ends with one key, which can call only request_payment on the vault.
export async function provision({rpcUrl,owner,limits,payees=[],vaultNear='3',agentNear='0.3',allowanceNear='0.25',names={vault:'paygate-vault',agent:'paygate-agent'}}){
 const id=name=>`${names[name]}.${owner.accountId}`,vaultKey=KeyPair.fromRandom('ed25519'),agentKey=KeyPair.fromRandom('ed25519'),agentFullKey=KeyPair.fromRandom('ed25519');
 const code=new Uint8Array(await readFile(CODE));
 await owner.signAndSendTransaction({receiverId:id('vault'),actions:[actions.createAccount(),actions.transfer(nearToYocto(vaultNear)),actions.addFullAccessKey(vaultKey.getPublicKey()),actions.deployContract(code)]});
 const vaultAdmin=accountFor(rpcUrl,id('vault'),vaultKey.toString());
 await vaultAdmin.callFunction({contractId:id('vault'),methodName:'new',args:{owner:owner.accountId,agent:id('agent'),limits},gas:GAS});
 await owner.createAccount({newAccountId:id('agent'),publicKey:agentFullKey.getPublicKey(),nearToTransfer:nearToYocto(agentNear)});
 const agentAdmin=accountFor(rpcUrl,id('agent'),agentFullKey.toString());
 await agentAdmin.addFunctionCallAccessKey({publicKey:agentKey.getPublicKey(),contractId:id('vault'),methodNames:['request_payment'],allowance:nearToYocto(allowanceNear)});
 await agentAdmin.deleteKey(agentFullKey.getPublicKey());
 for(const recipient of payees)await owner.callFunction({contractId:id('vault'),methodName:'set_recipient',args:{recipient,allowed:true},deposit:ONE_YOCTO,gas:GAS});
 // The vault is left with no keys, so the rules can only change through its owner methods.
 await vaultAdmin.deleteKey(vaultKey.getPublicKey());
 return {rpcUrl,vault:id('vault'),agent:id('agent'),owner:owner.accountId,agentKey:agentKey.toString()};
}
// The server holds only the agent's function-call key. Owner actions are built here and signed in the owner's wallet.
export function vaultClient(config){
 const {rpcUrl,vault,agent,owner,network}=config,net=NETWORKS[network]||{},provider=new JsonRpcProvider({url:rpcUrl}),agentAccount=accountFor(rpcUrl,agent,config.agentKey);
 let queue=Promise.resolve();const serial=fn=>{const run=queue.then(fn);queue=run.catch(()=>{});return run};
 const view=(method,args={})=>provider.callFunction({contractId:vault,method,args,blockQuery:{finality:'optimistic'}});
 const outcome=hash=>provider.viewTransactionStatus({txHash:hash,accountId:owner,waitUntil:'EXECUTED_OPTIMISTIC'});
 return {
  network,vault,owner,agent,walletUrl:config.walletUrl||net.wallet||null,
  explorer:hash=>net.explorer?net.explorer+hash:null,
  async policy(){const p=await view('get_policy');return {...p,spendable:toNear(p.balance),spent:toNear(p.spent_in_window),limits:{auto:toNear(p.limits.auto_limit),max:toNear(p.limits.max_payment),daily:toNear(p.limits.daily_limit)}}},
  pending:()=>view('get_pending'),
  recipients:()=>view('get_recipients'),
  // Asks as the agent. Small payments go out at once; larger ones wait for the owner's wallet.
  async request(job,key){
   const amount=toYocto(job.amount);let result,id,status;
   try{
    result=await serial(()=>agentAccount.callFunctionRaw({contractId:vault,methodName:'request_payment',args:{recipient:job.payee,amount,job_id:key},gas:GAS}));
    ({id,status}=JSON.parse(Buffer.from(result.status.SuccessValue,'base64').toString()));
   }catch(e){
    // An earlier attempt may have stopped after the request landed. Resume it only if it asks for exactly what this job owes, because the agent key could have placed it.
    const held=/already been paid or requested/.test(reason(e))?(await view('get_pending')).find(p=>p.job_id===key):null;
    if(!held&&/already been paid or requested/.test(reason(e)))throw Error('The vault already paid this job. Check the vault account on the explorer before trying again.');
    if(!held)throw e;
    if(held.recipient!==job.payee||held.amount!==amount)throw Error('A pending payment for this job has different terms. Review it on-chain.');
    return {paymentId:held.id,status:'pending',amountYocto:amount,txHash:null};
   }
   if(status==='sent'&&found(result,'payment_failed',id))throw Error(`The transfer to ${job.payee} failed and was refunded to the vault.`);
   return {paymentId:id,status,amountYocto:amount,txHash:txHash(result)};
  },
  // An unsigned owner call for the wallet's /sign page. The wallet replaces the key and nonce with the owner's own.
  async ownerLink(methodName,args,callbackUrl){
   if(!this.walletUrl)throw Error('No wallet is available for this network.');
   const block=await provider.viewBlock({finality:'final'});
   const tx=createTransaction(owner,KeyPair.fromRandom('ed25519').getPublicKey(),vault,0n,[actions.functionCall(methodName,args,GAS,ONE_YOCTO)],baseDecode(block.header.hash));
   return `${this.walletUrl}/sign?${new URLSearchParams({transactions:Buffer.from(encodeTransaction(tx)).toString('base64'),callbackUrl})}`;
  },
  // Checks on-chain that the owner really signed this call and that it succeeded. A callback URL alone proves nothing.
  async confirmOwner(hash,methods,check=()=>true){
   if(typeof hash!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash))throw Error('Invalid transaction hash.');
   let r;try{r=await outcome(hash)}catch{throw Error('Transaction not found on '+network+'.')}
   const t=r.transaction,call=t?.actions?.[0]?.FunctionCall,args=call?JSON.parse(Buffer.from(call.args,'base64').toString()):null;
   if(t.signer_id!==owner||t.receiver_id!==vault||![].concat(methods).includes(call?.method_name)||!check(args))throw Error('That transaction is not the expected owner action.');
   if(r.status?.SuccessValue===undefined)throw Error('The owner transaction failed: '+reason(JSON.stringify(r.status)));
   return {outcome:r,args,method:call.method_name};
  },
  found
 };
}
