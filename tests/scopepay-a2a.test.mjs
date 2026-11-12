import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIdentity,signDocument} from '../scopepay/identity.mjs';
import {Store} from '../scopepay/store.mjs';
import {defaultProject,defaultPolicies} from '../scopepay/domain.mjs';
import {FixturePSP,PaymentService} from '../scopepay/payment.mjs';
import {Model} from '../scopepay/model.mjs';
const a=await import('../scopepay/agent.mjs').catch(()=>({}));
const g=await import('../scopepay/gateway.mjs').catch(()=>({}));

export async function setupA2A(t,{policies=defaultPolicies(),sellerModel=new Model({mode:'fixture'}),buyerModel=new Model({mode:'fixture'}),testPSP}={}){
  assert.equal(typeof a.startAgent,'function','real A2A agents required');
  const dir=mkdtempSync(join(tmpdir(),'scopepay-a2a-')),store=new Store(join(dir,'main.sqlite'));
  store.setPolicies(policies);t.after(()=>store.close());
  const identities={buyer:createIdentity('buyer'),seller:createIdentity('seller')};
  const psp=testPSP??new FixturePSP();let sales=0;const create=psp.create.bind(psp);psp.create=op=>{sales++;return create(op);};
  const payments=new PaymentService({store,psp,identities});
  const tokens={buyer:'test-buyer-internal',seller:'test-seller-internal'};
  const app=express();app.use(express.json({limit:'64kb'}));g.mountGateway(app,{store,payments,identities,tokens});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(r=>server.close(r)));const paymentURL=`http://127.0.0.1:${server.address().port}`;
  const seller=await a.startAgent({role:'seller',port:0,identity:identities.seller,peer:identities.buyer,model:sellerModel,taskFile:join(dir,'seller.sqlite'),paymentURL,internalToken:tokens.seller,incomingToken:'buyer-to-seller'});t.after(()=>seller.close());
  const buyer=await a.startAgent({role:'buyer',port:0,identity:identities.buyer,peer:identities.seller,model:buyerModel,taskFile:join(dir,'buyer.sqlite'),paymentURL,internalToken:tokens.buyer,incomingToken:'main-to-buyer',sellerURL:seller.url,sellerToken:'buyer-to-seller'});t.after(()=>buyer.close());
  const run=(caseId='standard')=>{const project=store.createProject(defaultProject());return store.createRun(project.id,{caseId,modelMode:'fixture'});};
  return {store,buyer,seller,run,identities,dir,sales:()=>sales};
}
test('real A2A HTTP negotiates 15 to 10, signs autonomous purchase, delivers and accepts French SRT',async t=>{
  const x=await setupA2A(t),run=x.run();
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.state,'accepted');assert.equal(result.value.receipt.amountMinor,1000);assert.equal(x.sales(),1);
  assert.equal(result.value.modelMode,'fixture');assert.equal(result.value.review.source,'fixture');
  assert.equal(result.artifacts.some(x=>x.parts.some(p=>p.filename==='aurora.fr.srt')),true);
  const events=x.store.getRun(run.id).events;
  assert.deepEqual(events.filter(e=>e.type==='quote').map(e=>e.amountMinor),[1500,1000]);
  assert.ok(events.some(e=>e.type==='a2a'&&e.taskId&&e.contextId===run.id));
  const repeat=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(repeat.value.receipt.transactionId,result.value.receipt.transactionId);assert.equal(x.sales(),1);
});
test('A2A rejects unauthorized caller and forged peer; budget rejection never charges',async t=>{
  const policies=defaultPolicies();policies.buyer.singleCapMinor=500;
  const x=await setupA2A(t,{policies}),run=x.run();
  await assert.rejects(a.requestAgent(x.buyer.url,'wrong',{type:'start',runId:run.id},run.id));
  const forged=signDocument({type:'quote_request',runId:run.id,selection:{color:true,french:true,rush:true}},createIdentity('buyer').privateKey);
  const bad=await a.requestAgent(x.seller.url,'buyer-to-seller',forged,run.id);
  assert.equal(bad.value.state,'failed');
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.state,'rejected');assert.equal(x.sales(),0);
});
test('delivery model failure preserves verified paid status instead of reporting success',async t=>{
  const sellerModel=new Model({mode:'fixture'});const original=sellerModel.call.bind(sellerModel);
  sellerModel.call=(role,action,...rest)=>action==='translate'?Promise.reject(new Error('Model provider request failed')):original(role,action,...rest);
  const x=await setupA2A(t,{sellerModel}),run=x.run();
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.state,'paid_delivery_failed');assert.equal(result.value.receipt.verified,true);assert.equal(x.sales(),1);
});

