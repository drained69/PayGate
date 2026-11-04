import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
// Seals customer secrets (agent keys, NEAR AI keys) with AES-256-GCM before they are stored.
// The key comes from PAYGATE_SECRET, which never leaves the server's environment.
export function sealer(secret){
 if(typeof secret!=='string'||secret.length<32)throw Error('PAYGATE_SECRET must be at least 32 characters.');
 const key=createHash('sha256').update('paygate:v1:'+secret).digest();
 return {
  seal(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(String(text),'utf8'),c.final()]);return 'v1:'+Buffer.concat([iv,c.getAuthTag(),body]).toString('base64')},
  open(sealed){
   if(typeof sealed!=='string'||!sealed.startsWith('v1:'))throw Error('Unreadable secret.');
   const raw=Buffer.from(sealed.slice(3),'base64'),d=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));d.setAuthTag(raw.subarray(12,28));
   return Buffer.concat([d.update(raw.subarray(28)),d.final()]).toString('utf8');
  }
 };
}
