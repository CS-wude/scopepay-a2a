import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startCluster} from '../scopepay/start.mjs';
import {reviewListing,validateListing} from '../scopepay/marketplace.mjs';
import {mountMarketplace} from '../scopepay/marketplace.mjs';
import express from 'express';
import {Store} from '../scopepay/store.mjs';
import {serviceNegotiation} from '../scopepay/marketplace.mjs';
import {defaultDelegation} from '../scopepay/v2.mjs';
const draft={title:'法语字幕',description:'基于本地提供的SRT翻译为法语',kind:'french',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:24};
test('custom category is distinct from reviewed fulfillment capability',async()=>{
  const custom={...draft,kind:'品牌字幕本地化'};assert.equal(validateListing({...draft,kind:'法语字幕制作'}).kind,'french');
  assert.equal((await reviewListing(custom,{})).approved,true);
  const env={SCOPEPAY_MODEL_MODE:'live',MODEL_BASE_URL:'https://example.com/v1',MODEL_NAME:'test',MODEL_API_KEY:'test'};
  const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({approved:true,reason:'范围明确，仅翻译法语SRT',capability:'french'})}}]})});
  const review=await reviewListing(custom,env,fetchImpl);assert.equal(review.capability,'french');
  const parsed=serviceNegotiation({...custom,includes:'法语SRT',fulfillmentKind:review.capability},defaultDelegation(),{id:'custom-trade',remainingMinor:4000});assert.equal(parsed.state,'ready');assert.deepEqual(parsed.domain.required,['french']);
  assert.equal(serviceNegotiation(custom,defaultDelegation(),{id:'unreviewed',remainingMinor:4000}).negotiationMode,'market_conversation');
  await assert.rejects(()=>reviewListing(custom,env,async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({approved:true,reason:'ok',capability:'video'})}}]})})));
});
async function harness(t){const options={root:mkdtempSync(join(tmpdir(),'scopepay-market-')),port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}};const c=await startCluster(options);t.after(()=>c.close());const csrf=(await fetch(c.url+'/api/market/bootstrap').then(r=>r.json())).csrf;const get=path=>fetch(c.url+path).then(r=>r.json());const post=async(path,body={})=>{const r=await fetch(c.url+path,{method:'POST',headers:{Origin:c.url,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};return {c,get,post,options};}
test('market validates explicit capabilities and private economic boundaries',()=>{assert.throws(()=>validateListing({...draft,kind:''}));assert.throws(()=>validateListing({...draft,kind:'x'.repeat(61)}));assert.equal(validateListing({...draft,kind:'品牌字幕本地化'}).kind,'品牌字幕本地化');assert.throws(()=>validateListing({...draft,askMinor:900}));assert.throws(()=>validateListing({...draft,extra:'inject'}));assert.throws(()=>validateListing({...draft,deliveryHours:2}));});
test('market draft → review → publish → signed A2A → pay/deliver, preserving private fields',async t=>{
  const h=await harness(t),created=await h.post('/api/market/seller/services',draft);assert.equal(created.status,201);const d=created.value,path='/api/market/seller/services/'+d.id;
  assert.deepEqual(await h.get('/api/market/catalog'),[]);
  assert.equal((await h.post('/api/market/platform/services/'+d.id+'/review',{version:1})).status,409);
  assert.equal((await h.post(path+'/submit',{version:1})).status,200);assert.deepEqual(await h.get('/api/market/catalog'),[]);
  assert.equal((await h.post('/api/market/platform/services/'+d.id+'/review',{version:1})).value.status,'approved');
  assert.deepEqual(await h.get('/api/market/catalog'),[]);
  assert.equal((await h.post(path+'/publish',{version:1})).value.status,'published');
  const catalog=await h.get('/api/market/catalog');assert.equal(catalog.length,1);assert.equal(catalog[0].costMinor,undefined);assert.equal(catalog[0].minMarginMinor,undefined);
  const platform=JSON.stringify(await h.get('/api/market/platform/services'));assert.equal(platform.includes('costMinor'),false);
  const input={requestId:crypto.randomUUID(),text:'请提供法语字幕，按标准交期交付',service:{id:d.id,version:1}};
  const start=await h.post('/api/v2/sessions',input);assert.equal(start.status,202);let s;
  for(let i=0;i<200;i++){s=(await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===start.value.id);if(s?.state==='agreed')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(s.state,'agreed');assert.equal(s.service.id,d.id);assert.equal(s.service.costMinor,undefined);assert.ok(s.domain.serviceHash);assert.ok(s.candidate.amountMinor>=1000&&s.candidate.amountMinor<=1600);
  assert.equal((await h.post('/api/v2/sessions',{...input,service:{id:d.id,version:2}})).status,409);
  const seller=await h.get('/api/market/workspace?role=seller');assert.equal(seller.delegation,undefined);assert.equal(seller.budgetUsed,undefined);
  assert.equal((await h.post(path+'/withdraw',{version:1})).status,200);assert.deepEqual(await h.get('/api/market/catalog'),[]);
  assert.equal((await h.post('/api/v2/sessions',{...input,requestId:crypto.randomUUID()})).status,409);
  const paid=await h.post(`/api/v2/sessions/${s.id}/pay`);assert.equal(paid.status,200);assert.equal((await h.post(`/api/v2/sessions/${s.id}/deliver`)).status,200);
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,200);assert.equal(h.c.store.getSetting('v2:'+s.id).state,'delivered');
  assert.equal((await h.post(path+'/edit',{version:1,draft:{...draft,title:'新版法语字幕'}})).status,200);
  assert.equal((await h.post(path+'/submit',{version:1})).status,409);assert.deepEqual(await h.get('/api/market/catalog'),[]);
  const stored=h.c.store.getSetting('v2:'+s.id);stored.service.title='tampered';h.c.store.setSetting('v2:'+s.id,stored);
  // Already verified operations are idempotent, not recharged after edits.
  assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,200);
});
test('market real-model audit uses public inputs only and rejects malformed responses',async()=>{
  const env={SCOPEPAY_MODEL_MODE:'live',MODEL_BASE_URL:'https://example.com/v1',MODEL_NAME:'test',MODEL_API_KEY:'not-a-real-key'};let body;
  const reply=v=>async(_url,req)=>{body=JSON.parse(req.body);return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(v)}}]})};};
  const result=await reviewListing(draft,env,reply({approved:false,reason:'说明承诺了视频渲染，超出支持范围'}));assert.equal(result.approved,false);assert.equal(JSON.stringify(body).includes('costMinor'),false);const input=JSON.parse(body.messages[1].content);assert.deepEqual(input.listing.price,{amount:'16.00',currency:'USD',unit:'美元',basis:'公开起价'});assert.equal(JSON.stringify(input).includes('1600'),false);assert.equal(input.listing.askMinor,undefined);
  await assert.rejects(()=>reviewListing(draft,env,reply({approved:'yes',reason:'ok'})));
});
test('market delayed audit cannot publish edited content and review failure stays private',async t=>{
  const store=new Store(join(mkdtempSync(join(tmpdir(),'market-race-')),'store.sqlite')),app=express();app.use(express.json());let release,started;
  let signal=new Promise(r=>started=r);mountMarketplace(app,{store,csrf:'test',review:async()=>{started();return await new Promise(r=>release=r);}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
  const base='http://127.0.0.1:'+server.address().port,post=async(p,b)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,value:await r.json()};};
  const d=(await post('/api/market/seller/services',draft)).value,path='/api/market/seller/services/'+d.id;await post(path+'/submit',{version:1});
  const running=post('/api/market/platform/services/'+d.id+'/review',{version:1});await signal;
  assert.equal((await post(path+'/edit',{version:1,draft:{...draft,title:'Changed after review started'}})).status,200);release({approved:true,reason:'old approval',mode:'fixture'});assert.equal((await running).status,409);
  assert.deepEqual(await fetch(base+'/api/market/catalog').then(r=>r.json()),[]);
  await post(path+'/submit',{version:2});signal=new Promise(r=>started=r);const reject=post('/api/market/platform/services/'+d.id+'/review',{version:2});await signal;release({approved:false,reason:'unsupported promise',mode:'fixture'});assert.equal((await reject).value.status,'rejected');assert.deepEqual(await fetch(base+'/api/market/catalog').then(r=>r.json()),[]);
  const publish='/api/market/platform/services/'+d.id+'/publish';
  assert.equal((await post(publish,{version:1,reason:'旧版本'})).status,409);assert.equal((await post(publish,{version:2,reason:''})).status,409);
  assert.equal((await post(publish,{version:2,reason:'已复核服务范围，允许卖家按约交付'})).value.status,'published');
  let published=(await fetch(base+'/api/market/catalog').then(r=>r.json()))[0];assert.equal(published.reviewMode,'manual');assert.equal(published.fulfillmentKind,null);
  const record=(await fetch(base+'/api/market/platform/services').then(r=>r.json()))[0];assert.equal(record.reviews.at(-1).approved,false);assert.equal(record.decisions.at(-1).priorStatus,'rejected');assert.equal(record.decisions.at(-1).version,2);
  await post(path+'/edit',{version:2,draft});await post(path+'/submit',{version:3});signal=new Promise(r=>started=r);const runningAgain=post('/api/market/platform/services/'+d.id+'/review',{version:3});await signal;
  assert.equal((await post(publish,{version:3,reason:'人工复核优先'})).value.status,'published');release({approved:false,reason:'late rejection',mode:'fixture'});assert.equal((await runningAgain).status,409);
  published=(await fetch(base+'/api/market/catalog').then(r=>r.json()))[0];assert.equal(published.version,3);assert.equal(published.reviewMode,'manual');
  signal=new Promise(r=>started=r);const recheck=post('/api/market/platform/services/'+d.id+'/review',{version:3});await signal;
  assert.deepEqual((await fetch(base+'/api/market/catalog').then(r=>r.json()))[0],published);
  release({approved:false,reason:'复审建议补充，平台自行决定下架',mode:'fixture'});assert.equal((await recheck).value.status,'published');
  assert.deepEqual((await fetch(base+'/api/market/catalog').then(r=>r.json()))[0],published);
  const owner=(await fetch(base+'/api/market/seller/services').then(r=>r.json()))[0];assert.equal(owner.currentReview.approved,false);assert.equal(owner.reviews,undefined);
});
test('generic services can be approved with no execution integration, and manual publication never charges',async t=>{
  const generic={...draft,title:'网站首页设计',kind:'界面设计',description:'交付一版首页设计稿及一轮修改，24小时完成，不包含前端开发'};
  const env={SCOPEPAY_MODEL_MODE:'live',MODEL_BASE_URL:'https://example.com/v1',MODEL_NAME:'test',MODEL_API_KEY:'test'};let prompt;
  const r=await reviewListing(generic,env,async(_u,req)=>{prompt=JSON.parse(req.body);return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({approved:true,reason:'范围、价格和交期明确',capability:null})}}]})};});
  assert.equal(r.approved,true);assert.equal(r.capability,null);assert.ok(prompt.messages[0].content.includes('ANY service category'));assert.ok(prompt.messages[0].content.includes('Do NOT reject'));assert.equal(JSON.stringify(prompt).includes('costMinor'),false);
  const h=await harness(t),d=(await h.post('/api/market/seller/services',generic)).value;await h.post(`/api/market/seller/services/${d.id}/submit`,{version:1});
  assert.equal((await h.post(`/api/market/platform/services/${d.id}/publish`,{version:1,reason:'复核交付内容后上架'})).status,200);
  const catalog=await h.get('/api/market/catalog');assert.equal(catalog[0].kind,'界面设计');assert.equal(catalog[0].fulfillmentKind,null);assert.equal(catalog[0].includes,generic.description);
  const started=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'请设计首页',service:{id:d.id,version:1}});assert.equal(started.value.negotiationMode,'market_conversation');assert.equal((await h.post(`/api/v2/sessions/${started.value.id}/pay`)).status,409);
  assert.equal((await h.get('/api/market/workspace?role=buyer')).budgetUsed,0);
  assert.equal(serviceNegotiation({...draft,fulfillmentKind:null},defaultDelegation(),{id:'manual',remainingMinor:4000}).negotiationMode,'market_conversation');
});
test('market service hash tampering prevents a first payment',async t=>{
  const h=await harness(t),d=(await h.post('/api/market/seller/services',draft)).value;await h.post(`/api/market/seller/services/${d.id}/submit`,{version:1});await h.post(`/api/market/platform/services/${d.id}/review`,{version:1});await h.post(`/api/market/seller/services/${d.id}/publish`,{version:1});const r=await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'加法语字幕',service:{id:d.id,version:1}});let s;
  for(let i=0;i<200;i++){s=h.c.store.getSetting('v2:'+r.value.id);if(s.state==='agreed')break;await new Promise(r=>setTimeout(r,20));}assert.equal(s.state,'agreed');s.service.description='篡改协议';h.c.store.setSetting('v2:'+s.id,s);assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,409);
});
test('published service and private seller settings persist across cluster restart',async t=>{
  const h=await harness(t),d=(await h.post('/api/market/seller/services',draft)).value;await h.post(`/api/market/seller/services/${d.id}/submit`,{version:1});await h.post(`/api/market/platform/services/${d.id}/review`,{version:1});await h.post(`/api/market/seller/services/${d.id}/publish`,{version:1});await h.c.close();const next=await startCluster(h.options);t.after(()=>next.close());
  const catalog=await fetch(next.url+'/api/market/catalog').then(r=>r.json());assert.equal(catalog[0].id,d.id);assert.equal(catalog[0].costMinor,undefined);const seller=await fetch(next.url+'/api/market/seller/services').then(r=>r.json());assert.equal(seller[0].draft.costMinor,800);
});
test('market subtitle wrap delivers exact original words and additional translation needs authorization',async t=>{
  const h=await harness(t),d=(await h.post('/api/market/seller/services',{...draft,title:'字幕重排',kind:'wrap',costMinor:300,minMarginMinor:100,askMinor:800})).value;await h.post(`/api/market/seller/services/${d.id}/submit`,{version:1});await h.post(`/api/market/platform/services/${d.id}/review`,{version:1});await h.post(`/api/market/seller/services/${d.id}/publish`,{version:1});
  const input={text:'请调整字幕行长，保留原文字和时间码。',service:{id:d.id,version:1}},r=await h.post('/api/v2/sessions',{...input,requestId:crypto.randomUUID()});let s;
  for(let i=0;i<200;i++){s=h.c.store.getSetting('v2:'+r.value.id);if(s.state==='agreed')break;await new Promise(r=>setTimeout(r,20));}assert.equal(s.state,'agreed');assert.equal((await h.post(`/api/v2/sessions/${s.id}/pay`)).status,200);const delivered=await h.post(`/api/v2/sessions/${s.id}/deliver`);assert.equal(delivered.value.delivery.review.accepted,true);assert.match(delivered.value.delivery.srt,/Aurora/);
  const more=await h.post('/api/v2/sessions',{...input,text:'调整字幕行长，并加法语字幕',requestId:crypto.randomUUID()});assert.equal(more.value.state,'needs_owner');assert.equal(more.value.payment,null);
});