test('included revision records a scope amendment with zero PSP calls and no fake video delivery',async t=>{
  const policies=defaultPolicies();policies.buyer.required=[];
  const x=await setupA2A(t,{policies}),run=x.run('included');
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.state,'accepted');assert.equal(result.value.receipt.status,'included');assert.equal(x.sales(),0);
  assert.equal(result.value.srt,null);assert.match(result.value.revision.note,/No video rendering/);
});

test('buyer requests one correction on the same paid quote, rechecks delivery, and stays within eight calls',async t=>{
  const buyerModel=new Model({mode:'fixture'}),call=buyerModel.call.bind(buyerModel);let reviews=0;
  buyerModel.call=async(role,action,...rest)=>{const result=await call(role,action,...rest);if(action==='review'&&reviews++===0)result.value={accepted:false,reason:'Please correct the wording in cue five.'};return result;};
  const x=await setupA2A(t,{buyerModel}),run=x.run();
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.state,'accepted');assert.equal(result.value.manifest.payload.deliveryVersion,2);
  assert.equal(x.sales(),1);assert.equal(x.store.getRun(run.id).modelCalls,8);
});

for(const change of ['add-paid','drop-included'])test(`counteroffer cannot ${change} outside the requested task`,async t=>{
  const policies=defaultPolicies();policies.buyer.required=[];
  const buyerModel=new Model({mode:'fixture'}),call=buyerModel.call.bind(buyerModel);let decisions=0;
  buyerModel.call=async(role,action,...rest)=>{const result=await call(role,action,...rest);if(action==='decide'&&decisions++===0)result.value={decision:'counter',selection:change==='add-paid'?{color:true,french:true,rush:false}:{color:false,french:true,rush:false},reason:'A model-proposed scope change.'};return result;};
  const x=await setupA2A(t,{policies,buyerModel}),run=x.run(change==='add-paid'?'included':'standard');
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.state,'failed');assert.match(result.value.error,/scope/i);assert.equal(x.sales(),0);
});

test('model/schema and subtitle timing failures preserve controlled stage and cause',async t=>{
  const broken=new Model({mode:'fixture'});broken.call=async()=>{throw new Error('Model output schema invalid');};
  const x=await setupA2A(t,{sellerModel:broken}),run=x.run();
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.stage,'seller.offer.model');assert.equal(result.value.errorCode,'MODEL_SCHEMA');assert.match(result.value.error,/schema/i);
});

test('subtitle timing failure keeps its delivery stage',async t=>{
  const badSrt=new Model({mode:'fixture'}),call=badSrt.call.bind(badSrt);
  badSrt.call=async(role,action,...rest)=>{const out=await call(role,action,...rest);if(action==='translate')out.value.srt=out.value.srt.replace('00:00:05,000','00:00:06,000');return out;};
  const y=await setupA2A(t,{sellerModel:badSrt}),second=y.run();
  const failure=await a.requestAgent(y.buyer.url,'main-to-buyer',{type:'start',runId:second.id},second.id);
  assert.equal(failure.value.state,'paid_delivery_failed');assert.equal(failure.value.stage,'seller.delivery.structure');assert.equal(failure.value.errorCode,'SRT_INVALID');assert.match(failure.value.error,/timing/i);
});

test('unresolved PSP result is payment_unknown, with operation reference and no fabricated receipt',async t=>{
  const testPSP={mode:'fixture',merchantAccountId:'test',async create(){throw new Error('response lost');},async findByOrder(){return [];}};
  const x=await setupA2A(t,{testPSP}),run=x.run();
  const result=await a.requestAgent(x.buyer.url,'main-to-buyer',{type:'start',runId:run.id},run.id);
  assert.equal(result.value.state,'payment_unknown');assert.equal(result.value.stage,'seller.payment');assert.ok(result.value.payment.operationId);assert.equal(result.value.receipt,undefined);
});
