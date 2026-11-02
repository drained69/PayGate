import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {startLocalChain} from './sandbox.mjs';
// The local chain resets on exit, so the workspace is temporary too. Your data/ folder is not used.
export async function startChainApp(port,extraEnv={}){
 const dir=await mkdtemp(tmpdir()+'/nocturne-chain-'),chain=await startLocalChain(),file=dir+'/chain.json';
 await writeFile(file,JSON.stringify(chain.config),{mode:0o600});
 const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,...extraEnv,PORT:String(port),DATA_DIR:dir,NOCTURNE_CHAIN:file,NEAR_OWNER_KEY:chain.ownerKey},stdio:['ignore','pipe','inherit']});
 const stop=async()=>{server.kill();await new Promise(done=>server.exitCode!==null?done():server.once('exit',done));await chain.sandbox.tearDown();await rm(dir,{recursive:true,force:true})};
 try{await new Promise((ready,fail)=>{server.stdout.once('data',ready);server.once('exit',code=>fail(Error('Server exited: '+code)))})}catch(e){await stop();throw e}
 return {...chain,server,stop};
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.PORT||3000),{config,stop}=await startChainApp(port);
 console.log(`Nocturne with on-chain vault → http://localhost:${port}\nVault ${config.vault}, agent ${config.agent}. Press Ctrl+C to stop.`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop().finally(()=>process.exit(0)));
}
