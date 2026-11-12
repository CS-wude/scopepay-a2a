import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaultProject,defaultPolicies,makeQuote,makeAcceptance} from '../scopepay/domain.mjs';
import {createIdentity} from '../scopepay/identity.mjs';
const persistence=await import('../scopepay/store.mjs').catch(()=>({}));
const payment=await import('../scopepay/payment.mjs').catch(()=>({}));

function setup(t,psp) {
  assert.equal(typeof persistence.Store,'function','persistent payment store is required');
  const store=new persistence.Store(join(mkdtempSync(join(tmpdir(),'scopepay-test-')),'db.sqlite'));
  t.after(()=>store.close());
  const identities={buyer:createIdentity('buyer'),seller:createIdentity('seller')};
  const policies=defaultPolicies(); store.setPolicies(policies);
  const project=defaultProject(); store.createProject(project);
  const service=new payment.PaymentService({store,psp:psp??new payment.FixturePSP(),identities});
  const runs=new Map();
  const offer=(id,options={})=> {
    if(!runs.has(id))runs.set(id,store.createRun((options.project??project).id,{caseId:options.caseId??(options.selection?.french===false?'included':'standard')}));
    const run=runs.get(id);
    const q=makeQuote({project:options.project??project,changeId:run.id,selection:options.selection??{color:true,french:true,rush:false},buyerId:'buyer',sellerPolicy:policies.seller,quoteVersion:options.version??1},identities.seller);
    store.registerQuote(q); return {quote:q,acceptance:makeAcceptance(q,options.buyer??policies.buyer,identities.buyer),runId:run.id};
  };
  return {store,service,offer,policies,identities,project};
}

test('payment binds signed quote, charges once, commits scope once and persists across reload',async t=> {
  const x=setup(t), offer=x.offer('change-one');
  const first=await x.service.execute(offer), repeat=await x.service.execute(offer);
  assert.equal(first.transactionId,repeat.transactionId);
  assert.equal(first.amountMinor,1000); assert.equal(first.settled,false);
  assert.equal(x.store.getProject(x.project.id).version,2);
  assert.equal(x.store.paymentCount(),1); assert.equal(x.store.budgetUsed(),1000);
  const reopened=new persistence.Store(x.store.file); t.after(()=>reopened.close());
  assert.equal(reopened.getProject(x.project.id).scope.frenchIncluded,true);
  assert.equal(reopened.paymentCount(),1);
});

test('unknown PSP result retains budget and lock; recover finds original charge without sale again',async t=> {
  let sales=0; const transactions=new Map();
  const psp={mode:'fixture',async create(op){sales++;transactions.set(op.id,{id:'tx-lost',type:'sale',orderId:op.id,amountMinor:op.amountMinor,currency:'USD',merchantAccountId:'test',status:'submitted_for_settlement'});throw new Error('lost response');},async findByOrder(id){return [...transactions.values()].filter(v=>v.orderId===id);},merchantAccountId:'test'};
  const x=setup(t,psp), offer=x.offer('lost');
  await assert.rejects(x.service.execute(offer),/unknown/i);
  assert.equal(x.store.budgetUsed(),1000);
  assert.throws(()=>x.store.resetProject(x.project.id),/pending/i);
  const receipt=await x.service.execute(offer);
  assert.equal(receipt.transactionId,'tx-lost'); assert.equal(sales,1);
  assert.equal(x.store.getProject(x.project.id).version,2);
});

test('zero included change never calls PSP; incorrect currency never applies scope',async t=> {
  const x=setup(t,{mode:'fixture',merchantAccountId:'test',async create(){throw new Error('must not charge');}});
  const policies=defaultPolicies();policies.buyer.required=[];x.store.setPolicies(policies);
  const receipt=await x.service.execute(x.offer('free',{selection:{color:true,french:false,rush:false},buyer:policies.buyer}));
  assert.equal(receipt.amountMinor,0);assert.equal(receipt.status,'included');
  const y=setup(t,{mode:'fixture',merchantAccountId:'test',async create(op){return {id:'bad',type:'sale',orderId:op.id,amountMinor:1000,currency:'EUR',merchantAccountId:'test',status:'submitted_for_settlement'};},async findByOrder(){return [];}});
  await assert.rejects(y.service.execute(y.offer('bad-currency')),/unknown/i);
  assert.equal(y.store.getProject(y.project.id).version,1);
});

test('parallel original versions cannot both commit; cumulative budget and newer quotes are enforced',async t=> {
  let release;const gate=new Promise(r=>{release=r;});
  const psp={mode:'fixture',merchantAccountId:'test',async create(op){await gate;return {id:'tx',type:'sale',orderId:op.id,amountMinor:op.amountMinor,currency:'USD',merchantAccountId:'test',status:'submitted_for_settlement'};}};
  const x=setup(t,psp), a=x.offer('a'),b=x.offer('b');
  const p=x.service.execute(a);
  await assert.rejects(x.service.execute(b),/locked/i); release();await p;
  await assert.rejects(x.service.execute(b),/Stale|version/i);
  const y=setup(t); const low=defaultPolicies();low.buyer.singleCapMinor=500;y.store.setPolicies(low);
  await assert.rejects(y.service.execute(y.offer('budget')),/budget/i);
  assert.equal(y.store.paymentCount(),0);
  const z=setup(t),old=z.offer('versioned');z.offer('versioned',{version:2});
  await assert.rejects(z.service.execute(old),/superseded/i);
  const tampered={...old.quote,payload:{...old.quote.payload,amountMinor:1}};
  await assert.rejects(z.service.execute({...old,quote:tampered}),/signature/i);
});

