import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Account,JsonRpcProvider,FailoverRpcProvider,KeyPair,KeyPairSigner,PublicKey,actions,buildDelegateAction,createTransaction,encodeTransaction,baseDecode,baseEncode,nearToYocto} from 'near-api-js';
// A payment request uses about 25 Tgas at most, including a token transfer and its callback. Attaching less gas
// makes an agent key's allowance, which is charged for attached gas, last longer.
const TGAS=1000000000000n,ONE_YOCTO=1n,GAS=60n*TGAS,REQUEST_GAS=40n*TGAS,UNIT=10n**20n;
export const CODE=new URL('./contract/res/paygate_vault.wasm',import.meta.url);
export const FACTORY_CODE=new URL('./contract/res/paygate_factory.wasm',import.meta.url);
export const NETWORKS={
 mainnet:{rpcUrl:'https://free.rpc.fastnear.com',fallbackRpc:'https://rpc.mainnet.near.org',wallet:'https://app.mynearwallet.com',explorer:'https://nearblocks.io/txns/'},
 testnet:{rpcUrl:'https://test.rpc.fastnear.com',fallbackRpc:'https://rpc.testnet.near.org',wallet:'https://testnet.mynearwallet.com',explorer:'https://testnet.nearblocks.io/txns/'}
};
// Several comma-separated RPC URLs fail over to each other, so one slow or rate-limited node does not stop payments.
export function providerFor(rpcUrl){const urls=String(rpcUrl).split(',').map(u=>u.trim()).filter(Boolean);return urls.length>1?new FailoverRpcProvider(urls.map(url=>new JsonRpcProvider({url}))):new JsonRpcProvider({url:urls[0]})}
export const accountFor=(rpcUrl,id,secretKey)=>new Account(id,providerFor(rpcUrl),KeyPairSigner.fromSecretKey(secretKey));
// Node errors arrive in several shapes. Contract panics are reduced to the contract's own sentence.
export function reason(e){const m=String(e?.message||e);return m.match(/Smart contract panicked: ([^"\n]+)/)?.[1]?.trim()||m.slice(0,300)}
export const txHash=r=>r.transaction?.hash||r.transaction_outcome?.id;
// Amounts are NEAR with at most four decimals, kept as integers of 0.0001 NEAR so no float reaches the chain.
export const toUnits=(n,decimals=24)=>String(BigInt(Math.round(n*1e4))*10n**BigInt(decimals-4));
export const fromUnits=(y,decimals=24)=>Number(BigInt(y)/10n**BigInt(decimals-4))/1e4;
export const toYocto=n=>toUnits(n,24);
export const toNear=y=>fromUnits(y,24);
// USDC on each network: Circle's native USDC on mainnet and Circle's testnet USDC. Local nodes set their own.
export const USDC={mainnet:'17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',testnet:'3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'};
export const TOKEN_STORAGE='1250000000000000000000';
export const isAccountId=s=>typeof s==='string'&&s.length>=2&&s.length<=64&&/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s);
const isHash=h=>typeof h==='string'&&/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h);
export const events=(outcome,standard)=>(outcome?.receipts_outcome||[]).flatMap(r=>r.outcome.logs).filter(l=>l.startsWith('EVENT_JSON:')).map(l=>{try{return JSON.parse(l.slice(11))}catch{return null}}).filter(e=>e?.standard===standard);
// NEP-297 `data` may be one object or a list, depending on the emitter.
const items=e=>[].concat(e?.data??[]);
const found=(outcome,event,id)=>events(outcome,'paygate_vault').some(e=>e.event===event&&items(e).some(d=>d.id===id));
// A call for the signer's wallet to sign. Wallets connected through NEAR Connect take the transaction as is;
// the local-node stand-in wallet takes a /sign link with an unsigned transaction, whose key and nonce it replaces.
export async function walletLink({provider,walletUrl,signer,receiver,method,args,deposit=ONE_YOCTO,gas=GAS,callbackUrl,calls}){
 const list=calls||[{method,args,deposit,gas}];
 const transaction={signerId:signer,receiverId:receiver,actions:list.map(c=>({type:'FunctionCall',params:{methodName:c.method,args:c.args,gas:String(c.gas??GAS),deposit:String(c.deposit??ONE_YOCTO)}}))};
 if(!walletUrl)return {transaction,url:null};
 const block=await provider.viewBlock({finality:'final'});
 const tx=createTransaction(signer,KeyPair.fromRandom('ed25519').getPublicKey(),receiver,0n,list.map(c=>actions.functionCall(c.method,c.args,BigInt(c.gas??GAS),BigInt(c.deposit??ONE_YOCTO))),baseDecode(block.header.hash));
 return {transaction,url:`${walletUrl}/sign?${new URLSearchParams({transactions:Buffer.from(encodeTransaction(tx)).toString('base64'),callbackUrl})}`};
}
// Checks on-chain that `signer` really sent this call and that it succeeded. A wallet callback alone proves nothing.
export async function checkTx(provider,hash,{signer,receiver,methods,check=()=>true,network}){
 if(!isHash(hash))throw Error('Invalid transaction hash.');
 // A node can lag a few seconds behind the wallet's node, so a missing transaction is retried before giving up.
 let r;for(let i=0;!r;i++){try{r=await provider.viewTransactionStatus({txHash:hash,accountId:signer,waitUntil:'EXECUTED_OPTIMISTIC'})}catch{if(i>=3)throw Error('Transaction not found on '+network+'. If you just signed it, try again in a minute.');await new Promise(d=>setTimeout(d,1500*(i+1)))}}
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
 // NEP-413 signatures are base64; some wallets return base58, with or without an "ed25519:" prefix.
 const text=String(signature||'').replace(/^ed25519:/,'');let sig=Buffer.from(text,'base64');
 if(sig.length!==64)try{sig=Buffer.from(baseDecode(text))}catch{}
 // Wallets differ on whether the callback URL is part of the signed payload, so both forms are accepted. Both bind the same nonce and recipient.
 if(sig.length!==64||![callbackUrl,null].some(cb=>key.verify(nep413Hash({message,nonce,recipient,callbackUrl:cb}),sig)))throw Error('The signature does not match.');
 let access;try{access=await provider.viewAccessKey({accountId,publicKey,finalityQuery:{finality:'final'}})}catch{throw Error('That key does not belong to '+accountId+'.')}
 if(access.permission!=='FullAccess')throw Error('Sign in with a full-access key of your account.');
 return accountId;
}
// Deploys the factory with the vault code stored in it, then deletes the factory's key. Each vault gets a copy of that code.
export async function deployPlatform({rpcUrl,operator,factoryName='paygate',factoryNear='6'}){
 const factory=`${factoryName}.${operator.accountId}`,key=KeyPair.fromRandom('ed25519');
 const vaultCode=new Uint8Array(await readFile(CODE)),factoryCode=new Uint8Array(await readFile(FACTORY_CODE)),vaultHash=baseEncode(createHash('sha256').update(vaultCode).digest());
 await operator.createAccount({newAccountId:factory,publicKey:key.getPublicKey(),nearToTransfer:nearToYocto(factoryNear)});
 const admin=accountFor(rpcUrl,factory,key.toString());
 // `new` takes borsh arguments: the code's length as a little-endian u32, then the code.
 const args=new Uint8Array(4+vaultCode.length);new DataView(args.buffer).setUint32(0,vaultCode.length,true);args.set(vaultCode,4);
 await admin.signAndSendTransaction({receiverId:factory,actions:[actions.deployContract(factoryCode),actions.functionCall('new',args,150n*TGAS,0n)]});
 await admin.deleteKey(key.getPublicKey());
 return {factory,vaultHash};
}
export function factoryClient({rpcUrl,network,factory,walletUrl}){
 const provider=providerFor(rpcUrl),wallet=walletUrl||null;
 return {
  provider,network,factory,walletUrl:wallet,
  config:()=>provider.callFunction({contractId:factory,method:'get_config',args:{},blockQuery:{finality:'optimistic'}}),
  exists:id=>provider.viewAccount({accountId:id,blockQuery:{finality:'optimistic'}}).then(()=>true,e=>/does not exist|UNKNOWN_ACCOUNT/i.test(String(e?.message||e))?false:Promise.reject(e)),
  createLink:({owner,name,agentKey,limits,payees,fund,token,agentFund,callbackUrl})=>walletLink({provider,walletUrl:wallet,signer:owner,receiver:factory,method:'create_vault',args:{name,agent_key:agentKey,limits,recipients:payees,...(token?{token}:{}),...(agentFund?{agent_fund:toYocto(agentFund)}:{})},deposit:toYocto(fund),gas:200n*TGAS,callbackUrl}),
  // Without a transaction hash: the vault counts if the chain shows it owned by this customer, with this agent,
  // and the agent's only key is the one PayGate issued, limited to request_payment on that vault.
  async findCreated({owner,name,agentKey}){
   const vault=`${name}.${factory}`,agent=`${name}-agent.${factory}`,opt={finality:'optimistic'};
   const policy=await provider.callFunction({contractId:vault,method:'get_policy',args:{},blockQuery:opt}).catch(()=>null);
   if(policy?.owner!==owner||policy.agent!==agent)return null;
   const keys=(await provider.viewAccessKeyList({accountId:agent,blockQuery:opt}).catch(()=>({keys:[]}))).keys;
   const ok=keys.length===1&&keys[0].public_key===agentKey&&keys[0].access_key.permission?.FunctionCall?.receiver_id===vault;
   return ok?{vault,agent}:null;
  },
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
 const {rpcUrl,vault,agent,owner,network}=config,net=NETWORKS[network]||{},provider=providerFor(rpcUrl),agentAccount=accountFor(rpcUrl,agent,config.agentKey);
 const agentPair=KeyPair.fromString(config.agentKey),agentSigner=new KeyPairSigner(agentPair),relayer=config.relayer?accountFor(rpcUrl,config.relayer.accountId,config.relayer.key):null;
 // With a relayer, the agent signs a meta-transaction (NEP-366) and the relayer pays the gas, so the agent's allowance never runs out.
 // The agent key's restriction still applies: NEAR checks the method and receiver of the signed delegate action.
 async function relayed(method,args){
  const opt={finality:'optimistic'},ak=await provider.viewAccessKey({accountId:agent,publicKey:agentPair.getPublicKey().toString(),finalityQuery:opt}),block=await provider.viewBlock({finality:'final'});
  const da=buildDelegateAction({actions:[actions.functionCall(method,args,REQUEST_GAS,0n)],maxBlockHeight:BigInt(block.header.height)+120n,nonce:BigInt(ak.nonce)+1n,publicKey:agentPair.getPublicKey(),receiverId:vault,senderId:agent});
  const r=await relayer.signAndSendTransaction({receiverId:agent,actions:[actions.signedDelegate((await agentSigner.signDelegateAction(da)).signedDelegate)]});
  // The relayer's transaction succeeds even when the call inside fails, so the vault's own receipt decides.
  const own=r.receipts_outcome.find(x=>x.outcome.executor_id===vault&&(x.outcome.status.SuccessValue!==undefined||x.outcome.status.Failure));
  if(!own)throw Error('The relayed request did not reach the vault.');
  if(own.outcome.status.Failure)throw Error(JSON.stringify(own.outcome.status.Failure));
  return {...r,status:{SuccessValue:own.outcome.status.SuccessValue}};
 }
 const call=(method,args)=>relayer?relayed(method,args).catch(e=>/does not allow|panicked|Smart contract|already been paid|not on the allowlist|limit|frozen|Invalid job/i.test(reason(e))?Promise.reject(e):agentAccount.callFunctionRaw({contractId:vault,methodName:method,args,gas:REQUEST_GAS})):agentAccount.callFunctionRaw({contractId:vault,methodName:method,args,gas:REQUEST_GAS});
 let queue=Promise.resolve();const serial=fn=>{const run=queue.then(fn);queue=run.catch(()=>{});return run};
 const view=(method,args={})=>provider.callFunction({contractId:vault,method,args,blockQuery:{finality:'optimistic'}}),dec=config.token?(config.decimals??6):24;
 return {
  network,vault,owner,agent,provider,walletUrl:config.walletUrl||null,relayed:Boolean(relayer),
  explorer:hash=>net.explorer&&hash?net.explorer+hash:null,
  token:config.token||null,decimals:dec,symbol:config.token?(config.symbol||'USDC'):'NEAR',
  units:n=>toUnits(n,dec),fromUnits:y=>fromUnits(y,dec),
  async policy(){const p=await view('get_policy');return {...p,spendable:fromUnits(p.balance,dec),nearBalance:p.near_balance?fromUnits(p.near_balance,24):null,spent:fromUnits(p.spent_in_window,dec),limits:{auto:fromUnits(p.limits.auto_limit,dec),max:fromUnits(p.limits.max_payment,dec),daily:fromUnits(p.limits.daily_limit,dec)}}},
  // Token vaults pay only accounts registered with the token contract; NEAR vaults need no registration.
  async registered(accounts){if(!config.token)return Object.fromEntries(accounts.map(a=>[a,true]));return Object.fromEntries(await Promise.all(accounts.map(async a=>[a,Boolean(await provider.callFunction({contractId:config.token,method:'storage_balance_of',args:{account_id:a},blockQuery:{finality:'optimistic'}}).catch(()=>null))])))},
  tokenLink(calls,callbackUrl){return walletLink({provider,walletUrl:this.walletUrl,signer:owner,receiver:config.token,calls,callbackUrl})},
  pending:()=>view('get_pending'),
  recipients:()=>view('get_recipients'),
  // Asks as the agent. Small payments go out at once; larger ones wait for the owner's wallet.
  async request(job,key){
   const amount=toUnits(job.amount,dec);let result,id,status;
   try{
    result=await serial(()=>call('request_payment',{recipient:job.payee,amount,job_id:key}));
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
  // The vault's payment id for a job, from its payment_sent event.
  sentId:(outcome,jobId)=>events(outcome,'paygate_vault').filter(e=>e.event==='payment_sent').flatMap(items).find(d=>d.job_id===jobId)?.id??null,
  found
 };
}
