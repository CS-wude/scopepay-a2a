import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {startCluster} from '../scopepay/start.mjs';
async function setup(t,description='交付一张活动海报PNG及源文件，含一轮修改，24小时完成。'){
 const c=await startCluster({root:mkdtempSync(join(tmpdir(),'market-conversation-')),port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});t.after(()=>c.close());const csrf=(await fetch(c.url+'/api/market/bootstrap').then(r=>r.json())).csrf;
 const get=p=>fetch(c.url+p).then(r=>r.json());const post=async(p,b={})=>{const r=await fetch(c.url+p,{method:'POST',headers:{Origin:c.url,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(b)});return {status:r.status,value:await r.json()};};
 const draft={title:'定制创作服务',description,kind:'创作服务',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:24},d=(await post('/api/market/seller/services',draft)).value;await post(`/api/market/platform/services/${d.id}/publish`,{version:1,reason:'测试平台复核'});
 await post('/api/market/buyer/delegation',{capMinor:1500,totalCapMinor:2600,autoPay:true});
 const wait=async id=>{for(let i=0;i<250;i++){const s=(await get('/api/market/workspace?role=buyer')).sessions.find(s=>s.id===id);if(s&&!['ready','negotiating'].includes(s.state))return s;await new Promise(r=>setTimeout(r,20));}throw Error('conversation timeout');};
 return {c,get,post,wait,service:{id:d.id,version:1}};
}
test('generic marketplace request reaches both independent agents and returns a priced agreement without paying',async t=>{
 const h=await setup(t),r=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'设计一张活动海报，PNG及源文件，一轮修改，24小时交付。',service:h.service});assert.equal(r.status,202);const s=await h.wait(r.value.id);
 assert.equal(s.negotiationMode,'market_conversation');assert.equal(s.state,'agreed');assert.ok(s.discussion.length>=3);assert.deepEqual(new Set(s.discussion.map(e=>e.payload.actor)),new Set(['buyer','seller']));assert.ok(s.discussion.every(e=>e.signature&&e.payload.text));assert.ok(s.agreement.amountMinor<=1500&&s.agreement.amountMinor>=1000);assert.equal(s.payment,null);assert.equal((await h.get('/api/market/workspace?role=buyer')).budgetUsed,0);
 assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,409);assert.equal((await h.post(`/api/v2/sessions/${s.id}/deliver`)).status,409);
 assert.equal(s.buyer,undefined);assert.equal(s.seller,undefined);assert.equal(JSON.stringify(s.discussion).includes('costMinor'),false);
});
test('vague video requests produce bilateral clarification and can continue in the same session',async t=>{
 const h=await setup(t,'视频定制'),r=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'制作一个40min爱情短剧',service:h.service});let s=await h.wait(r.value.id);assert.equal(s.state,'needs_clarification');assert.ok(s.discussion.length>=2);assert.match(s.question,/交付|画幅|范围/);
 const oldCount=s.discussion.length;assert.equal((await h.post(`/api/v2/sessions/${s.id}/clarify`,{role:'buyer',text:'请卖家先确认可交付范围与验收标准，我没有其他已确认信息。'})).status,202);s=await h.wait(s.id);assert.ok(s.discussion.length>=oldCount+2);assert.equal(s.id,r.value.id);assert.equal(s.payment,null);
});

test('existing blocked generic session resumes without replacing its identity or charging',async t=>{
 const h=await setup(t),r=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'交付一张PNG海报及源文件，24小时完成',service:h.service});let s=await h.wait(r.value.id);const saved=h.c.store.getSetting('v2:'+s.id);delete saved.negotiationMode;delete saved.discussion;delete saved.a2aTasks;delete saved.conversationHash;saved.state='needs_owner';h.c.store.setSetting('v2:'+s.id,saved);
 const next=await h.post(`/api/v2/sessions/${s.id}/resume`);assert.equal(next.status,202);s=await h.wait(s.id);assert.equal(s.id,r.value.id);assert.equal(s.state,'agreed');assert.ok(s.a2aTasks.every(t=>t.taskId&&t.contextId===s.id));assert.equal(s.payment,null);
});

test('withdrawn generic listing cannot authorize another clarification round',async t=>{
 const h=await setup(t,'视频定制'),r=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'制作一个40min爱情短剧',service:h.service}),s=await h.wait(r.value.id);await h.post(`/api/market/seller/services/${h.service.id}/withdraw`,{version:1});assert.equal((await h.post(`/api/v2/sessions/${s.id}/clarify`,{role:'buyer',text:'请继续'})).status,409);
});

test('delegated routine details do not repeatedly interrupt the buyer; missing seller authority is routed to seller',async t=>{
 const h=await setup(t,'视频定制'),r=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'制作一个40min爱情短剧',service:h.service});let s=await h.wait(r.value.id);
 const count=s.discussion.length;await h.post(`/api/v2/sessions/${s.id}/clarify`,{role:'buyer',text:'素材都制片方提供，爱情题材，剧情ok，去AI味。其他没有特别标准，不需要再确认了，agent尽力帮我争取利益。'});s=await h.wait(s.id);
 assert.ok(s.discussion.length>=count+2);assert.notEqual(s.awaitingRole,'buyer');assert.equal(s.awaitingRole,'seller');assert.match(s.question,/等待卖家/);assert.equal(s.payment,null);
 const buyerReply=s.discussion.slice(count).find(e=>e.payload.actor==='buyer');assert.equal(buyerReply.payload.handoff,null);assert.match(buyerReply.payload.text,/委托我协商常规细节/);
});

test('counterparty clarification alone does not interrupt an owner after two messages',async t=>{
 const h=await setup(t,'视频定制'),r=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'制作一个40min爱情短剧',service:h.service});let s=await h.wait(r.value.id);
 await h.post(`/api/v2/sessions/${s.id}/clarify`,{role:'buyer',text:'没有特别标准，常规细节自行决定，不需要确认'});s=await h.wait(s.id);
 const count=s.discussion.length;await h.post(`/api/v2/sessions/${s.id}/clarify`,{role:'seller',text:'常规细节自行协商，不需要确认'});s=await h.wait(s.id);
 assert.equal(s.state,'negotiation_stalled');assert.equal(s.discussion.length,count+8);assert.equal(s.awaitingRole,null);assert.deepEqual(s.routineDecisions,{buyer:true,seller:true});assert.equal(s.payment,null);
});
