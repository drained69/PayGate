import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Account,JsonRpcProvider,KeyPair,KeyPairSigner,PublicKey,actions,createTransaction,encodeTransaction,baseDecode,baseEncode,nearToYocto} from 'near-api-js';
const TGAS=1000000000000n,ONE_YOCTO=1n,GAS=60n*TGAS,UNIT=10n**20n;
export const CODE=new URL('./contract/res/paygate_vault.wasm',import.meta.url);
export const FACTORY_CODE=new URL('./contract/res/paygate_factory.wasm',import.meta.url);
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
const isHash=h=>typeof h==='string'&&/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h);
export const events=(outcome,standard)=>(outcome?.receipts_outcome||[]).flatMap(r=>r.outcome.logs).filter(l=>l.startsWith('EVENT_JSON:')).map(l=>{try{return JSON.parse(l.slice(11))}catch{return null}}).filter(e=>e?.standard===standard);
// NEP-297 `data` may be one object or a list, depending on the emitter.
const items=e=>[].concat(e?.data??[]);
const found=(outcome,event,id)=>events(outcome,'paygate_vault').some(e=>e.event===event&&items(e).some(d=>d.id===id));
// An unsigned call for a wallet's /sign page. The wallet replaces the key and nonce with the signer's own.
export async function walletLink({provider,walletUrl,signer,receiver,method,args,deposit=ONE_YOCTO,gas=GAS,callbackUrl}){
 if(!walletUrl)throw Error('No wallet is available for this network.');
 const block=await provider.viewBlock({finality:'final'});
 const tx=createTransaction(signer,KeyPair.fromRandom('ed25519').getPublicKey(),receiver,0n,[actions.functionCall(method,args,gas,BigInt(deposit))],baseDecode(block.header.hash));
 return `${walletUrl}/sign?${new URLSearchParams({transactions:Buffer.from(encodeTransaction(tx)).toString('base64'),callbackUrl})}`;
}
// Checks on-chain that `signer` really sent this call and that it succeeded. A wallet callback alone proves nothing.
export async function checkTx(provider,hash,{signer,receiver,methods,check=()=>true,network}){
 if(!isHash(hash))throw Error('Invalid transaction hash.');
 let r;try{r=await provider.viewTransactionStatus({txHash:hash,accountId:signer,waitUntil:'EXECUTED_OPTIMISTIC'})}catch{throw Error('Transaction not found on '+network+'.')}
 const t=r.transaction,call=t?.actions?.[0]?.FunctionCall,args=call?JSON.parse(Buffer.from(call.args,'base64').toString()):null;
 if(t.signer_id!==signer||t.receiver_id!==receiver||![].concat(methods).includes(call?.method_name)||!check(args,call))throw Error('That transaction is not the expected action.');
 if(r.status?.SuccessValue===undefined)throw Error('The transaction failed: '+reason(JSON.stringify(r.status)));
 return {outcome:r,args,method:call.method_name};
}
// NEP-413 sign-in. The wallet signs a structured message; the server checks the signature and that the key is a full-access key of the account.
const NEP413_TAG=2147484061;
const str=s=>{const b=Buffer.from(s,'utf8'),l=Buffer.alloc(4);l.writeUInt32LE(b.length);return Buffer.concat([l,b])};
export function nep413Hash({message,nonce,recipient,callbackUrl}){
 const tag=Buffer.alloc(4);tag.writeUInt32LE(NEP413_TAG);
 const cb=callbackUrl==null?Buffer.from([0]):Buffer.concat([Buffer.from([1]),str(callbackUrl)]);
 return createHash('sha256').update(Buffer.concat([tag,str(message),Buffer.from(nonce),str(recipient),cb])).digest();
}
export function signNep413(secretKey,payload){return Buffer.from(KeyPair.fromString(secretKey).sign(nep413Hash(payload)).signature).toString('base64')}
export async function verifySignIn(provider,{accountId,publicKey,signature,message,nonce,recipient,callbackUrl}){
 if(!isAccountId(accountId))throw Error('Invalid account.');
 let key;try{key=PublicKey.fromString(publicKey)}catch{throw Error('Invalid public key.')}
 const sig=Buffer.from(String(signature||''),'base64');
 // Wallets differ on whether the callback URL is part of the signed payload, so both forms are accepted. Both bind the same nonce and recipient.
 if(sig.length!==64||![callbackUrl,null].some(cb=>key.verify(nep413Hash({message,nonce,recipient,callbackUrl:cb}),sig)))throw Error('The signature does not match.');
 let access;try{access=await provider.viewAccessKey({accountId,publicKey,finalityQuery:{finality:'final'}})}catch{throw Error('That key does not belong to '+accountId+'.')}
 if(access.permission!=='FullAccess')throw Error('Sign in with a full-access key of your account.');
 return accountId;
}
// Publishes the vault code once as a global contract pinned by hash, then deploys the factory, which ends with no keys.
export async function deployPlatform({rpcUrl,operator,factoryName='paygate',factoryNear='25'}){
 const factory=`${factoryName}.${operator.accountId}`,key=KeyPair.fromRandom('ed25519');
 const vaultCode=new Uint8Array(await readFile(CODE)),factoryCode=new Uint8Array(await readFile(FACTORY_CODE)),vaultHash=baseEncode(createHash('sha256').update(vaultCode).digest());
 await operator.createAccount({newAccountId:factory,publicKey:key.getPublicKey(),nearToTransfer:nearToYocto(factoryNear)});
 const admin=accountFor(rpcUrl,factory,key.toString());
 await admin.signAndSendTransaction({receiverId:factory,actions:[actions.deployGlobalContract(vaultCode,'codeHash')]});
 await admin.signAndSendTransaction({receiverId:factory,actions:[actions.deployContract(factoryCode),actions.functionCall('new',{vault_code:vaultHash},30n*TGAS,0n)]});
 await admin.deleteKey(key.getPublicKey());
 return {factory,vaultHash};
}
export function factoryClient({rpcUrl,network,factory,walletUrl}){
 const provider=new JsonRpcProvider({url:rpcUrl}),wallet=walletUrl||NETWORKS[network]?.wallet;
 return {
  provider,network,factory,walletUrl:wallet,
  config:()=>provider.callFunction({contractId:factory,method:'get_config',args:{},blockQuery:{finality:'optimistic'}}),
  exists:id=>provider.viewAccount({accountId:id,blockQuery:{finality:'optimistic'}}).then(()=>true,e=>/does not exist|UNKNOWN_ACCOUNT/i.test(String(e?.message||e))?false:Promise.reject(e)),
  createLink:({owner,name,agentKey,limits,payees,fund,callbackUrl})=>walletLink({provider,walletUrl:wallet,signer:owner,receiver:factory,method:'create_vault',args:{name,agent_key:agentKey,limits,recipients:payees},deposit:toYocto(fund),gas:200n*TGAS,callbackUrl}),
  // The vault counts only when the factory reports it created both accounts for this owner and this agent key.
  async confirmCreated(hash,{owner,name,agentKey}){
   const {outcome}=await checkTx(provider,hash,{signer:owner,receiver:factory,methods:'create_vault',check:a=>a?.name===name&&a?.agent_key===agentKey,network});
   const vault=`${name}.${factory}`,agent=`${name}-agent.${factory}`,e=events(outcome,'paygate_factory');
   if(e.some(x=>x.event==='vault_failed'))throw Error(`The name ${name} is taken. Your deposit was refunded; choose another name.`);
   if(e.some(x=>x.event==='agent_failed'))throw Error('The vault was created but its agent was not. The agent funding was refunded. Contact support before using this vault.');
   if(!e.some(x=>x.event==='vault_created'&&items(x).some(d=>d.owner===owner&&d.vault===vault&&d.agent===agent)))throw Error('The factory did not report a new vault for this account.');
   return {vault,agent};
  }
 };
}
// Creates a vault directly, without the factory. Used by the local attack demo.
export async function provision({rpcUrl,owner,limits,payees=[],vaultNear='3',agentNear='0.3',allowanceNear='0.25',names={vault:'paygate-vault',agent:'paygate-agent'}}){
 const id=name=>`${names[name]}.${owner.accountId}`,vaultKey=KeyPair.fromRandom('ed25519'),agentKey=KeyPair.fromRandom('ed25519'),agentFullKey=KeyPair.fromRandom('ed25519');
 const code=new Uint8Array(await readFile(CODE));
 await owner.signAndSendTransaction({receiverId:id('vault'),actions:[actions.createAccount(),actions.transfer(nearToYocto(vaultNear)),actions.addFullAccessKey(vaultKey.getPublicKey()),actions.deployContract(code)]});
 const vaultAdmin=accountFor(rpcUrl,id('vault'),vaultKey.toString());
 await vaultAdmin.callFunction({contractId:id('vault'),methodName:'new',args:{owner:owner.accountId,agent:id('agent'),limits,recipients:payees},gas:GAS});
 await owner.createAccount({newAccountId:id('agent'),publicKey:agentFullKey.getPublicKey(),nearToTransfer:nearToYocto(agentNear)});
 const agentAdmin=accountFor(rpcUrl,id('agent'),agentFullKey.toString());
 await agentAdmin.addFunctionCallAccessKey({publicKey:agentKey.getPublicKey(),contractId:id('vault'),methodNames:['request_payment'],allowance:nearToYocto(allowanceNear)});
 await agentAdmin.deleteKey(agentFullKey.getPublicKey());
 // The vault is left with no keys, so the rules can only change through its owner methods.
 await vaultAdmin.deleteKey(vaultKey.getPublicKey());
 return {rpcUrl,vault:id('vault'),agent:id('agent'),owner:owner.accountId,agentKey:agentKey.toString()};
}
// One customer's vault, driven with that customer's agent key. Owner actions become wallet links.
export function vaultClient(config){
 const {rpcUrl,vault,agent,owner,network}=config,net=NETWORKS[network]||{},provider=new JsonRpcProvider({url:rpcUrl}),agentAccount=accountFor(rpcUrl,agent,config.agentKey);
 let queue=Promise.resolve();const serial=fn=>{const run=queue.then(fn);queue=run.catch(()=>{});return run};
 const view=(method,args={})=>provider.callFunction({contractId:vault,method,args,blockQuery:{finality:'optimistic'}});
 return {
  network,vault,owner,agent,provider,walletUrl:config.walletUrl||net.wallet||null,
  explorer:hash=>net.explorer&&hash?net.explorer+hash:null,
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
  ownerLink(method,args,callbackUrl){return walletLink({provider,walletUrl:this.walletUrl,signer:owner,receiver:vault,method,args,callbackUrl})},
  confirmOwner(hash,methods,check){return checkTx(provider,hash,{signer:owner,receiver:vault,methods,check,network})},
  found
 };
}
