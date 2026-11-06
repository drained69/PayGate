import {readFile} from 'node:fs/promises';
import {Sandbox,DEFAULT_ACCOUNT_ID,DEFAULT_PRIVATE_KEY} from 'near-sandbox';
import {KeyPair,nearToYocto,actions} from 'near-api-js';
import {accountFor,provision,deployPlatform} from '../src/chain.mjs';
// near-sdk 5.30 imports host functions added in nearcore 2.14, so the default 2.13 sandbox cannot run the contract.
const VERSION='2.14.0';
export const near=n=>String(nearToYocto(n));
export const LIMITS={auto_limit:near('0.1'),max_payment:near('0.5'),daily_limit:near('1')};
async function withSandbox(fn){const sandbox=await Sandbox.start({version:VERSION});try{return await fn(sandbox,accountFor(sandbox.rpcUrl,DEFAULT_ACCOUNT_ID,DEFAULT_PRIVATE_KEY))}catch(e){await sandbox.tearDown();throw e}}
const account=async(owner,id,amount)=>{const key=KeyPair.fromRandom('ed25519');await owner.createAccount({newAccountId:id,publicKey:key.getPublicKey(),nearToTransfer:nearToYocto(amount)});return key.toString()};
// A local node with one vault created directly, for the attack demo.
export function startLocalChain(){
 return withSandbox(async(sandbox,owner)=>{
  const payee=`payee.${DEFAULT_ACCOUNT_ID}`;await account(owner,payee,'0.01');
  const config=await provision({rpcUrl:sandbox.rpcUrl,owner,limits:LIMITS,payees:[payee],vaultNear:'5',agentNear:'1',allowanceNear:'0.5'});
  return {sandbox,owner,ownerKey:DEFAULT_PRIVATE_KEY,payee,config:{...config,network:'sandbox'}};
 });
}
// A local node with the PayGate platform deployed and two customers who can sign in through the local wallet.
export function startPlatform(){
 return withSandbox(async(sandbox,operator)=>{
  const {factory}=await deployPlatform({rpcUrl:sandbox.rpcUrl,operator});
  const customers={[`alice.${DEFAULT_ACCOUNT_ID}`]:await account(operator,`alice.${DEFAULT_ACCOUNT_ID}`,'20'),[`bob.${DEFAULT_ACCOUNT_ID}`]:await account(operator,`bob.${DEFAULT_ACCOUNT_ID}`,'20')};
  const payee=`payee.${DEFAULT_ACCOUNT_ID}`;await account(operator,payee,'0.01');
  const relayer={accountId:`relayer.${DEFAULT_ACCOUNT_ID}`,key:await account(operator,`relayer.${DEFAULT_ACCOUNT_ID}`,'5')};
  // A test-only USDC (6 decimals) whose whole supply belongs to carol, the customer who tests USDC vaults.
  const carol=`carol.${DEFAULT_ACCOUNT_ID}`;customers[carol]=await account(operator,carol,'20');
  const usdc=`usdc.${DEFAULT_ACCOUNT_ID}`,usdcAdmin=accountFor(sandbox.rpcUrl,usdc,await account(operator,usdc,'5'));
  await usdcAdmin.signAndSendTransaction({receiverId:usdc,actions:[actions.deployContract(new Uint8Array(await readFile(new URL('./fixtures/test-usdc.wasm',import.meta.url)))),actions.functionCall('new',{owner_id:carol,total_supply:'1000000000000'},30000000000000n,0n)]});
  return {sandbox,operator,factory,customers,payee,relayer,usdc,rpcUrl:sandbox.rpcUrl};
 });
}
