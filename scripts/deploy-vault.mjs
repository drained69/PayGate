import {mkdir,writeFile,stat} from 'node:fs/promises';
import {JsonRpcProvider,nearToYocto,yoctoToNear} from 'near-api-js';
import {accountFor,provision,isAccountId,CODE,NETWORKS} from '../chain.mjs';
// Deploys a PayGate vault on testnet or mainnet. The owner key is used for this run only and is never written to disk.
const e=process.env,network=e.NEAR_NETWORK,stop=m=>{console.error(m);process.exit(1)};
if(!['testnet','mainnet'].includes(network))stop('Set NEAR_NETWORK to testnet or mainnet.');
const mainnet=network==='mainnet',rpcUrl=e.NEAR_RPC_URL||NETWORKS[network].rpcUrl,dir=e.DATA_DIR||'data';
if(!e.NEAR_OWNER_ACCOUNT||!e.NEAR_OWNER_KEY)stop(`Set NEAR_OWNER_ACCOUNT and NEAR_OWNER_KEY to the ${network} account that will own the vault.`);
const need=(name,fallback)=>{const v=e[name]??(mainnet?undefined:fallback);if(v===undefined)stop(`Set ${name}. On mainnet every amount must be chosen explicitly.`);if(!/^\d+(\.\d{1,4})?$/.test(v)||Number(v)<=0)stop(`${name} must be a positive NEAR amount with at most four decimals.`);return v};
const limits={auto:need('LIMIT_AUTO','0.1'),max:need('LIMIT_MAX','0.5'),daily:need('LIMIT_DAILY','1')},vaultFund=need('VAULT_FUND','3'),agentFund=e.AGENT_FUND||'0.3',allowance=e.AGENT_ALLOWANCE||'0.25';
if(!(Number(limits.auto)<=Number(limits.max)&&Number(limits.max)<=Number(limits.daily)))stop('Limits must satisfy LIMIT_AUTO ≤ LIMIT_MAX ≤ LIMIT_DAILY.');
const payees=(e.PAYEES||'').split(',').map(s=>s.trim()).filter(Boolean);
for(const p of payees)if(!isAccountId(p))stop(`${p} is not a valid NEAR account.`);
const provider=new JsonRpcProvider({url:rpcUrl}),exists=id=>provider.viewAccount({accountId:id,blockQuery:{finality:'final'}}).then(()=>true,()=>false);
for(const p of payees)if(!await exists(p))stop(`Payee ${p} does not exist on ${network}. A payment to it would fail.`);
const owner=accountFor(rpcUrl,e.NEAR_OWNER_ACCOUNT,e.NEAR_OWNER_KEY),names={vault:e.VAULT_NAME||'paygate-vault',agent:e.AGENT_NAME||'paygate-agent'};
for(const n of Object.values(names))if(await exists(`${n}.${owner.accountId}`))stop(`${n}.${owner.accountId} already exists. Set VAULT_NAME and AGENT_NAME to new names.`);
// The contract code is stored on the vault account, so part of the funding stays locked for storage.
const codeNear=(await stat(CODE)).size/1e5,spendable=Number(vaultFund)-codeNear-0.05;
if(spendable<=0)stop(`VAULT_FUND must be more than ${(codeNear+0.05).toFixed(2)} NEAR: about ${codeNear.toFixed(2)} NEAR stays locked for the contract code.`);
const {balance}=await owner.getState().catch(()=>stop(`Cannot read ${owner.accountId} on ${network}. Check the account and key.`));
const total=nearToYocto(String(Number(vaultFund)+Number(agentFund)+0.05));
if(balance.available<total)stop(`${owner.accountId} has ${yoctoToNear(balance.available)} NEAR available and needs about ${yoctoToNear(total)}.`);
console.log(`Network:   ${network}${mainnet?' (REAL NEAR)':''}
Owner:     ${owner.accountId}
Vault:     ${names.vault}.${owner.accountId}, funded with ${vaultFund} NEAR (about ${spendable.toFixed(2)} spendable)
Agent:     ${names.agent}.${owner.accountId}, ${agentFund} NEAR, gas allowance ${allowance} NEAR
Limits:    ${limits.auto} automatic, ${limits.max} per payment, ${limits.daily} per day
Payees:    ${payees.join(', ')||'none yet, add them in the app'}`);
if(mainnet&&!process.argv.includes('--yes-mainnet'))stop('\nThis spends real NEAR. Check the summary, then run again with: npm run vault:deploy -- --yes-mainnet');
const near=n=>String(nearToYocto(n));
const config=await provision({rpcUrl,owner,payees,names,vaultNear:vaultFund,agentNear:agentFund,allowanceNear:allowance,limits:{auto_limit:near(limits.auto),max_payment:near(limits.max),daily_limit:near(limits.daily)}});
await mkdir(dir,{recursive:true,mode:0o700});await writeFile(`${dir}/chain.json`,JSON.stringify({...config,network},null,2),{mode:0o600});
console.log(`\nVault ${config.vault} is live on ${network}. Its settings, including the agent's restricted key, are in ${dir}/chain.json. Keep that file private.
Start PayGate locally with: npm start
Or on Railway: railway variables --service paygate --set "PAYGATE_CHAIN_JSON=$(cat ${dir}/chain.json)"`);