test('approval is separate from publication; sellers only see the latest current-version review',async t=>{
  const h=await harness(t),d=(await h.post('/api/market/seller/services',draft)).value,seller=`/api/market/seller/services/${d.id}`,platform=`/api/market/platform/services/${d.id}`;
  assert.equal((await h.post(seller+'/publish',{version:1})).status,409);
  await h.post(seller+'/submit',{version:1});assert.equal((await h.post(platform+'/review',{version:1})).value.status,'approved');
  assert.deepEqual(await h.get('/api/market/catalog'),[]);
  assert.equal((await h.post('/api/v2/sessions',{requestId:crypto.randomUUID(),text:'翻译字幕',service:{id:d.id,version:1}})).status,409);
  let own=(await h.get('/api/market/seller/services'))[0];assert.equal(own.currentReview.approved,true);assert.equal(own.reviews,undefined);assert.equal(own.decisions,undefined);
  assert.equal((await h.post(seller+'/publish',{version:0})).status,409);
  assert.equal((await h.post(seller+'/publish',{version:1})).value.status,'published');assert.equal((await h.get('/api/market/catalog'))[0].fulfillmentKind,'french');
  await h.post(seller+'/withdraw',{version:1});assert.equal((await h.post(seller+'/publish',{version:1})).status,200);
  const edited=await h.post(seller+'/edit',{version:1,draft:{...draft,title:'新版本'}});assert.equal(edited.value.currentReview,null);assert.equal(edited.value.reviews,undefined);
  assert.equal((await h.post(seller+'/publish',{version:2})).status,409);
  await h.post(seller+'/submit',{version:2});await h.post(platform+'/review',{version:2});
  own=(await h.get('/api/market/seller/services'))[0];assert.equal(own.currentReview.version,2);assert.equal(own.reviews,undefined);
  const all=(await h.get('/api/market/platform/services'))[0];assert.deepEqual(all.reviews.map(r=>r.version),[1,2]);assert.ok(all.decisions.length);
  assert.equal((await h.post(platform+'/publish',{version:2,reason:'审核通过后平台确认上架'})).status,200);
  assert.equal((await h.get('/api/market/catalog'))[0].version,2);
});
test('platform can publish a valid draft and rejected seller cannot publish',async t=>{
  const h=await harness(t),d=(await h.post('/api/market/seller/services',draft)).value;
  assert.equal((await h.post(`/api/market/platform/services/${d.id}/publish`,{version:1,reason:'平台审核交付范围后直接上架'})).status,200);
  const doc=JSON.parse(h.c.store.db.prepare('SELECT doc FROM market_services WHERE id=?').get(d.id).doc);doc.status='rejected';doc.published=null;doc.reviews=[{version:1,approved:false,reason:'需补充'}];h.c.store.db.prepare('UPDATE market_services SET doc=? WHERE id=?').run(JSON.stringify(doc),d.id);
  assert.equal((await h.post(`/api/market/seller/services/${d.id}/publish`,{version:1})).status,409);assert.deepEqual(await h.get('/api/market/catalog'),[]);
});

test('re-review of an already published listing preserves the exact public snapshot',async t=>{
  const h=await harness(t),d=(await h.post('/api/market/seller/services',draft)).value;
  await h.post(`/api/market/platform/services/${d.id}/publish`,{version:1,reason:'平台确认上架'});
  const before=await h.get('/api/market/catalog');
  assert.equal((await h.post(`/api/market/platform/services/${d.id}/review`,{version:1})).value.status,'published');
  assert.deepEqual(await h.get('/api/market/catalog'),before);
  assert.equal((await h.get('/api/market/seller/services'))[0].currentReview.approved,true);
});
