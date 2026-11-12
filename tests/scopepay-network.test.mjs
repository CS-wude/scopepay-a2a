import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requestOrigin,lanAddresses} from '../scopepay/network.mjs';
import {startCluster} from '../scopepay/start.mjs';
import {request} from 'node:http';

test('network origin allowlist requires exact IP and port; default stays loopback',()=>{
  assert.equal(requestOrigin('127.0.0.1:8994',8994),'http://127.0.0.1:8994');
  for(const host of ['evil.example:8994','127.0.0.1.evil:8994','127.0.0.1:9999','192.168.1.2:8994'])assert.equal(requestOrigin(host,8994),null);
  assert.equal(requestOrigin('192.168.1.2:8994',8994,['127.0.0.1','192.168.1.2']),'http://192.168.1.2:8994');
});
test('LAN serves workspace and validates CSRF against LAN origin while rejecting cross-origin requests',async t=>{
  const address=lanAddresses()[0];if(!address)return t.skip('No physical LAN interface');
  const c=await startCluster({root:mkdtempSync(join(tmpdir(),'scopepay-lan-')),host:'0.0.0.0',port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});t.after(()=>c.close());
  const port=new URL(c.url).port,base=`http://${address}:${port}`;
  assert.equal((await fetch(base+'/market')).status,200);const {csrf}=await fetch(base+'/api/market/bootstrap').then(r=>r.json());
  const post=async(origin,token)=>fetch(base+'/api/market/buyer/delegation',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({capMinor:2000,totalCapMinor:4000,autoPay:false})});
  assert.equal((await post(base,csrf)).status,200);assert.equal((await post(base,'wrong')).status,403);assert.equal((await post('https://evil.example',csrf)).status,403);
  const status=await new Promise((resolve,reject)=>{const r=request(base+'/market',{headers:{Host:'evil.example:'+port}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});assert.equal(status,403);
});
