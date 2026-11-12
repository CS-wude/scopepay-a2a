// User-requested business scenario audit. Does not alter the running demo.
// Original CNY business requirements are NOT relabelled as supported USD orders.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {startCluster} from './start.mjs';
import {FixturePSP} from './payment.mjs';
import {createIdentity} from './identity.mjs';
import {Negotiator,evaluate,candidates,validateDomain} from './negotiation.mjs';
import {defaultDelegation,validateDelegation} from './v2.mjs';

const runId=new Date().toISOString().replace(/[:.]/g,'-');
const root=new URL(`../.scopepay/business-audit-${runId}/`,import.meta.url).pathname;
const evidence=new URL('../.evidence/',import.meta.url).pathname;mkdirSync(evidence,{recursive:true});
const report={runId,startedAt:new Date().toISOString(),scope:'Three user-designed business scenarios; offline economic probes, isolated HTTP/A2A controls and original-text live-model probes. Fixture payments only.',moneyMapping:'Original scenarios use CNY, which the product does not support. Offline probes use abstract minor units; HTTP controls use USD amounts equal to original nominal amounts / 20. This is a synthetic scaling, NOT FX conversion or CNY support.',checks:[],economic:[],http:[],live:[],gaps:[]};
const files=readdirSync(new URL('./',import.meta.url)).filter(f=>f.endsWith('.mjs')).sort();
report.sourceSHA256=createHash('sha256').update(files.map(f=>f+'\n'+readFileSync(new URL(f,import.meta.url),'utf8')).join('\n')).digest('hex');
function check(id,ok,details){report.checks.push({id,passed:!!ok,details});console.log(JSON.stringify({check:id,passed:!!ok}));}
function economic(id,packages,cap,values,costs,margin,remaining=cap,beta=1){
  const d={id,version:1,contractVersion:1,currency:'USD',priceMinMinor:0,priceMaxMinor:50000,priceStepMinor:100,required:['french'],packages:packages.map(([id,dueAt,revisions=0])=>({id,scope:['french','included_color'],dueAt,extraRevisions:revisions}))};
  const b={role:'buyer',version:1,capMinor:cap,remainingMinor:remaining,latestDueAt:200000,disagreementMinor:0,values};
  const s={role:'seller',version:1,minMarginMinor:margin,disagreementMinor:0,costs,available:packages.map(x=>x[0])};
  const bi=createIdentity('buyer'),si=createIdentity('seller'),common={domain:d,sessionId:randomUUID(),expiresAt:300000,maxTurns:12};
  const agents={buyer:new Negotiator({...common,policy:b,identity:bi,peer:si}),seller:new Negotiator({...common,policy:s,identity:si,peer:bi,beta})};
  let role='seller',r=agents.seller.act(null,100000);const messages=[];
  while(r.message&&messages.length<16){messages.push(r.message.payload);role=role==='seller'?'buyer':'seller';r=agents[role].act(r.message,100000);}
  const feasible=candidates(d,b).filter(c=>evaluate(d,s,{packageId:c.packageId,amountMinor:c.amountMinor})!==null);
  const row={id,beta,state:r.state,candidate:r.candidate,messages,feasibleCount:feasible.length,buyerUtility:r.candidate?evaluate(d,b,r.candidate):null,sellerUtility:r.candidate?evaluate(d,s,r.candidate):null};report.economic.push(row);return row;
}
async function harness(mode,name,psp=new FixturePSP()){
  const c=await startCluster({root:root+name,port:0,buyerPort:0,sellerPort:0,modelMode:mode,paymentMode:'fixture',env:mode==='live'?process.env:{PATH:process.env.PATH},psp});
  const csrf=(await fetch(c.url+'/api/state').then(r=>r.json())).csrf;
  const get=()=>fetch(c.url+'/api/v2/state').then(r=>r.json());
  async function post(path,body={}){const r=await fetch(c.url+path,{method:'POST',headers:{Origin:c.url,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};}
  async function configure(extra){const r=await post('/api/v2/owners',{...(await get()).owners,...extra});assert.equal(r.status,200);}
  async function request(text){const r=await post('/api/v2/sessions',{requestId:randomUUID(),text});assert.equal(r.status,202,JSON.stringify(r));
    for(let i=0;i<720;i++){const s=(await get()).sessions.find(s=>s.id===r.value.id);if(!['ready','negotiating','paying'].includes(s?.state))return s;await new Promise(r=>setTimeout(r,250));}throw new Error('Business scenario timeout');}
  return {c,get,post,configure,request};
}
function snapshot(s){return {id:s.id,text:s.text,state:s.state,intent:s.intent,question:s.question,candidate:s.candidate,domain:s.domain,calls:s.calls,messages:s.messages,payment:s.payment,delivery:s.delivery};}
async function control(name,fn,psp){const h=await harness('fixture',name,psp);try{await fn(h);}finally{await h.c.close();}}
try{
  // Full numerical economic boundaries, without claiming natural language or FX.
  for(const beta of [.2,1,3]){
    const a=economic('S1',[['standard',200000],['tonight',150000]],28000,{standard:36000,tonight:38000},{standard:16000,tonight:26000},6000,28000,beta);
    check(`S1.economics.beta${beta}`,a.state==='agreed'&&a.candidate.packageId==='standard'&&a.candidate.amountMinor>=22000&&a.candidate.amountMinor<=28000,a.candidate);
    const b=economic('S2',[['tonight',150000,2],['morning',190000,1]],42000,{tonight:55000,morning:46000},{tonight:40000,morning:26000},4000,42000,beta);
    check(`S2.economics.beta${beta}`,b.state==='agreed'&&b.candidate.packageId==='morning'&&b.candidate.amountMinor>=30000&&b.candidate.amountMinor<=42000,b.candidate);
    const c=economic('S3',[['extra_revision',200000,1]],22000,{extra_revision:20000},{extra_revision:8000},2000,8000,beta);
    check(`S3.no_overlap.beta${beta}`,c.state==='rejected'&&c.feasibleCount===0,{remaining:8000,floor:10000});
  }
  await control('s1',async h=>{
    await h.configure({capMinor:1400,totalCapMinor:2500,standardCost:800,rushCost:1300,revisionCost:1700,minMarginMinor:300,standardValue:1800,rushValue:1900,revisionValue:1800});
    const s=await h.request('调蓝一点，加法语字幕，最好今晚给我，明天下午也能接受');report.http.push({scenario:'S1',...snapshot(s)});
    check('S1.http.agreement',s.state==='agreed'&&s.candidate.packageId==='standard'&&s.candidate.amountMinor>=1100&&s.candidate.amountMinor<=1400,s.candidate);
    check('S1.http.required_scope',s.domain?.required.includes('included_color')&&s.domain.required.includes('french'),s.domain?.required);
    const paid=await h.post(`/api/v2/sessions/${s.id}/pay`),delivered=await h.post(`/api/v2/sessions/${s.id}/deliver`);
    check('S1.http.payment_delivery',paid.status===200&&delivered.status===200&&delivered.value.delivery.review.accepted,{payment:paid,delivery:delivered.value.delivery});
    check('S1.http.included_color_consumed_once',(await h.get()).contract.colorRemaining===0,(await h.get()).contract);
  });
  await control('s2',async h=>{
    await h.configure({capMinor:2100,totalCapMinor:2500,standardCost:1300,rushCost:2000,revisionCost:1800,minMarginMinor:200,standardValue:2300,rushValue:2750,revisionValue:2300});
    const s=await h.request('加法语字幕，今晚给最好，明天交也可以');report.http.push({scenario:'S2',...snapshot(s)});
    check('S2.http.tradeoff',s.state==='agreed'&&s.candidate.packageId!=='today'&&s.candidate.amountMinor<=2100,s.candidate);
    const mandatory=await h.request('添加法语字幕，今晚必须交付');report.http.push({scenario:'S2-hard-deadline-control',...snapshot(mandatory)});
    check('S2.http.no_overlap_hard_deadline',mandatory.state==='rejected',{state:mandatory.state,candidate:mandatory.candidate});
  });
  const psp=new FixturePSP(),create=psp.create.bind(psp),find=psp.findByOrder.bind(psp);let sales=0,lose=false,hide=false;
  psp.create=async op=>{sales++;const r=await create(op);if(lose)throw new Error('Injected lost response AFTER provider created sale');return r;};
  psp.findByOrder=async id=>hide?[]:find(id);
  await control('s3',async h=>{
    await h.configure({capMinor:1400,totalCapMinor:2500,standardCost:1300,revisionCost:2000,rushCost:2000,minMarginMinor:100,standardValue:1400,revisionValue:1400,rushValue:1400,wrapCostMinor:600,wrapValueMinor:700});
    const first=await h.request('加法语字幕，明天交即可');assert.equal(first.state,'agreed');
    assert.equal((await h.post(`/api/v2/sessions/${first.id}/pay`)).status,200);assert.equal((await h.post(`/api/v2/sessions/${first.id}/deliver`)).status,200);
    check('S3.http.first_payment',(await h.get()).budgetUsed===1400,{used:(await h.get()).budgetUsed,sales});
    const wrap=await h.request('压缩字幕行长，方便手机阅读');assert.equal(wrap.state,'agreed');lose=true;hide=true;
    const path=`/api/v2/sessions/${wrap.id}/pay`,lost=await h.post(path),retry=await h.post(path),pending=await h.get();
    check('S3.http.unknown_reserves_budget',lost.status===409&&retry.status===409&&pending.budgetUsed===2100&&sales===2,{lost,retry,budgetUsed:pending.budgetUsed,remaining:2500-pending.budgetUsed,sales});
    check('S3.http.blocks_unverified_delivery',(await h.post(`/api/v2/sessions/${wrap.id}/deliver`)).status===409,{});
    const revision=await h.request('另外购买一轮额外修改，不能超过剩余预算');report.http.push({scenario:'S3-extra-revision',...snapshot(revision)});
    check('S3.http.unsupported_revision_does_not_charge',['needs_owner','needs_clarification'].includes(revision.state)&&sales===2,{state:revision.state,sales});
    const bypass=await h.post('/api/v2/project');check('S3.http.blocks_project_reset',bypass.status===409,bypass);
    hide=false;lose=false;const recovered=await h.post(path),again=await h.post(path);
    check('S3.http.recovers_original_without_resale',recovered.status===200&&again.status===200&&recovered.value.receipt.id===again.value.receipt.id&&sales===2,{recovered,again,sales,budgetUsed:(await h.get()).budgetUsed});
    const final=await h.post(`/api/v2/sessions/${wrap.id}/deliver`);
    check('S3.http.original_delivery',final.status===200&&final.value.delivery.review.accepted,{status:final.status,review:final.value.delivery?.review});
    report.http.push({scenario:'S3',first:snapshot(first),wrap:snapshot((await h.get()).sessions.find(x=>x.id===wrap.id)),budgetUsed:(await h.get()).budgetUsed,sales});
    const defect=await h.request('法语字幕里的产品术语翻错了，请按已确认术语表免费修复');report.http.push({scenario:'S3-defect-routing',...snapshot(defect)});
  },psp);
  const envFile=new URL('../.env',import.meta.url);if(existsSync(envFile))process.loadEnvFile(envFile);
  const originals=[
    ['S1','整体挺好了，背景再调蓝一点。顺手加个法语字幕吧，中文字幕都已经有了，应该很快。最好今晚给我。'],
    ['S2','加一份法语字幕，今晚八点前给最好，我想先内部过一下。明天下午四点开会，明天中午前必须给。还想加两轮修改，一轮也可以；我可以今晚六点前交术语表，由一个人集中反馈。'],
    ['S3','法语里那个产品名翻错了，请按已经确认的术语表免费修复。另外手机上字幕太长，帮我重新排一下。老板可能还要改一次，也一起安排了吧。']
  ];
  for(let repeat=0;repeat<3;repeat++)for(const [id,text] of originals){
    const h=await harness('live',`live-${id}-${repeat}`);try{
      await h.configure(id==='S2'?{capMinor:2100,totalCapMinor:2500,standardCost:1300,rushCost:2000,revisionCost:1800,minMarginMinor:200,standardValue:2300,rushValue:2750,revisionValue:2300}:{capMinor:1400,totalCapMinor:2500,standardCost:800,rushCost:1300,revisionCost:1700,minMarginMinor:300,standardValue:1800,rushValue:1900,revisionValue:1800,...(id==='S3'?{frenchIncluded:true}:{})});
      const started=Date.now(),s=await h.request(text);const liveRow={scenario:id,repeat,elapsedMs:Date.now()-started,...snapshot(s)};report.live.push(liveRow);
      check(`${id}.live.${repeat}.no_unapproved_payment`,(await h.get()).budgetUsed===0,{state:s.state,calls:s.calls});
      console.log(JSON.stringify({live:id,repeat,state:s.state,intent:s.intent,candidate:s.candidate}));
      if(id==='S1'){
        check(`S1.live.${repeat}.agreement_in_boundaries`,s.state==='agreed'&&s.candidate?.packageId==='standard'&&s.candidate.amountMinor>=1100&&s.candidate.amountMinor<=1400,s.candidate);
        if(s.state==='agreed'){
          const paid=await h.post(`/api/v2/sessions/${s.id}/pay`),delivered=await h.post(`/api/v2/sessions/${s.id}/deliver`);
          const final=(await h.get()).sessions.find(x=>x.id===s.id);liveRow.final=snapshot(final);
          check(`S1.live.${repeat}.real_model_delivery`,paid.status===200&&delivered.status===200&&final.state==='delivered'&&final.delivery.mode==='live'&&final.delivery.review.accepted,{payStatus:paid.status,deliverStatus:delivered.status,state:final.state,calls:final.calls,review:final.delivery?.review});
        }
      }
    }finally{await h.c.close();}
  }
  validateDomain(report.http[0].domain);
  let cnyRejected=false;try{validateDomain({...report.http[0].domain,currency:'CNY'});}catch{cnyRejected=true;}
  check('S0.CNY_not_supported',cnyRejected,{classification:'Product gap, not CNY acceptance'});
  const fake={...defaultDelegation(),feedbackDeadline:180000};let unknownFieldsRejected=false;try{validateDelegation(fake);}catch{unknownFieldsRejected=true;}
  check('S2.unmodelled_obligation_rejected',unknownFieldsRejected,{classification:'Product gap: feedback deadline, glossary obligation and exact clock deadlines absent'});
  report.gaps=[
    {scenario:'all',gap:'CNY currency unsupported; intake also hard-codes $24 maximum grid. Original CNY economic values cannot be exercised end to end.'},
    {scenario:'S1',gap:'No contract glossary, original contract text interpretation, or explicit once-only free translation-correction entitlement; no video rendering.'},
    {scenario:'S2',gap:'dueAt is generated as now+1h or now+24h. No exact local clock/timezone deadline, two extra revisions, conditional glossary submission or feedback-window fields.'},
    {scenario:'S3',gap:'No durable original-order defect claim/term correction workflow. Standalone extra revision purchase is not modelled, despite prompt mentioning it.'},
    {scenario:'S3',gap:'Original-text live probe has French-included flag only, not the full previous real project. Separate HTTP control covers actual historical payment, lost-response reservation and delivery recovery.'}
  ];
}catch(e){report.fatal={name:e.name,message:e.message};process.exitCode=1;console.log(JSON.stringify({fatal:report.fatal}));}
finally{
  report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(x=>x.passed).length;report.total=report.checks.length;
  report.completeBusinessAcceptance=false;report.runtimeRoot=root;
  report.runnerSHA256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
  const latest=evidence+'scopepay-three-business-scenarios.json';
  if(existsSync(latest)){const old=readFileSync(latest,'utf8'),previous=JSON.parse(old);writeFileSync(evidence+`scopepay-three-business-scenarios-${previous.runId}.json`,old,{mode:0o600});}
  const content=JSON.stringify(report,null,2);writeFileSync(latest,content,{mode:0o600});writeFileSync(evidence+`scopepay-three-business-scenarios-${runId}.json`,content,{mode:0o600});
  console.log(JSON.stringify({passed:report.passed,total:report.total,economic:report.economic.length,http:report.http.length,live:report.live.length,completeBusinessAcceptance:false,fatal:report.fatal??null}));
  if(report.checks.some(x=>!x.passed))process.exitCode=1;
}
