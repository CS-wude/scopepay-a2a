// Finite automated acceptance campaign. A/C use actual loopback A2A processes;
// B uses the independent offline utility evaluator. No live models or external PSP.
import {mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {startCluster} from './start.mjs';
import {FixturePSP} from './payment.mjs';
import {runEvaluation} from './evaluate.mjs';
import {deliveryAction} from './v2-agent.mjs';
import {createIdentity} from './identity.mjs';
import {FRENCH_SRT} from './fixtures.mjs';
const sourceFiles=[...readdirSync('scopepay').filter(f=>f.endsWith('.mjs')).map(f=>'scopepay/'+f),...readdirSync('scopepay/public').filter(f=>/\.(html|css|js)$/.test(f)).map(f=>'scopepay/public/'+f)].sort();
const sourceFingerprint=createHash('sha256').update(sourceFiles.map(f=>f+'\n'+readFileSync(f,'utf8')).join('\n')).digest('hex');

async function runCase(id,seed,repeat){
  const psp=new FixturePSP(),create=psp.create.bind(psp);let sales=0;
  psp.create=async op=>{sales++;const t=await create(op);if(id==='C5'&&sales===1)throw new Error('lost response');return t;};
  const c=await startCluster({root:mkdtempSync(join(tmpdir(),'scopepay-accept-')),port:0,buyerPort:0,sellerPort:0,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH},psp});
  try{
    const csrf=(await fetch(c.url+'/api/state').then(r=>r.json())).csrf;
    const get=()=>fetch(c.url+'/api/v2/state').then(r=>r.json());
    const post=async(path,body={})=>{const r=await fetch(c.url+path,{method:'POST',headers:{Origin:c.url,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
    const configure=async changes=>{const p=(await get()).owners;assert.equal((await post('/api/v2/owners',{...p,...changes})).status,200);};
    async function request(text){const r=await post('/api/v2/sessions',{requestId:randomUUID(),text});assert.equal(r.status,202);return wait(r.value.id);}
    async function wait(id){for(let i=0;i<200;i++){const s=(await get()).sessions.find(x=>x.id===id);if(!['ready','negotiating'].includes(s?.state))return s;await new Promise(r=>setTimeout(r,10));}throw new Error('Acceptance timeout');}
    const pay=s=>post(`/api/v2/sessions/${s.id}/pay`);
    let s;
    if(id==='A1'){
      await configure({capMinor:1000,standardCost:800+(seed%2)*100});s=await request('调蓝，加法语字幕，最好今晚给');assert.equal(s.state,'agreed');assert.ok(s.candidate.amountMinor<=1000);assert.equal(s.candidate.packageId,'standard');assert.ok(s.domain.required.includes('included_color'));assert.equal((await pay(s)).status,200);
    }else if(id==='A2'){
      await configure({colorRemaining:0,allowPaidColor:true,capMinor:1400,standardCost:800,minMarginMinor:100});s=await request('调蓝 加法语字幕');assert.equal(s.state,'agreed');assert.ok(s.domain.required.includes('paid_color'));assert.ok(s.candidate.amountMinor>=1300&&s.candidate.amountMinor<=1400);assert.equal((await pay(s)).status,200);
    }else if(id==='A3'){
      await configure({subtitleLanguageKnown:false});s=await request('加法语字幕');assert.equal(s.state,'needs_clarification');assert.equal(sales,0);
      if(seed%2===0){await configure({subtitleLanguageKnown:true});assert.equal((await post(`/api/v2/sessions/${s.id}/resume`)).status,200);assert.equal((await wait(s.id)).state,'agreed');}
    }else if(id==='A4'){
      s=await request(`调蓝，再补${15+seed}秒介绍`);assert.equal(s.state,'needs_owner');assert.equal(sales,0);
    }else if(id==='A5'){
      s=await request('加法语字幕');assert.equal(s.state,'agreed');const saved=c.store.getSetting(`v2:${s.id}`);saved.candidate.amountMinor+=100+seed;c.store.setSetting(`v2:${s.id}`,saved);assert.equal((await pay(s)).status,409);assert.equal(sales,0);
    }else if(id==='A6'){
      s=await request(seed%2?'加法语字幕，今晚必须给':'加法语字幕，最好今晚给');assert.equal(s.state,'agreed');assert.equal(s.domain.packages.some(p=>p.id==='standard'),seed%2===0);
    }else if(id==='C1'){
      await configure({totalCapMinor:2000});s=await request('加法语字幕');assert.equal((await pay(s)).status,200);const remaining=2000-(await get()).budgetUsed;const next=await request('压缩字幕行长');assert.equal(next.state,'agreed');assert.ok(next.candidate.amountMinor<=remaining);assert.equal((await pay(next)).status,200);assert.ok((await get()).budgetUsed<=2000);
    }else if(id==='C2'){
      await configure({totalCapMinor:2000});const [a,b]=await Promise.all([request('加法语字幕'),request('加法语字幕')]);assert.equal(a.state,'agreed');assert.equal(b.state,'agreed');const results=await Promise.all([pay(a),pay(b)]);assert.equal(results.filter(r=>r.status===200).length,1);assert.ok((await get()).budgetUsed<=2000);assert.equal(sales,1);
    }else if(id==='C3'){
      s=await request('加法语字幕');const saved=c.store.getSetting(`v2:${s.id}`);c.store.setSetting(`v2:${s.id}`,{...saved,expiresAt:Date.now()-seed-1});assert.equal((await pay(s)).status,409);assert.equal(sales,0);
    }else if(id==='C4'){
      s=await request('加法语字幕');assert.equal((await pay(s)).status,200);const values=new Map();let attempts=0;
      const artifact=await deliveryAction({input:{type:'v2_deliver',runId:s.id},role:'seller',identity:createIdentity('seller'),store:{get:k=>values.get(k),set:(k,v)=>{values.set(k,v);return v;}},internal:async()=>({session:{candidate:{packageId:'standard'},domain:{packages:[{id:'standard',scope:['french']}]}},receipt:{state:'verified',agreementHash:'same-contract',transactionId:'same-payment'}}),model:{mode:'fixture',call:async()=>({value:{srt:++attempts===1?'broken':FRENCH_SRT}})}});
      assert.equal(attempts,2);assert.equal(artifact.srt,FRENCH_SRT);assert.equal(sales,1);
      assert.equal((await post(`/api/v2/sessions/${s.id}/deliver`)).status,200);assert.equal(sales,1);
    }else if(id==='C5'){
      s=await request('加法语字幕');assert.equal((await pay(s)).status,409);assert.equal((await get()).sessions.find(x=>x.id===s.id).payment.state,'unknown');assert.equal((await pay(s)).status,200);assert.equal(sales,1);
    }else if(id==='C6'){
      s=await request('加法语字幕');await configure({requireToday:true});assert.equal((await pay(s)).status,409);const newer=await request('加法语字幕');assert.equal(newer.state,'agreed');assert.equal(newer.candidate.packageId,'today');assert.equal((await pay(newer)).status,200);
    }
    return {id,seed,repeat,passed:true,sales};
  }catch(e){return {id,seed,repeat,passed:false,error:e.message};}finally{await c.close();}
}
const rows=[],jobs=[];
for(const id of ['A1','A2','A3','A4','A5','A6','C1','C2','C3','C4','C5','C6'])for(let seed=0;seed<10;seed++)for(let repeat=0;repeat<3;repeat++)jobs.push({id,seed,repeat});
let cursor=0;
async function worker(){while(cursor<jobs.length){const job=jobs[cursor++];rows.push(await runCase(job.id,job.seed,job.repeat));if(rows.length%30===0)console.log(JSON.stringify({finished:rows.length,total:360,failed:rows.filter(r=>!r.passed).length}));}}
await Promise.all([worker(),worker()]);
const b=runEvaluation(40);rows.push(...b.rows.map(r=>({...r,passed:r.correct})));
const report={sourceFingerprint,createdAt:new Date().toISOString(),scope:'18 finite synthetic scenario families, 10 variants x 3 repeats. A/C: fixture agents over real A2A with injected checks. B: offline utility engine. No live-model success-rate claim. A5 tests accepted-price integrity; C4 combines repair-unit and HTTP delivery checks, not adversarial supplier network injection.',runs:rows.length,groups:[...new Set(rows.map(r=>r.id))].sort().map(id=>{const x=rows.filter(r=>r.id===id);return {id,runs:x.length,passed:x.filter(r=>r.passed).length};}),rows};
writeFileSync('.evidence/scopepay-v2-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({runs:report.runs,groups:report.groups},null,2));if(rows.some(r=>!r.passed))process.exitCode=1;