test('cumulative owner budget spans projects and payment verifier needs only public identities',async t=>{
  const x=setup(t);const policies=defaultPolicies();policies.buyer.totalCapMinor=1000;x.store.setPolicies(policies);
  const publicIdentities=Object.fromEntries(Object.entries(x.identities).map(([role,i])=>[role,{id:i.id,publicKey:i.publicKey}]));
  const service=new payment.PaymentService({store:x.store,psp:new payment.FixturePSP(),identities:publicIdentities});
  await service.execute(x.offer('first'));
  const project=defaultProject();x.store.createProject(project);
  await assert.rejects(service.execute(x.offer('second',{project})),/budget/i);
  assert.equal(x.store.paymentCount(),1);
});

test('payment verifier rejects added or dropped task scope even with valid owner signatures and budget',async t=>{
  const x=setup(t);const policy=defaultPolicies();policy.buyer.required=[];x.store.setPolicies(policy);
  await assert.rejects(x.service.execute(x.offer('added',{caseId:'included',buyer:policy.buyer})),/scope/i);
  await assert.rejects(x.service.execute(x.offer('dropped',{selection:{color:false,french:true,rush:false}})),/scope/i);
  assert.equal(x.store.paymentCount(),0);
});

test('late recovery failure cannot regress verified state across service instances; failed unlock is atomic',async t=>{
  const tx={id:'recovered',type:'sale',amountMinor:1000,currency:'USD',merchantAccountId:'test',status:'submitted_for_settlement'};
  const psp={mode:'fixture',merchantAccountId:'test',async create(op){tx.orderId=op.id;throw new Error('response lost');},async findByOrder(){return [tx];}};
  const x=setup(t,psp),offer=x.offer('race');await assert.rejects(x.service.execute(offer),/unknown/i);
  const op=x.store.paymentForChange(offer.quote.payload.changeId);let slowDone;const slowGate=new Promise(r=>{slowDone=r;});
  const slow=new payment.PaymentService({store:x.store,psp:{...psp,async findByOrder(){await slowGate;return [];}},identities:x.identities});
  const late=slow.recover(op.id);const receipt=await x.service.recover(op.id);slowDone();
  assert.deepEqual(await late,receipt);assert.equal(x.store.paymentById(op.id).state,'verified');assert.equal(x.store.getProject(x.project.id).version,2);
});

test('failed payment state and project unlock roll back together',async t=>{
  const y=setup(t),input=y.offer('atomic');const reserved=y.store.reservePayment({quote:input.quote.payload,acceptance:input.acceptance.payload,runId:input.runId}).operation;
  y.store.db.exec("CREATE TRIGGER simulate_unlock_failure BEFORE UPDATE OF locked ON projects WHEN NEW.locked IS NULL BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  assert.throws(()=>y.store.markPayment(reserved.id,'failed'),/simulated/);
  assert.equal(y.store.paymentById(reserved.id).state,'reserved');
});

test('sandbox preflight failures before sale release reservations and preserve failure evidence',async t=>{
  for(const account of [{id:'test',status:'suspended',currencyIsoCode:'USD'},{id:'test',status:'active',currencyIsoCode:'EUR'},null]){
    const psp=new payment.BraintreePSP({BRAINTREE_MERCHANT_ID:'test',BRAINTREE_PUBLIC_KEY:'test',BRAINTREE_PRIVATE_KEY:'test',BRAINTREE_MERCHANT_ACCOUNT_ID:'test'});let sales=0;
    psp.gateway={merchantAccount:{async find(){if(!account)throw new Error('preflight network failure');return account;}},transaction:{async sale(){sales++;}}};
    const x=setup(t,psp),offer=x.offer('preflight');
    await assert.rejects(x.service.execute(offer),/failed.*released/i);assert.equal(sales,0);assert.equal(x.store.budgetUsed(),0);assert.equal(x.store.resetProject(x.project.id),true);
    assert.equal(x.store.paymentForChange(offer.quote.payload.changeId).state,'failed');
  }
});

for(const mismatch of [{id:'other-id',type:'sale'},{id:'sale-id',type:'credit'}])test(`sale readback rejects ID/type mismatch ${mismatch.id}/${mismatch.type}`,async t=>{
    const base={id:'sale-id',type:'sale',amountMinor:1000,currency:'USD',merchantAccountId:'test',status:'submitted_for_settlement'};
    const psp={mode:'sandbox',merchantAccountId:'test',async create(op){return {...base,orderId:op.id};},async query(){return {...base,...mismatch,orderId:this.orderId};},async findByOrder(){return [];}};
    const original=psp.create;psp.create=async op=>{psp.orderId=op.id;return original(op);};
    const x=setup(t,psp);await assert.rejects(x.service.execute(x.offer('bad-readback')),/unknown/i);assert.equal(x.store.getProject(x.project.id).version,1);
});

test('sandbox normalization retains type and rejects fractional cents',()=>{
  const normalizer=Object.create(payment.BraintreePSP.prototype);
  assert.equal(normalizer.normalize({id:'tx',type:'sale',amount:'10.00'}).type,'sale');
  assert.equal(Number.isNaN(normalizer.normalize({id:'tx',type:'sale',amount:'10.001'}).amountMinor),true);
});
