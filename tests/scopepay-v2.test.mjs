import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startCluster} from '../scopepay/start.mjs';
import {FixturePSP} from '../scopepay/payment.mjs';
import {defaultDelegation,intake} from '../scopepay/v2.mjs';

test('v2 intake distinguishes preference, hard deadline and missing contract facts',()=>{
  const p=defaultDelegation();
  assert.ok(intake('调蓝，加法语字幕，最好今晚给',p).domain.packages.some(x=>x.id==='standard'));
  assert.ok(intake('调蓝，加法语字幕，今晚必须给',p).domain.packages.every(x=>x.id==='today'));
  assert.equal(intake('加法语字幕',{...p,subtitleLanguageKnown:false}).state,'needs_clarification');
  assert.equal(intake('调蓝再补15秒介绍',p).state,'needs_owner');
  assert.equal(intake('调蓝',{...p,colorRemaining:0}).state,'needs_owner');
});
test('v2 real separate A2A processes negotiate, pay once, deliver and persist without disclosing policy',async t=>{
  const root=mkdtempSync(join(tmpdir(),'scopepay-v2-')),psp=new FixturePSP();let sales=0;
  const create=psp.create.bind(psp);psp.create=op=>{sales++;return create(op);};
  const options={root,port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH},psp};
  let c=await startCluster(options);t.after(()=>c.close());
  let csrf=(await fetch(c.url+'/api/state').then(r=>r.json())).csrf;
  const post=async(path,body={})=>{const r=await fetch(c.url+path,{method:'POST',headers:{Origin:c.url,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const input={requestId:'v2-repeat-safe',text:'调蓝，加法语字幕，最好今晚给'};
  const created=await post('/api/v2/sessions',input);assert.equal(created.status,202);
  let state,session;
  for(let i=0;i<150;i++){state=await fetch(c.url+'/api/v2/state').then(r=>r.json());session=state.sessions.find(s=>s.id===created.value.id);if(session?.state!=='negotiating'&&session?.state!=='ready')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(session.state,'agreed',JSON.stringify(session));assert.ok(session.messages.length>=3);
  assert.equal(session.buyer,undefined);assert.equal(session.seller,undefined);assert.equal(JSON.stringify(session.messages).includes('costs'),false);
  const path=`/api/v2/sessions/${session.id}`;
  const paid=await post(path+'/pay');assert.equal(paid.status,200,JSON.stringify(paid));
  assert.equal((await post(path+'/pay')).value.receipt.id,paid.value.receipt.id);assert.equal(sales,1);
  const delivery=await post(path+'/deliver');assert.equal(delivery.status,200);assert.match(delivery.value.delivery.srt,/Découvrez/);
  await c.close();c=await startCluster(options);csrf=(await fetch(c.url+'/api/state').then(r=>r.json())).csrf;
  assert.equal((await post('/api/v2/sessions',input)).value.id,session.id);
  assert.equal((await post(path+'/pay')).status,200);assert.equal(sales,1);
});

async function harness(t,psp=new FixturePSP()){
  const c=await startCluster({root:mkdtempSync(join(tmpdir(),'scopepay-v2-fault-')),port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH},psp});t.after(()=>c.close());
  const csrf=(await fetch(c.url+'/api/state').then(r=>r.json())).csrf;
  const get=()=>fetch(c.url+'/api/v2/state').then(r=>r.json());
  const post=async(path,body={})=>{const r=await fetch(c.url+path,{method:'POST',headers:{Origin:c.url,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const start=async text=>{const r=await post('/api/v2/sessions',{requestId:crypto.randomUUID(),text});let s;
    for(let i=0;i<150;i++){s=(await get()).sessions.find(x=>x.id===r.value.id);if(!['ready','negotiating'].includes(s?.state))return s;await new Promise(r=>setTimeout(r,20));}throw new Error('Timeout');};
  return {c,get,post,start};
}
test('v2 changed owner authorization invalidates an otherwise accepted quote before charging',async t=>{
  const h=await harness(t),s=await h.start('加法语字幕');assert.equal(s.state,'agreed');
  const p=(await h.get()).owners;assert.equal((await h.post('/api/v2/owners',{...p,capMinor:1000})).status,200);
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,409);assert.equal((await h.get()).budgetUsed,0);
});
test('v2 lost PSP response retains reservation and recovers original payment without another sale',async t=>{
  const psp=new FixturePSP(),create=psp.create.bind(psp);let sales=0;
  psp.create=async op=>{sales++;await create(op);throw new Error('response lost');};
  const h=await harness(t,psp),s=await h.start('加法语字幕'),path=`/api/v2/sessions/${s.id}/pay`;
  assert.equal((await h.post(path)).status,409);assert.equal((await h.get()).budgetUsed,s.candidate.amountMinor);
  const r=await h.post(path);assert.equal(r.status,200);assert.equal(r.value.receipt.state,'verified');assert.equal(sales,1);
});
test('v2 pending original payment blocks authorization updates and unverified delivery',async t=>{
  const psp=new FixturePSP();psp.create=async()=>{throw new Error('network unknown');};
  const h=await harness(t,psp),s=await h.start('加法语字幕');
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,409);
  assert.equal((await h.post('/api/v2/owners',(await h.get()).owners)).status,409);
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/deliver`)).status,409);
});
test('v2 ambiguous read-back preserves created transaction identity for every recovery attempt',async t=>{
  const psp=new FixturePSP(),find=psp.findByOrder.bind(psp);let createdId;
  const create=psp.create.bind(psp);psp.create=async op=>{const t=await create(op);createdId=t.id;return t;};
  psp.findByOrder=async id=>(await find(id)).map(t=>({...t,id:'different-id'}));
  const h=await harness(t,psp),s=await h.start('加法语字幕'),path=`/api/v2/sessions/${s.id}/pay`;
  assert.equal((await h.post(path)).status,409);
  assert.equal((await h.get()).sessions.find(x=>x.id===s.id).payment.transactionId,createdId);
  assert.equal((await h.post(path)).status,409);
  psp.findByOrder=find;assert.equal((await h.post(path)).status,200);
});
test('v2 concurrent accepted sessions cannot spend past cumulative budget',async t=>{
  const h=await harness(t),p=(await h.get()).owners;
  await h.post('/api/v2/owners',{...p,totalCapMinor:2000});
  const [a,b]=await Promise.all([h.start('加法语字幕'),h.start('加法语字幕')]);
  assert.equal(a.state,'agreed');assert.equal(b.state,'agreed');
  const result=await Promise.all([h.post(`/api/v2/sessions/${a.id}/pay`),h.post(`/api/v2/sessions/${b.id}/pay`)]);
  assert.ok((await h.get()).budgetUsed<=2000);assert.ok(result.some(x=>x.status===409));
});
test('v2 contract revision prevents another accepted change from double-buying already delivered scope',async t=>{
  const h=await harness(t),a=await h.start('调蓝 加法语字幕'),b=await h.start('调蓝 加法语字幕');
  assert.equal((await h.post(`/api/v2/sessions/${a.id}/pay`)).status,200);
  assert.equal((await h.post(`/api/v2/sessions/${b.id}/pay`)).status,409);
  assert.equal((await h.get()).contract.colorRemaining,0);
  const c=await h.start('调蓝');assert.equal(c.state,'needs_owner');
});
test('v2 delegated auto-payment needs no per-payment button and reuses the original operation',async t=>{
  const h=await harness(t);await h.post('/api/v2/owners',{...(await h.get()).owners,autoPay:true});
  let s=await h.start('加法语字幕');
  for(let i=0;i<100&&s.state!=='delivered';i++){s=(await h.get()).sessions.find(x=>x.id===s.id);await new Promise(r=>setTimeout(r,10));}
  assert.equal(s.state,'delivered');const prior=(await h.get()).budgetUsed;
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,200);assert.equal((await h.get()).budgetUsed,prior);
});
test('v2 missing contract fact can be supplied by owner and the saved request resumes',async t=>{
  const h=await harness(t);let p=(await h.get()).owners;
  await h.post('/api/v2/owners',{...p,subtitleLanguageKnown:false});
  const s=await h.start('加法语字幕');assert.equal(s.state,'needs_clarification');
  p=(await h.get()).owners;await h.post('/api/v2/owners',{...p,subtitleLanguageKnown:true});
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/resume`)).status,200);
  let next;
  for(let i=0;i<100;i++){next=(await h.get()).sessions.find(x=>x.id===s.id);if(next.state==='agreed')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(next.state,'agreed');assert.equal(next.id,s.id);
});
test('v2 sequential subtitle change negotiates using updated remaining budget',async t=>{
  const h=await harness(t),p=(await h.get()).owners;
  await h.post('/api/v2/owners',{...p,totalCapMinor:2000});
  const a=await h.start('加法语字幕');assert.equal((await h.post(`/api/v2/sessions/${a.id}/pay`)).status,200);
  const before=(await h.get()).budgetUsed;
  const b=await h.start('压缩字幕行长');assert.equal(b.state,'agreed');assert.ok(b.candidate.amountMinor<=2000-before);
  assert.equal((await h.post(`/api/v2/sessions/${b.id}/pay`)).status,200);assert.ok((await h.get()).budgetUsed<=2000);
});
test('v2 expired quote is not payable and paid-color requires explicit extra authorization',async t=>{
  const h=await harness(t),s=await h.start('加法语字幕');
  const snapshot=h.c.store.getSetting(`v2:${s.id}`);h.c.store.setSetting(`v2:${s.id}`,{...snapshot,expiresAt:Date.now()-1});
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,409);
  const p=(await h.get()).owners;await h.post('/api/v2/owners',{...p,colorRemaining:0});
  const paused=await h.start('调蓝 加法语字幕');assert.equal(paused.state,'needs_owner');
  await h.post('/api/v2/owners',{...(await h.get()).owners,allowPaidColor:true});
  assert.equal((await h.post(`/api/v2/sessions/${paused.id}/resume`)).status,200);
});
