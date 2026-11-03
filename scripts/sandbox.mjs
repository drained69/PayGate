import {Sandbox,DEFAULT_ACCOUNT_ID,DEFAULT_PRIVATE_KEY} from 'near-sandbox';
import {KeyPair,nearToYocto} from 'near-api-js';
import {accountFor,provision} from '../chain.mjs';
// near-sdk 5.30 imports host functions added in nearcore 2.14, so the default 2.13 sandbox cannot run the contract.
const VERSION='2.14.0';
export const near=n=>String(nearToYocto(n));
export const LIMITS={auto_limit:near('0.1'),max_payment:near('0.5'),daily_limit:near('1')};
// A local node with a vault, a restricted agent and one allowlisted payee, for development and tests.
export async function startLocalChain(){
 const sandbox=await Sandbox.start({version:VERSION});
 try{
  const owner=accountFor(sandbox.rpcUrl,DEFAULT_ACCOUNT_ID,DEFAULT_PRIVATE_KEY),payee=`payee.${DEFAULT_ACCOUNT_ID}`;
  await owner.createAccount({newAccountId:payee,publicKey:KeyPair.fromRandom('ed25519').getPublicKey(),nearToTransfer:nearToYocto('0.01')});
  const config=await provision({rpcUrl:sandbox.rpcUrl,owner,limits:LIMITS,payees:[payee],vaultNear:'5',agentNear:'1',allowanceNear:'0.5'});
  return {sandbox,owner,ownerKey:DEFAULT_PRIVATE_KEY,payee,config:{...config,network:'sandbox'}};
 }catch(e){await sandbox.tearDown();throw e}
}
