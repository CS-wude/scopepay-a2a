import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDomain,candidates,evaluate,Negotiator} from '../scopepay/negotiation.mjs';
import {createIdentity,signDocument} from '../scopepay/identity.mjs';

const now=100000;
function fixture(){
  const domain={id:'change',version:1,contractVersion:1,currency:'USD',priceMinMinor:800,priceMaxMinor:2400,priceStepMinor:100,required:['french'],packages:[{id:'standard',scope:['french','included_color'],dueAt:200000,extraRevisions:0}]};
  const buyer={role:'buyer',version:1,capMinor:2000,remainingMinor:2000,latestDueAt:200000,disagreementMinor:0,values:{standard:2200}};
  const seller={role:'seller',version:1,minMarginMinor:300,disagreementMinor:0,costs:{standard:1200},available:['standard']};
  return {domain,buyer,seller};
}
function agents(f=fixture()){
  const b=createIdentity('buyer'),s=createIdentity('seller');
  const common={domain:f.domain,sessionId:'session',expiresAt:300000,maxTurns:12};
  return {buyer:new Negotiator({...common,policy:f.buyer,identity:b,peer:{id:'seller',publicKey:s.publicKey}}),seller:new Negotiator({...common,policy:f.seller,identity:s,peer:{id:'buyer',publicKey:b.publicKey}}),b,s};
}
function run(pair){
  let role='seller',r=pair.seller.act(null,now);const log=[r];
  for(let i=0;i<20&&r.message;i++){
    role=role==='seller'?'buyer':'seller';r=pair[role].act(r.message,now);log.push(r);
  }
  return {result:r,log};
}
test('same scope negotiates a real price under independently held boundaries',()=>{
  const f=fixture(),{result,log}=run(agents(f));assert.equal(result.state,'agreed');
  assert.ok(result.candidate.amountMinor>=1500&&result.candidate.amountMinor<=2000);
  assert.ok(new Set(log.filter(x=>x.message?.payload.type==='offer').map(x=>x.candidate.amountMinor)).size>1);
  assert.ok(evaluate(f.domain,f.buyer,result.candidate)>=0);assert.ok(evaluate(f.domain,f.seller,result.candidate)>=300);
});
test('no overlap terminates without an agreement',()=>{
  const f=fixture();f.buyer.capMinor=1200;assert.equal(run(agents(f)).result.state,'rejected');
});
test('owner budget, remaining balance, deadline and seller availability filter candidates',()=>{
  const f=fixture();f.buyer.remainingMinor=900;assert.ok(candidates(f.domain,f.buyer).every(x=>x.amountMinor<=900));
  f.buyer.latestDueAt=199999;assert.equal(candidates(f.domain,f.buyer).length,0);
  f.seller.available=[];assert.equal(candidates(f.domain,f.seller).length,0);
});
test('required scope, safe integer money, complete private utility tables and bounded enumeration',()=>{
  const f=fixture();f.domain.packages[0].scope=[];assert.throws(()=>validateDomain(f.domain),/required/);
  const g=fixture();g.domain.priceStepMinor=0.1;assert.throws(()=>validateDomain(g.domain),/grid/);
  const h=fixture();h.buyer.values={};assert.throws(()=>candidates(h.domain,h.buyer),/utility/);
  const k=fixture();k.domain.priceMaxMinor=Number.MAX_SAFE_INTEGER;assert.throws(()=>validateDomain(k.domain),/large/);
});
test('signed messages expose no raw private policy and cannot replay or cross sessions',()=>{
  const p=agents();const first=p.seller.act(null,now);const payload=first.message.payload;
  assert.equal(JSON.stringify(payload).includes('costs'),false);assert.equal(JSON.stringify(payload).includes('capMinor'),false);
  p.buyer.act(first.message,now);assert.throws(()=>p.buyer.act(first.message,now),/order/);
  const q=agents();const forged=signDocument({...q.seller.act(null,now).message.payload,sessionId:'other'},q.s.privateKey);
  assert.throws(()=>q.buyer.act(forged,now),/binding/);
});
test('accept must match immediately preceding signed offer',()=>{
  const p=agents(),offer=p.seller.act(null,now).message;
  const response=p.buyer.act(offer,now).message;
  const forged=signDocument({...response.payload,type:'accept',candidate:{packageId:'standard',amountMinor:1600}},p.b.privateKey);
  assert.throws(()=>p.seller.act(forged,now),/Acceptance/);
});
test('expired negotiation rejects, policy snapshot cannot be raised by caller mutation',()=>{
  const f=fixture(),p=agents(f);f.buyer.capMinor=2400;assert.equal(p.buyer.policy.capMinor,2000);
  const offer=p.seller.act(null,now);const r=p.buyer.act(offer.message,300000);assert.equal(r.state,'rejected');
});
test('multiple complete packages use own nonlinear utility table',()=>{
  const f=fixture();f.domain.packages.push({...f.domain.packages[0],id:'with_revision',extraRevisions:1});
  f.buyer.values.with_revision=3000;f.seller.costs.with_revision=1200;f.seller.available.push('with_revision');
  const {result}=run(agents(f));assert.equal(result.state,'agreed');assert.equal(result.candidate.packageId,'with_revision');
});
test('changed domains and unsigned price edits cannot enter negotiation history',()=>{
  const p=agents(),first=p.seller.act(null,now).message;
  const changed={...first,payload:{...first.payload,candidate:{packageId:'standard',amountMinor:1500}}};
  assert.throws(()=>p.buyer.act(changed,now),/signature/);assert.equal(p.buyer.history.length,0);
  const signed=signDocument({...first.payload,domainHash:'wrong'},p.s.privateKey);
  assert.throws(()=>p.buyer.act(signed,now),/binding/);assert.equal(p.buyer.history.length,0);
});
test('different outside options change admissibility rather than silently assuming zero',()=>{
  const f=fixture();f.buyer.disagreementMinor=500;
  assert.ok(candidates(f.domain,f.buyer).every(c=>c.amountMinor<=1700));
  f.seller.disagreementMinor=600;
  assert.ok(candidates(f.domain,f.seller).every(c=>c.amountMinor>=1800));
  assert.equal(run(agents(f)).result.state,'rejected');
});
test('varied hidden numeric boundaries preserve individual rationality without scenario identifiers',()=>{
  for(let i=0;i<30;i++){
    const f=fixture();f.buyer.capMinor=1400+(i%7)*100;f.buyer.remainingMinor=1300+(i%8)*100;f.seller.costs.standard=900+(i%5)*100;
    const {result,log}=run(agents(f));assert.ok(log.length<=14);
    if(result.state==='agreed'){
      assert.notEqual(evaluate(f.domain,f.buyer,result.candidate),null);
      assert.notEqual(evaluate(f.domain,f.seller,result.candidate),null);
    }else assert.equal(result.state,'rejected');
  }
});
