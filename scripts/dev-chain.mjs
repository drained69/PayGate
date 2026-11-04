import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {startPlatform} from './sandbox.mjs';
// The local chain resets on exit, so the data folder is temporary too.
export async function startChainApp(port,extraEnv={}){
 const dir=await mkdtemp(tmpdir()+'/paygate-chain-'),chain=await startPlatform();
 const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PUBLIC_URL:'',RAILWAY_PUBLIC_DOMAIN:'',DATABASE_URL:'',PAYGATE_SECRET:'',...extraEnv,PORT:String(port),DATA_DIR:dir,NEAR_NETWORK:'sandbox',NEAR_RPC_URL:chain.rpcUrl,PAYGATE_FACTORY:chain.factory,PAYGATE_DEV_ACCOUNTS:JSON.stringify(chain.customers)},stdio:['ignore','pipe','inherit']});
 const stop=async()=>{server.kill();await new Promise(done=>server.exitCode!==null?done():server.once('exit',done));await chain.sandbox.tearDown();await rm(dir,{recursive:true,force:true})};
 try{await new Promise((ready,fail)=>{server.stdout.once('data',ready);server.once('exit',code=>fail(Error('Server exited: '+code)))})}catch(e){await stop();throw e}
 return {...chain,server,stop};
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.PORT||3000),{factory,customers,payee,stop}=await startChainApp(port);
 console.log(`PayGate on a local NEAR node → http://localhost:${port}\nFactory ${factory}. Sign in as ${Object.keys(customers).join(' or ')} with the local wallet. Payee ${payee} exists. Press Ctrl+C to stop.`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop().finally(()=>process.exit(0)));
}
