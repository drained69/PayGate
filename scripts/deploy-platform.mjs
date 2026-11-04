import {stat} from 'node:fs/promises';
import {JsonRpcProvider,nearToYocto,yoctoToNear} from 'near-api-js';
import {accountFor,deployPlatform,CODE,FACTORY_CODE,NETWORKS} from '../chain.mjs';
// Deploys the PayGate platform once: the vault code as a global contract pinned by hash, and the factory customers use.
// The operator key is used for this run only and is never written to disk.
const e=process.env,network=e.NEAR_NETWORK,stop=m=>{console.error(m);process.exit(1)};
if(!['testnet','mainnet'].includes(network))stop('Set NEAR_NETWORK to testnet or mainnet.');
if(!e.NEAR_OPERATOR_ACCOUNT||!e.NEAR_OPERATOR_KEY)stop(`Set NEAR_OPERATOR_ACCOUNT and NEAR_OPERATOR_KEY to the ${network} account that pays for the platform.`);
const rpcUrl=e.NEAR_RPC_URL||NETWORKS[network].rpcUrl,name=e.FACTORY_NAME||'paygate',fund=e.FACTORY_FUND||'25';
const operator=accountFor(rpcUrl,e.NEAR_OPERATOR_ACCOUNT,e.NEAR_OPERATOR_KEY),factory=`${name}.${operator.accountId}`;
// A vault name may be 32 characters and its agent adds "-agent.", so longer factory names would leave no room.
if(factory.length>25)stop(`${factory} is ${factory.length} characters. Keep the factory account at 25 or fewer, for example with a shorter FACTORY_NAME.`);
const provider=new JsonRpcProvider({url:rpcUrl});
if(await provider.viewAccount({accountId:factory,blockQuery:{finality:'final'}}).then(()=>true,()=>false))stop(`${factory} already exists. Choose another FACTORY_NAME.`);
// Publishing global code burns ten times the normal storage cost; the factory's own code is stored normally.
const globalNear=(await stat(CODE)).size*1e-4,factoryNear=(await stat(FACTORY_CODE)).size*1e-5,need=globalNear+factoryNear+0.5;
if(Number(fund)<need)stop(`FACTORY_FUND must be at least ${need.toFixed(1)} NEAR.`);
const {balance}=await operator.getState().catch(()=>stop(`Cannot read ${operator.accountId} on ${network}. Check the account and key.`));
if(balance.available<nearToYocto(String(Number(fund)+0.1)))stop(`${operator.accountId} has ${yoctoToNear(balance.available)} NEAR available and needs about ${Number(fund)+0.1}.`);
console.log(`Network:   ${network}${network==='mainnet'?' (REAL NEAR)':''}
Operator:  ${operator.accountId}
Factory:   ${factory}, funded with ${fund} NEAR
Costs:     about ${globalNear.toFixed(2)} NEAR burned to publish the vault code, ${factoryNear.toFixed(2)} NEAR locked for the factory code
Remainder: about ${(Number(fund)-globalNear-factoryNear).toFixed(2)} NEAR stays in the factory to cover refunds`);
if(network==='mainnet'&&!process.argv.includes('--yes-mainnet'))stop('\nThis spends real NEAR. Check the summary, then run again with: npm run platform:deploy -- --yes-mainnet');
const {vaultHash}=await deployPlatform({rpcUrl,operator,factoryName:name,factoryNear:fund});
console.log(`\nPlatform live on ${network}. Factory ${factory} has no keys; vaults run code ${vaultHash}.
Set on your server: NEAR_NETWORK=${network} PAYGATE_FACTORY=${factory}`);
