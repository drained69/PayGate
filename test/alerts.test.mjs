import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import {privateAddress,checkWebhook,sendWebhook} from '../alerts.mjs';
test('private, loopback and link-local addresses are recognised',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.9','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fd00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(privateAddress(ip),true,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','172.32.0.1','2606:4700:4700::1111'])assert.equal(privateAddress(ip),false,ip);
});
test('webhook URLs must be public https addresses',async()=>{
 await assert.rejects(checkWebhook('http://hooks.example.com/x'),/https/);
 await assert.rejects(checkWebhook('https://user:pw@example.com/x'),/user name/);
 await assert.rejects(checkWebhook('https://localhost/x'),/public internet address|could not be found/);
 await assert.rejects(checkWebhook('https://127.0.0.1/x'),/public internet address/);
 await assert.rejects(checkWebhook('not a url'),/full webhook URL/);
});
test('alerts are signed and formatted for the receiver',async()=>{
 const got=[];const server=http.createServer(async(req,res)=>{let b='';for await(const c of req)b+=c;got.push({headers:req.headers,body:b});res.writeHead(204);res.end()});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/hook`;
 try{
  await sendWebhook({url,secret:'s3cret',event:'payment.held',text:'Held',data:{jobId:'PG-1'},allowPrivate:true});
  const {headers,body}=got[0],parsed=JSON.parse(body);
  assert.equal(headers['x-paygate-event'],'payment.held');assert.equal(parsed.data.jobId,'PG-1');assert.equal(parsed.text,'Held');
  assert.equal(headers['x-paygate-signature'],'sha256='+createHmac('sha256','s3cret').update(body).digest('hex'));
  await assert.rejects(sendWebhook({url:url.replace('/hook','/x'),secret:'s',event:'e',text:'t',data:{}}),/https/,'without the local-node flag, http and private addresses are refused');
 }finally{server.close()}
});
