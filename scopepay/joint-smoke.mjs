import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {startCluster} from './start.mjs';
import {BraintreePSP} from './payment.mjs';
import {validateSrt} from './subtitles.mjs';

// Explicit invocation only. Uses virtual Sandbox funds and a persistent operation.
// Resume with the SAME root after an interruption; do not delete its payment data.
const root = resolve(process.env.SCOPEPAY_JOINT_ROOT ?? '.evidence/joint-live-sandbox');
mkdirSync(root, {recursive:true, mode:0o700});
const report = {scope:'Live language model, signed contract-change A2A and Braintree Sandbox in one workspace', checks:{}, passed:false};
const hash = value => createHash('sha256').update(String(value)).digest('hex');
let cluster;
try {
  assert.equal(process.env.BRAINTREE_ENVIRONMENT?.toLowerCase() ?? 'sandbox', 'sandbox');
  const psp = new BraintreePSP(process.env);
  let createCalls = 0;
  const create = psp.create.bind(psp);
  psp.create = async op => {createCalls++; return create(op);};
  cluster = await startCluster({root:join(root,'workspace'), port:0, buyerPort:0, sellerPort:0,
    host:'127.0.0.1', modelMode:'live', paymentMode:'sandbox', env:process.env, psp});
  const get = async path => {
    const response = await fetch(cluster.url+path);
    assert.ok(response.ok, 'Workspace query failed');
    return response.json();
  };
  const csrf = (await get('/api/market/bootstrap')).csrf;
  const request = async (path, body) => {
    const response = await fetch(cluster.url+path, {method:'POST', headers:{Origin:cluster.url,
      'Content-Type':'application/json','X-CSRF-Token':csrf}, body:JSON.stringify(body)});
    return {status:response.status, value:await response.json()};
  };
  const post = async (path, body) => {
    const result = await request(path,body);
    assert.ok(result.status>=200 && result.status<300, result.value.error ?? 'Workspace operation failed');
    return result.value;
  };
  const workspace = () => get('/api/market/workspace?role=buyer');
  let sessions = (await workspace()).sessions;
  assert.ok(sessions.length<=1, 'Use an isolated root, with at most one session');
  let id = sessions[0]?.id;
  if (!id) {
    await post('/api/market/buyer/delegation',{capMinor:1000,totalCapMinor:2000,autoPay:false});
    for (const role of ['buyer','seller']) await post('/api/market/interaction',{role,mode:'auto'});
    const template = await get('/api/market/contracts/template');
    const contract = await post('/api/market/contracts',{role:'buyer',contract:template});
    await post(`/api/market/contracts/${contract.id}/confirm`,{role:'seller',version:contract.version});
    id = (await post('/api/v2/sessions',{workflow:'dual_mode',requestId:'joint-live-sandbox-contract-change',
      text:'Make the background bluer and add French subtitles. Tonight is preferred, but standard delivery is acceptable.',
      contract:{id:contract.id,version:contract.version},authorization:{capMinor:1000,allowPaidColor:false}})).id;
  }
  const session = async () => (await workspace()).sessions.find(item=>item.id===id);
  let s;
  for (let attempt=0;attempt<1200;attempt++) {
    s = await session();
    if (s && !['ready','negotiating'].includes(s.state)) break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  report.negotiationState = s?.state;
  assert.equal(s.discussionResult?.status,'agreed','No complete agreement; no payment will be created');
  assert.equal(s.discussionResult.terms.amountMinor,1000);
  assert.equal(s.discussionResult.terms.optionId,'change_standard');
  assert.ok(s.contractChange.obligations.some(item=>item.code==='included_color' && item.amountMinor===0));
  report.checks.requiredScopeAndAuthorizedPackage = true;
  if (!s.payment) {
    if (!s.discussionResult.approvals.buyer && !s.discussionResult.approvals.seller) {
      assert.equal((await request(`/api/v2/sessions/${id}/pay`,{})).status,409);
      assert.equal(createCalls,0);
      report.checks.paymentBeforeOwnerApprovalBlocked = true;
    }
    for (const role of ['buyer','seller']) if (!s.discussionResult.approvals[role]) {
      await post(`/api/v2/sessions/${id}/decision`,{role,action:'approve',
        revision:s.discussionResult.revision,hash:s.discussionResult.hash});
    }
  }
  // An unknown result is queried through the same persisted operation, never a new sale.
  const paymentAttempt = await request(`/api/v2/sessions/${id}/pay`,{});
  s = await session();
  if (paymentAttempt.status!==200 && s.payment?.state==='unknown') {
    await post(`/api/v2/sessions/${id}/pay`,{});
    s = await session();
  }
  assert.equal(s.payment?.state,'verified','Sandbox payment unresolved; keep this root for recovery');
  const originalTransaction = s.payment.transactionId;
  await post(`/api/v2/sessions/${id}/pay`,{});
  s = await session();
  assert.equal(s.payment.transactionId,originalTransaction);
  assert.ok(createCalls<=1,'Duplicate create call');
  const matches = await psp.findByOrder(s.payment.id);
  assert.equal(matches.length,1);
  const transaction = await psp.query(originalTransaction);
  assert.equal(transaction.id,matches[0].id);
  assert.equal(transaction.orderId,s.payment.id);
  assert.equal(transaction.amountMinor,1000);
  assert.equal(transaction.currency,'USD');
  assert.equal(transaction.merchantAccountId,psp.merchantAccountId);
  report.checks.providerAmountCurrencyMerchantOrder = true;
  report.checks.repeatedPaymentReturnsSameTransaction = true;
  report.transaction = {provider:'Braintree Sandbox',amountMinor:1000,currency:'USD',status:transaction.status,
    settled:transaction.status==='settled',transactionFingerprint:hash(transaction.id),orderFingerprint:hash(transaction.orderId),
    transactionsForOrder:matches.length,createCallsThisInvocation:createCalls};
  if (!s.delivery?.review?.accepted) await post(`/api/v2/sessions/${id}/deliver`,{});
  s = await session();
  validateSrt(s.sourceSrt,s.delivery.srt);
  assert.equal(s.delivery.review.accepted,true);
  assert.equal(s.state,'partially_delivered');
  assert.equal((await workspace()).budgetUsed,1000);
  const raw = cluster.store.getSetting('v2:'+id);
  report.modelCalls = raw.calls;
  report.a2aTasks = raw.a2aTasks.length;
  report.negotiationActions = raw.discussion.map(item=>({actor:item.payload.actor,action:item.payload.action,
    amountMinor:item.payload.terms?.amountMinor ?? null}));
  report.finalState = s.state;
  report.checks.subtitleStructureAndModelReview = true;
  report.checks.singleBudgetConsumption = true;
  report.checks.actualColorVideoNotClaimed = true;
  report.passed = true;
} catch (error) {
  // Avoid provider response bodies, credentials or account identifiers in console output.
  report.error = /Model|Sandbox|payment|agreement|scope|assert|equal|Workspace/i.test(error.message)
    ? error.message.slice(0,260) : 'Joint verification failed; inspect private evidence locally';
  process.exitCode = 1;
} finally {
  await cluster?.close();
  writeFileSync(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report,null,2));
}
