import {mkdir,writeFile} from 'node:fs/promises';
import {nearToYocto,yoctoToNear} from 'near-api-js';
import {accountFor,provision} from '../chain.mjs';
const {NEAR_OWNER_ACCOUNT:ownerId,NEAR_OWNER_KEY:ownerKey,NEAR_RPC_URL:rpcUrl='https://test.rpc.fastnear.com',NEAR_NETWORK:network='testnet',DATA_DIR:dir='data'}=process.env;
if(!ownerId||!ownerKey){console.error('Set NEAR_OWNER_ACCOUNT and NEAR_OWNER_KEY to a testnet account you control.');process.exit(1)}
if(network==='mainnet'){console.error('This script deploys to testnet only.');process.exit(1)}
const near=n=>String(nearToYocto(n)),owner=accountFor(rpcUrl,ownerId,ownerKey),need=nearToYocto('6.5'),{balance}=await owner.getState();
if(balance.available<need){console.error(`Owner has ${yoctoToNear(balance.available)} NEAR available and needs 6.5.`);process.exit(1)}
const config=await provision({rpcUrl,owner,limits:{auto_limit:near('0.1'),max_payment:near('0.5'),daily_limit:near('1')},unitYocto:near('0.001')});
await mkdir(dir,{recursive:true,mode:0o700});await writeFile(`${dir}/chain.json`,JSON.stringify({...config,network}),{mode:0o600});
console.log(`Vault ${config.vault} is live on ${network}, and its settings are in ${dir}/chain.json.\nStart the app with NEAR_OWNER_KEY set: npm run dev`);
