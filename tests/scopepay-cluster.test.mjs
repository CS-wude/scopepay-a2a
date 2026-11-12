import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startCluster,agentEnvironment} from '../scopepay/start.mjs';
import {FixturePSP} from '../scopepay/payment.mjs';
import {spawn} from 'node:child_process';

test('separate agent processes receive no PSP credentials; accepted artifacts persist after restart without recharging',async t=>{
  assert.equal(agentEnvironment({PATH:'/bin',MODEL_API_KEY:'model-test',BRAINTREE_PRIVATE_KEY:'psp-test',PAYPAL_CLIENT_SECRET:'paypal-test'}).BRAINTREE_PRIVATE_KEY,undefined);
  const root=mkdtempSync(join(tmpdir(),'scopepay-processes-'));let sales=0;
  const psp=new FixturePSP(),create=psp.create.bind(psp);psp.create=op=>{sales++;return create(op);};
  const options={root,port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH},psp};
  let cluster=await startCluster(options);t.after(()=>cluster.close());
  assert.equal(cluster.metadata.agents.length,2);assert.notEqual(cluster.metadata.agents[0].pid,process.pid);assert.notEqual(cluster.metadata.agents[0].pid,cluster.metadata.agents[1].pid);
  for(const role of ['buyer','seller']){const config=JSON.parse(readFileSync(join(root,role,'runtime.json'),'utf8'));assert.equal(JSON.stringify(config).includes('BRAINTREE'),false);assert.equal(config.peer.privateKey,undefined);}
  const get=()=>fetch(cluster.url+'/api/state').then(r=>r.json());let state=await get();
  const request={requestId:'repeat-safe-process-test',caseId:'standard'};
  const start=()=>fetch(cluster.url+'/api/runs',{method:'POST',headers:{Origin:cluster.url,'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(request)}).then(r=>r.json());
  const run=await start();
  for(let i=0;i<100;i++){state=await get();if(state.runs[0]?.state==='accepted')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(state.runs[0].state,'accepted');assert.equal(sales,1);
  const file=await fetch(`${cluster.url}/api/runs/${run.id}/subtitle`);assert.equal(file.status,200);assert.match(await file.text(),/Découvrez Aurora/);
  await cluster.close();cluster=await startCluster(options);state=await get();
  assert.equal((await start()).id,run.id);assert.equal(sales,1);assert.equal(state.runs[0].state,'accepted');
  assert.equal((await fetch(`${cluster.url}/api/runs/${run.id}/subtitle`)).status,200);
});

test('abrupt launcher exit closes its agents and permits restart on the same directory and ports',async t=>{
  const root=mkdtempSync(join(tmpdir(),'scopepay-parent-exit-'));
  const entry=new URL('../scopepay/start.mjs',import.meta.url).href;
  const script=`import {startCluster} from ${JSON.stringify(entry)};const c=await startCluster({root:process.argv[2],port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});process.send({url:c.url,agents:c.metadata.agents});`;
  const launcherFile=join(root,'launcher.mjs');writeFileSync(launcherFile,script);
  const launcher=spawn(process.execPath,[launcherFile,root],{stdio:['ignore','ignore','ignore','ipc']});
  const info=await new Promise((resolve,reject)=>{launcher.once('message',resolve);launcher.once('error',reject);launcher.once('exit',()=>reject(new Error('launcher failed before ready')));});
  t.after(()=>{for(const agent of info.agents){try{process.kill(agent.pid,'SIGTERM');}catch{}}try{launcher.kill('SIGTERM');}catch{}});
  const exited=new Promise(r=>launcher.once('exit',r));launcher.kill('SIGKILL');await exited;
  const reachable=async url=>{try{return (await fetch(url+'/health',{signal:AbortSignal.timeout(100)})).ok;}catch{return false;}};
  let alive=true;
  for(let i=0;i<30;i++){alive=(await Promise.all(info.agents.map(a=>reachable(a.url)))).some(Boolean);if(!alive)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(alive,false,'orphan agents must stop after parent IPC disconnect');
  const restarted=await startCluster({root,port:Number(new URL(info.url).port),buyerPort:Number(new URL(info.agents.find(a=>a.role==='buyer').url).port),sellerPort:Number(new URL(info.agents.find(a=>a.role==='seller').url).port),modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});t.after(()=>restarted.close());
  assert.equal(restarted.url,info.url);assert.equal(restarted.metadata.agents.length,2);
});
