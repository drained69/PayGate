import {lookup} from 'node:dns/promises';
import dns from 'node:dns';
import https from 'node:https';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import net from 'node:net';
// Alerts to a customer's webhook (Slack, Discord or any https endpoint) and to Telegram.
// Webhook URLs come from customers, so the server only calls public https addresses, checked again on every send.
const V4_PRIVATE=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]];
const v4=ip=>ip.split('.').reduce((a,b)=>(a<<8)+Number(b),0)>>>0;
export function privateAddress(ip){
 if(net.isIPv4(ip))return V4_PRIVATE.some(([base,bits])=>(v4(ip)>>>(32-bits))===(v4(base)>>>(32-bits)));
 const a=ip.toLowerCase();
 if(a.startsWith('::ffff:'))return privateAddress(a.slice(7));
 return a==='::'||a==='::1'||/^f[cd]/.test(a)||/^fe[89ab]/.test(a)||a.startsWith('ff');
}
export async function checkWebhook(input,{allowPrivate=false}={}){
 let url;try{url=new URL(String(input).trim())}catch{throw Error('Enter a full webhook URL starting with https://.')}
 if(url.protocol!=='https:'&&!(allowPrivate&&url.protocol==='http:'))throw Error('Webhook URLs must use https.');
 if(url.username||url.password)throw Error('Webhook URLs cannot contain a user name or password.');
 if(url.toString().length>500)throw Error('That webhook URL is too long.');
 if(!allowPrivate){
  let addresses;try{addresses=await lookup(url.hostname,{all:true})}catch{throw Error(`${url.hostname} could not be found.`)}
  if(!addresses.length||addresses.some(a=>privateAddress(a.address)))throw Error('Webhooks must point to a public internet address.');
 }
 return url.toString();
}
// Slack and Discord read a single text field; everything else gets the full event.
function bodyFor(url,event,text,data){
 const host=new URL(url).hostname;
 if(host==='hooks.slack.com')return {text};
 if(/(^|\.)discord(app)?\.com$/.test(host))return {content:text};
 return {event,text,data,sentAt:new Date().toISOString()};
}
// The address is checked again at connection time, on the IP actually used, so a DNS answer that changes
// between the check and the request (DNS rebinding) cannot reach a private address. Redirects are not followed.
export const safeLookup=(host,options,done)=>dns.lookup(host,{...options,all:true},(err,list)=>{
 if(err)return done(err);
 if(!list.length||list.some(a=>privateAddress(a.address)))return done(Error('Webhooks must point to a public internet address.'));
 return options.all?done(null,list):done(null,list[0].address,list[0].family);
});
export async function sendWebhook({url,secret,event,text,data,allowPrivate=false}){
 const target=new URL(await checkWebhook(url,{allowPrivate})),body=JSON.stringify(bodyFor(url,event,text,data));
 const status=await new Promise((done,fail)=>{
  const r=(target.protocol==='https:'?https:http).request(target,{method:'POST',timeout:8000,...(allowPrivate?{}:{lookup:safeLookup}),headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'User-Agent':'PayGate-Alerts/1.0','X-PayGate-Event':event,'X-PayGate-Signature':'sha256='+createHmac('sha256',secret).update(body).digest('hex')}},res=>{res.resume();done(res.statusCode)});
  r.on('timeout',()=>r.destroy(Error('The webhook did not answer in time.')));r.on('error',fail);r.end(body);
 });
 if(status<200||status>=300)throw Error(`The webhook answered ${status}.`);
}
export function telegram(token,{base='https://api.telegram.org'}={}){
 const call=async(method,params)=>{const r=await fetch(`${base}/bot${token}/${method}`,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify(params||{})});const d=await r.json().catch(()=>({}));if(!d.ok)throw Error('Telegram: '+(d.description||r.status));return d.result};
 return {call,send:(chatId,text)=>call('sendMessage',{chat_id:chatId,text,disable_web_page_preview:true})};
}
