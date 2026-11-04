import {stat} from 'node:fs/promises';
import {JsonRpcProvider,nearToYocto,yoctoToNear} from 'near-api-js';
import {accountFor,deployPlatform,CODE,FACTORY_CODE,NETWORKS} from '../chain.mjs';
// Deploys the PayGate platform once: the vault code as a global contract pinned by hash, and the factory customers use.
// The operator key is used for this run only and is never written to disk.
const e=process.env,network=e.NEAR_NETWORK,stop=m=>{console.error(m);process.exit(1)};
if(!['testnet','mainnet'].includes(network))stop('Set NEAR_NETWORK to testnet or mainnet.');
if(!e.NEAR_OPERATOR_ACCOUNT)stop(`Set NEAR_OPERATOR_ACCOUNT to the ${network} account that pays for the platform.`);
// Asked for at run time with the input hidden, so the key stays out of the shell history.
const hidden=question=>new Promise(done=>{const input=process.stdin;let key='';process.stdout.write(question);input.setRawMode?.(true);input.resume();input.setEncoding('utf8');input.on('data',function on(c){for(const ch of c){if(ch==='\r'||ch==='\n'){input.setRawMode?.(false);input.pause();input.off('data',on);process.stdout.write('\n');return done(key.trim())}if(ch==='\u0003')process.exit(1);if(ch==='\u007f')key=key.slice(0,-1);else key+=ch}})});
e.NEAR_OPERATOR_KEY||=await hidden(`Private key of ${e.NEAR_OPERATOR_ACCOUNT} (starts with ed25519:, hidden): `);
if(!/^ed25519:[1-9A-HJ-NP-Za-km-z]{60,}$/.test(e.NEAR_OPERATOR_KEY))stop('That is not a NEAR private key. It starts with ed25519: and has no spaces. Export it from your wallet, for example MyNearWallet → Settings → Security & Recovery → Export private key.');
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
// Checks the result on-chain before telling anyone to use it.
const opt={finality:'final'},keys=(await provider.viewAccessKeyList({accountId:factory,blockQuery:opt})).keys,config=await provider.callFunction({contractId:factory,method:'get_config',args:{},blockQuery:opt});
if(keys.length!==0)stop(`${factory} still has ${keys.length} key(s). Do not use it.`);
if(config.vault_code!==vaultHash)stop(`${factory} pins ${config.vault_code}, not ${vaultHash}. Do not use it.`);
console.log(`\nPlatform live on ${network}. Verified on-chain: ${factory} has no keys and pins vault code ${vaultHash}.
Set on your server: NEAR_NETWORK=${network} PAYGATE_FACTORY=${factory}`);
