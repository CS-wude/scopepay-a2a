import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {startCluster} from '../scopepay/start.mjs';
async function setup(t,modes={buyer:'auto',seller:'auto'},description='交付PNG海报及源文件，含一轮修改'){
 const c=await startCluster({root:mkdtempSync(join(tmpdir(),'dual-mode-')),port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});t.after(()=>c.close());
 const csrf=(await fetch(c.url+'/api/market/bootstrap').then(r=>r.json())).csrf,get=p=>fetch(c.url+p).then(r=>r.json()),post=async(p,b)=>{const r=await fetch(c.url+p,{method:'POST',headers:{Origin:c.url,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(b)});return {status:r.status,value:await r.json()};};
 for(const role of ['buyer','seller'])assert.equal((await post('/api/market/interaction',{role,mode:modes[role]})).status,200);
 const d=(await post('/api/market/seller/services',{title:'创作',description,kind:'创作',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:24})).value;await post(`/api/market/platform/services/${d.id}/publish`,{version:1,reason:'隔离测试'});
 const wait=async id=>{for(let i=0;i<200;i++){const s=(await get('/api/market/workspace?role=buyer')).sessions.find(s=>s.id===id);if(!['ready','negotiating'].includes(s?.state))return s;await new Promise(r=>setTimeout(r,20));}throw Error('timeout');};
 const r=await post('/api/v2/sessions',{workflow:'dual_mode',requestId:crypto.randomUUID(),text:'海报制作，其他没有特别标准，按常规处理',service:{id:d.id,version:1}});assert.equal(r.status,202);return {c,get,post,wait,id:r.value.id};
}
test('auto/auto presents a result for two version-bound owner decisions',async t=>{
 const h=await setup(t);let s=await h.wait(h.id);assert.equal(s.state,'awaiting_review');assert.equal(s.discussionResult.status,'agreed');assert.equal(s.payment,null);
 const r=s.discussionResult,p=`/api/v2/sessions/${s.id}/decision`,body={revision:r.revision,hash:r.hash,action:'approve'};
 assert.equal((await h.post(p,{...body,role:'buyer',hash:'old'})).status,409);assert.equal((await h.post(p,{...body,role:'buyer'})).value.state,'awaiting_review');assert.equal((await h.post(p,{...body,role:'seller'})).value.state,'confirmed');assert.equal((await h.post(p,{...body,role:'buyer'})).status,200);
});
test('reconsideration invalidates approvals and cancellation ends the latest result',async t=>{
 const h=await setup(t);let s=await h.wait(h.id),r=s.discussionResult,p=`/api/v2/sessions/${s.id}/decision`;
 await h.post(p,{role:'buyer',revision:r.revision,hash:r.hash,action:'approve'});assert.equal((await h.post(p,{role:'seller',revision:r.revision,hash:r.hash,action:'revise',text:'请按同等范围重新报价'})).status,200);
 s=await h.wait(s.id);assert.equal(s.discussionResult.revision,2);assert.deepEqual(s.discussionResult.approvals,{});assert.equal((await h.post(p,{role:'seller',revision:r.revision,hash:r.hash,action:'approve'})).status,409);
 r=s.discussionResult;assert.equal((await h.post(p,{role:'buyer',revision:r.revision,hash:r.hash,action:'cancel'})).value.state,'cancelled');assert.equal((await h.post(`/api/v2/sessions/${s.id}/resume`,{})).status,409);
});
for(const modes of [{buyer:'auto',seller:'manual'},{buyer:'manual',seller:'auto'},{buyer:'manual',seller:'manual'}])test(`mixed/manual routes details to ${JSON.stringify(modes)}`,async t=>{
 const h=await setup(t,modes,'视频定制');const s=await h.wait(h.id);assert.equal(s.state,'needs_clarification');assert.equal(s.interactionModes[s.awaitingRole],'manual');assert.equal(s.payment,null);
});

test('one side cannot answer the other side details and running cancellation is terminal',async t=>{
 const h=await setup(t,{buyer:'auto',seller:'manual'},'视频定制');let s=await h.wait(h.id);const other=s.awaitingRole==='buyer'?'seller':'buyer';
 assert.equal((await h.post(`/api/v2/sessions/${s.id}/clarify`,{role:other,text:'替对方回复'})).status,409);
 assert.equal((await h.post(`/api/v2/sessions/${s.id}/cancel`,{role:'buyer'})).status,200);assert.equal((await h.post(`/api/v2/sessions/${s.id}/interaction`,{role:'buyer',mode:'auto'})).status,409);
 assert.equal((await h.post(`/api/v2/sessions/${s.id}/clarify`,{role:s.awaitingRole,text:'迟到的回复'})).status,409);
});
test('mode preferences and partial approval survive restart without starting payment',async t=>{
 const h=await setup(t);let s=await h.wait(h.id),r=s.discussionResult;
 await h.post(`/api/v2/sessions/${s.id}/decision`,{role:'buyer',revision:r.revision,hash:r.hash,action:'approve'});
 const root=h.c.store.file.slice(0,h.c.store.file.lastIndexOf('/'));await h.c.close();const c=await startCluster({root,port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});t.after(()=>c.close());
 const w=await fetch(c.url+'/api/market/workspace?role=buyer').then(r=>r.json());s=w.sessions.find(x=>x.id===s.id);assert.equal(w.interactionMode,'auto');assert.equal(s.state,'awaiting_review');assert.ok(s.discussionResult.approvals.buyer);assert.equal(s.discussionResult.approvals.seller,undefined);assert.equal(s.payment,null);
});

test('cancellation before agent callbacks finish cannot be overwritten by a result',async t=>{
 const h=await setup(t);assert.equal((await h.post(`/api/v2/sessions/${h.id}/cancel`,{role:'buyer'})).status,200);
 await new Promise(r=>setTimeout(r,150));const s=(await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===h.id);assert.equal(s.state,'cancelled');assert.equal(s.payment,null);
});

test('session override wins over global and null restores inheritance without affecting the other role',async t=>{
 const h=await setup(t);let s=await h.wait(h.id),p=`/api/v2/sessions/${s.id}/interaction`;
 assert.equal((await h.post(p,{role:'buyer',mode:'manual'})).status,200);
 await h.post('/api/market/interaction',{role:'buyer',mode:'auto'});s=(await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===h.id);assert.equal(s.interactionModes.buyer,'manual');assert.equal(s.interactionSources.buyer,'session');assert.equal(s.interactionModes.seller,'auto');
 assert.equal((await h.post(p,{role:'buyer',mode:null})).status,200);await h.post('/api/market/interaction',{role:'buyer',mode:'manual'});s=(await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===h.id);assert.equal(s.interactionModes.buyer,'manual');assert.equal(s.interactionSources.buyer,'global');assert.equal(s.interactionModes.seller,'auto');
 await h.post('/api/market/interaction',{role:'buyer',mode:'auto'});s=(await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===h.id);assert.equal(s.interactionModes.buyer,'auto');
});
test('two sessions keep independent overrides when the global preference changes',async t=>{
 const h=await setup(t);let s=await h.wait(h.id);await h.post(`/api/v2/sessions/${s.id}/interaction`,{role:'buyer',mode:'auto'});
 const next=await h.post('/api/v2/sessions',{workflow:'dual_mode',requestId:crypto.randomUUID(),text:'同范围制作海报',service:s.serviceRef});await h.wait(next.value.id);
 await h.post('/api/market/interaction',{role:'buyer',mode:'manual'});const w=await h.get('/api/market/workspace?role=buyer'),a=w.sessions.find(x=>x.id===h.id),b=w.sessions.find(x=>x.id===next.value.id);
 assert.equal(a.interactionModes.buyer,'auto');assert.equal(a.interactionSources.buyer,'session');assert.equal(b.interactionModes.buyer,'manual');assert.equal(b.interactionSources.buyer,'global');
});

test('global mode change succeeds even when an inherited paused session references a withdrawn service',async t=>{
 const h=await setup(t,{buyer:'auto',seller:'manual'},'视频定制'),s=await h.wait(h.id);await h.post(`/api/market/seller/services/${s.serviceRef.id}/withdraw`,{version:1});
 assert.equal((await h.post('/api/market/interaction',{role:'seller',mode:'auto'})).status,200);const w=await h.get('/api/market/workspace?role=seller');assert.equal(w.interactionMode,'auto');assert.equal(w.sessions.find(x=>x.id===s.id).payment,null);
});
