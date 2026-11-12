import braintree from 'braintree';
import {randomUUID} from 'node:crypto';
import {verifyDocument,digest,canonical} from './identity.mjs';
import {validateQuote,validateBuyerPolicy,validateTaskSelection} from './domain.mjs';
import {CASES} from './fixtures.mjs';
import {sandboxConfig} from '../braintree.mjs';

export class FixturePSP {
  constructor(){this.mode='fixture';this.merchantAccountId='test';this.transactions=new Map();}
  async create(op){const t={id:`fixture-${randomUUID()}`,type:'sale',orderId:op.id,amountMinor:op.amountMinor,currency:'USD',merchantAccountId:this.merchantAccountId,status:'submitted_for_settlement'};this.transactions.set(op.id,t);return t;}
  async findByOrder(id){return this.transactions.has(id)?[this.transactions.get(id)]:[];}
  async query(id){return [...this.transactions.values()].find(x=>x.id===id);}
}
export class BraintreePSP {
  constructor(env){
    const c=sandboxConfig(env);if(!c.configured)throw new Error('Braintree Sandbox configuration missing');
    this.mode='sandbox';this.merchantAccountId=c.merchantAccountId;
    this.gateway=new braintree.BraintreeGateway({environment:braintree.Environment.Sandbox,merchantId:c.merchantId,publicKey:c.publicKey,privateKey:c.privateKey});
  }
  normalize(t){return {id:t.id,type:t.type,orderId:t.orderId,amountMinor:/^\d+\.\d{2}$/.test(t.amount)?Number(t.amount.replace('.','')):NaN,currency:t.currencyIsoCode,merchantAccountId:t.merchantAccountId,status:t.status};}
  async create(op){
    try{
      const a=await this.gateway.merchantAccount.find(this.merchantAccountId);
      if(a.id!==this.merchantAccountId||a.status!=='active'||a.currencyIsoCode!=='USD')throw new Error('Unavailable account');
    }catch{const e=new Error('Sandbox preflight failed before sale');e.definitiveFailure=true;throw e;}
    const result=await this.gateway.transaction.sale({amount:(op.amountMinor/100).toFixed(2),orderId:op.id,merchantAccountId:this.merchantAccountId,paymentMethodNonce:'fake-valid-nonce',options:{submitForSettlement:true}});
    if(!result.success){const e=new Error('Sandbox processor rejected transaction');e.definitiveFailure=true;throw e;}
    return this.normalize(result.transaction);
  }
  async query(id){return this.normalize(await this.gateway.transaction.find(id));}
  async findByOrder(id){
    const result=await new Promise((resolve,reject)=>this.gateway.transaction.search(s=>s.orderId().is(id),(e,r)=>e?reject(e):resolve(r)));
    if(result.ids.length>2)throw new Error('Ambiguous payment search');
    return Promise.all(result.ids.map(x=>this.query(x)));
  }
}
export class PaymentService {
  constructor({store,psp,identities}){this.store=store;this.psp=psp;this.identities=identities;this.inflight=new Map();}
  authenticate({quote,acceptance}){
    const q=verifyDocument(quote,this.identities.seller.publicKey),a=verifyDocument(acceptance,this.identities.buyer.publicKey);
    if(q.buyerId!=='buyer'||q.sellerId!=='seller'||a.type!=='quote_acceptance'||a.schemaVersion!==1||a.buyerId!=='buyer'||a.sellerId!=='seller'||a.quoteHash!==digest(q)||a.changeId!==q.changeId||a.projectId!==q.projectId||a.baseVersion!==q.baseVersion)throw new Error('Acceptance binding mismatch');
    return {q,a};
  }
  async execute(input){
    const {q,a}=this.authenticate(input),key=digest(q);
    if(this.inflight.has(key))return this.inflight.get(key);
    const job=this.perform(input,q,a);this.inflight.set(key,job);
    try{return await job;}finally{this.inflight.delete(key);}
  }
  async perform(input,q,a){
    const existing=this.store.paymentForChange(q.changeId);
    if(existing){if(existing.quoteHash!==digest(q))throw new Error('Different quote already bound to payment');if(existing.state==='verified')return existing.receipt;return this.recover(existing.id);}
    if(this.store.getSetting('paused',false))throw new Error('New transactions paused');
    validateQuote(q,{project:this.store.getProject(q.projectId),sellerPolicy:this.store.getPolicy('seller')});
    const latest=this.store.latestQuote(q.changeId);if(!latest||latest.hash!==digest(q))throw new Error('Quote superseded or unregistered');
    const policy=this.store.getPolicy('buyer');
    const run=this.store.getRun(input.runId);
    if(!run||run.projectId!==q.projectId||run.id!==q.changeId)throw new Error('Payment run binding mismatch');
    validateTaskSelection(q.selection,run.requestedSelection??CASES[run.caseId]?.selection,policy);
    // Re-evaluate policy from owner storage; a message cannot raise its own budget.
    validateBuyerPolicy(q,policy);
    if(a.policyVersion!==policy.version)throw new Error('Buyer policy version mismatch');
    const reserved=this.store.reservePayment({quote:q,acceptance:a,runId:input.runId});
    if(!reserved.created)return this.recover(reserved.operation.id);
    const op=reserved.operation;
    if(op.amountMinor===0)return this.finish(op,{id:`included-${op.id}`,orderId:op.id,amountMinor:0,currency:'USD',merchantAccountId:this.psp.merchantAccountId,status:'included'});
    try{
      const created=await this.psp.create(op);
      const submitted=this.store.markPayment(op.id,'reserved',{transactionId:created.id});
      const queried=this.psp.query?await this.psp.query(created.id):created;
      return this.finish(submitted,queried);
    }catch(e){
      if(e.definitiveFailure){this.store.markPayment(op.id,'failed');throw new Error('Payment failed; budget released');}
      this.store.markPayment(op.id,'unknown');throw new Error('Payment unknown; check original operation before retry');
    }
  }
  finish(op,t){
    if(!t?.id||(op.transactionId&&t.id!==op.transactionId)||(op.amountMinor>0&&t.type!=='sale')||t.orderId!==op.id||t.amountMinor!==op.amountMinor||t.currency!=='USD'||t.merchantAccountId!==this.psp.merchantAccountId||
      !['submitted_for_settlement','settling','settled','settlement_pending','settlement_confirmed','included'].includes(t.status)||
      (t.status==='included'&&op.amountMinor!==0))throw new Error('Payment result verification failed');
    const receipt={operationId:op.id,transactionId:t.id,changeId:op.changeId,projectId:op.projectId,quoteHash:op.quoteHash,
      amountMinor:op.amountMinor,currency:'USD',status:t.status,settled:t.status==='settled',provider:this.psp.mode==='sandbox'?'Braintree Sandbox':'Fixture PSP',verified:true};
    return this.store.commitChange(op.id,receipt);
  }
  async recover(id){
    const op=this.store.paymentById(id);if(!op)throw new Error('Payment operation not found');
    if(op.state==='verified')return op.receipt;
    if(op.state==='failed')throw new Error('Payment definitively failed; original change cannot be charged again');
    try{const matches=await this.psp.findByOrder(op.id);if(matches.length===1)return this.finish(op,matches[0]);}
    catch{ /* Retain unresolved authorization and budget until one result is verified. */ }
    const latest=this.store.markPayment(op.id,'unknown');if(latest.state==='verified')return latest.receipt;
    throw new Error('Payment unknown; no unique verified transaction found');
  }
}
