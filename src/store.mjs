import {mkdir,readFile,writeFile,rename,rm,readdir} from 'node:fs/promises';
import {empty} from './domain.mjs';
// Customer data: one row per NEAR account holding its profile (vault, sealed keys) and its
// workspace (jobs, receipts, labels). Postgres when DATABASE_URL is set, files for local runs.
const fresh=account=>({account,profile:{createdAt:new Date().toISOString()},workspace:empty()});
export async function openStore({databaseUrl,dir}){return databaseUrl?postgres(databaseUrl):files(dir)}
async function postgres(url){
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({connectionString:url,max:10});
 await pool.query(`CREATE TABLE IF NOT EXISTS accounts(account_id text PRIMARY KEY,profile jsonb NOT NULL,workspace jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS nonces(nonce text PRIMARY KEY,expires_at timestamptz NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
 CREATE TABLE IF NOT EXISTS api_keys(key_hash text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());`);
 const row=r=>r&&{account:r.account_id,profile:r.profile,workspace:r.workspace};
 return {
  kind:'postgres',
  async get(account){return row((await pool.query('SELECT * FROM accounts WHERE account_id=$1',[account])).rows[0])||null},
  // Row-locked read-modify-write, so concurrent requests for one account apply in order, even across instances.
  async update(account,fn){
   const c=await pool.connect();
   try{
    await c.query('BEGIN');const f=fresh(account);
    await c.query('INSERT INTO accounts(account_id,profile,workspace) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[account,f.profile,f.workspace]);
    const current=row((await c.query('SELECT * FROM accounts WHERE account_id=$1 FOR UPDATE',[account])).rows[0]);
    const next=await fn(current);
    await c.query('UPDATE accounts SET profile=$2,workspace=$3,updated_at=now() WHERE account_id=$1',[account,next.profile,next.workspace]);
    await c.query('COMMIT');return next;
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
  },
  async remove(account){await pool.query('DELETE FROM accounts WHERE account_id=$1',[account])},
  async addSession(hash,account,expires){await pool.query('INSERT INTO sessions VALUES($1,$2,$3)',[hash,account,new Date(expires)])},
  async session(hash){return (await pool.query('SELECT account_id FROM sessions WHERE token_hash=$1 AND expires_at>now()',[hash])).rows[0]?.account_id||null},
  async dropSession(hash){await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash])},
  async addNonce(nonce,expires){await pool.query('INSERT INTO nonces VALUES($1,$2)',[nonce,new Date(expires)])},
  async useNonce(nonce){return (await pool.query('DELETE FROM nonces WHERE nonce=$1 AND expires_at>now() RETURNING nonce',[nonce])).rowCount===1},
  // Agent API keys are looked up by hash only; the key itself is never stored.
  async addApiKey(hash,account){await pool.query('INSERT INTO api_keys(key_hash,account_id) VALUES($1,$2)',[hash,account])},
  async apiKey(hash){return (await pool.query('SELECT account_id FROM api_keys WHERE key_hash=$1',[hash])).rows[0]?.account_id||null},
  async dropApiKey(hash){await pool.query('DELETE FROM api_keys WHERE key_hash=$1',[hash])},
  async purge(){await pool.query('DELETE FROM sessions WHERE expires_at<now()');await pool.query('DELETE FROM nonces WHERE expires_at<now()')},
  async stats(){return {accounts:Number((await pool.query('SELECT count(*) FROM accounts')).rows[0].count)}},
  close:()=>pool.end()
 };
}
async function files(dir){
 const base=new URL('accounts/',dir);await mkdir(base,{recursive:true,mode:0o700});
 // NEAR account names never contain '~', so it stands in for the '/' of network-scoped keys in file names.
 const file=a=>encodeURIComponent(a.replaceAll('/','~')),path=a=>new URL(file(a)+'.json',base),queues=new Map(),sessions=new Map(),nonces=new Map();
 const keysFile=new URL('api-keys.json',dir),keys=new Map(Object.entries(JSON.parse(await readFile(keysFile,'utf8').catch(()=>'{}'))));
 const saveKeys=async()=>{const tmp=new URL('api-keys.tmp',dir);await writeFile(tmp,JSON.stringify(Object.fromEntries(keys)),{mode:0o600});await rename(tmp,keysFile)};
 const get=async a=>{try{return JSON.parse(await readFile(path(a),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}};
 return {
  kind:'files',get,
  update(account,fn){
   const run=(queues.get(account)||Promise.resolve()).then(async()=>{const next=await fn((await get(account))||fresh(account)),tmp=new URL(file(account)+'.tmp',base);await writeFile(tmp,JSON.stringify(next,null,2),{mode:0o600});await rename(tmp,path(account));return next});
   queues.set(account,run.catch(()=>{}));return run;
  },
  async remove(account){await rm(path(account),{force:true});for(const [h,s] of sessions)if(s.account===account)sessions.delete(h);let changed=false;for(const [h,a] of keys)if(a===account){keys.delete(h);changed=true}if(changed)await saveKeys()},
  async addApiKey(hash,account){keys.set(hash,account);await saveKeys()},
  async apiKey(hash){return keys.get(hash)||null},
  async dropApiKey(hash){keys.delete(hash);await saveKeys()},
  async addSession(hash,account,expires){sessions.set(hash,{account,expires})},
  async session(hash){const s=sessions.get(hash);return s&&s.expires>Date.now()?s.account:null},
  async dropSession(hash){sessions.delete(hash)},
  async addNonce(nonce,expires){nonces.set(nonce,expires)},
  async useNonce(nonce){const e=nonces.get(nonce);nonces.delete(nonce);return Boolean(e&&e>Date.now())},
  async purge(){const now=Date.now();for(const [k,v] of sessions)if(v.expires<now)sessions.delete(k);for(const [k,v] of nonces)if(v<now)nonces.delete(k)},
  async stats(){return {accounts:(await readdir(base)).filter(f=>f.endsWith('.json')).length}},
  close:async()=>{}
 };
}
