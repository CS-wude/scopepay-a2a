import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {startCluster} from './start.mjs';
import {FixturePSP} from './payment.mjs';
const envFile=new URL('../.env',import.meta.url);if(existsSync(envFile))process.loadEnvFile(envFile);
const root=new URL(`../.scopepay/market-smoke-${Date.now()}/`,import.meta.url).pathname,psp=new FixturePSP(),create=psp.create.bind(psp);let sales=0,c;
psp.create=async op=>{sales++;return create(op);};
const options={root,port:0,buyerPort:0,sellerPort:0,modelMode:'live',paymentMode:'fixture',env:process.env,psp};
const report={startedAt:new Date().toISOString(),model:process.env.MODEL_NAME,protocol:'OpenAI-compatible chat/completions',mode:'Real model review and A2A, Fixture PSP; isolated local owner workspace',checks:[]};
async function harness(){c=await startCluster(options);const csrf=(await fetch(c.url+'/api/market/bootstrap').then(r=>r.json())).csrf;return {get:p=>fetch(c.url+p).then(r=>r.json()),post:async(p,b={})=>{const r=await fetch(c.url+p,{method:'POST',headers:{Origin:c.url,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(b)}),v=await r.json();if(!r.ok)throw new Error(v.error);return v;}};}
try{
  let h=await harness();const draft={title:'演示 SRT 法语字幕翻译',description:'基于本地提供的30秒演示SRT，翻译为法语并保留全部时间码。仅交付字幕文本，不渲染视频。',kind:process.argv[2]??'french',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:24};
  const d=await h.post('/api/market/seller/services',draft);await h.post(`/api/market/seller/services/${d.id}/submit`,{version:1});
  report.approval=await h.post(`/api/market/platform/services/${d.id}/review`,{version:1});assert.equal(report.approval.status,'approved');assert.equal((await h.get('/api/market/catalog')).length,0);await h.post(`/api/market/seller/services/${d.id}/publish`,{version:1});report.checks.push('real-model approval remains private until seller publishes');
  const bad=await h.post('/api/market/seller/services',{...draft,title:'无限剪辑保证',description:'提供任意视频上传处理，保证电影级视频渲染、专业配音并重新剪辑，全部包含在报价里。'});await h.post(`/api/market/seller/services/${bad.id}/submit`,{version:1});report.rejection=await h.post(`/api/market/platform/services/${bad.id}/review`,{version:1});assert.equal(report.rejection.status,'rejected');report.checks.push('misleading service guarantee rejected by live review');
  const catalog=await h.get('/api/market/catalog');assert.equal(catalog.length,1);assert.equal(catalog[0].costMinor,undefined);assert.equal(catalog[0].kind,draft.kind);assert.equal(catalog[0].fulfillmentKind,'french');report.catalog=catalog;
  const start=await h.post('/api/v2/sessions',{requestId:randomUUID(),text:'请制作法语字幕，按标准交期交付。',service:{id:d.id,version:1}});let s;
  for(let i=0;i<400;i++){s=(await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===start.id);if(!['ready','negotiating'].includes(s?.state))break;await new Promise(r=>setTimeout(r,300));}
  assert.equal(s.state,'agreed');report.agreement=s;report.checks.push('real separate A2A agents reached agreement');
  const path=`/api/v2/sessions/${s.id}`;report.receipt=(await h.post(path+'/pay')).receipt;report.delivery=(await h.post(path+'/deliver')).delivery;assert.equal(report.delivery.mode,'live');assert.equal(report.delivery.review.accepted,true);await h.post(path+'/pay');assert.equal(sales,1);report.checks.push('real model subtitle delivered and reviewed; payment exactly once');
  await c.close();h=await harness();assert.equal((await h.get('/api/market/catalog'))[0].id,d.id);assert.equal((await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===s.id).state,'delivered');
  assert.ok((await h.get('/api/market/workspace?role=buyer')).sessions.find(x=>x.id===s.id).delivery.srt);assert.equal(sales,1);report.checks.push('restart preserved publication, receipt and delivery without recharging');
  report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await c?.close();report.sales=sales;report.finishedAt=new Date().toISOString();report.runtimeRoot=root;mkdirSync('.evidence',{recursive:true});writeFileSync('.evidence/scopepay-market-live.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({passed:report.passed,checks:report.checks,sales,error:report.error}));}
