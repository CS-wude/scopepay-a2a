import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../scopepay/store.mjs';
import {FixturePSP,PaymentService} from '../scopepay/payment.mjs';
import {createIdentity} from '../scopepay/identity.mjs';
import {defaultProject,makeQuote,makeAcceptance} from '../scopepay/domain.mjs';
import http from 'node:http';
const module=await import('../scopepay/app.mjs').catch(()=>({}));
async function setup(t,driver,seed){
  assert.equal(typeof module.createApp,'function','local observer application required');
  const store=new Store(join(mkdtempSync(join(tmpdir(),'scopepay-app-')),'db.sqlite'));t.after(()=>store.close());
  const identities={buyer:createIdentity('buyer'),seller:createIdentity('seller')},psp=new FixturePSP();
  seed?.(store,identities);
  const app=module.createApp({store,payments:new PaymentService({store,psp,identities}),identities,tokens:{buyer:'private-buyer-token',seller:'private-seller-token'},driver:driver??(async()=>({value:{state:'rejected',reason:'test case',modelMode:'fixture'},artifacts:[]})),metadata:{modelMode:'fixture',paymentMode:'fixture',agents:[]}});
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const state=await (await fetch(url+'/api/state')).json();
  const post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-CSRF-Token':state.csrf,...headers},body:JSON.stringify(body)});
  return {store,url,state,post};
}
test('observer redacts private identity and tokens; enforces Host, origin, CSRF and body limits',async t=>{
  const x=await setup(t);const json=JSON.stringify(x.state);
  assert.equal(json.includes('PRIVATE KEY'),false);assert.equal(json.includes('private-buyer-token'),false);
  const wrongHost=await new Promise((resolve,reject)=>{http.get(x.url+'/api/state',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
  assert.equal(wrongHost,403);
  assert.equal((await x.post('/api/pause',{paused:true},{Origin:'https://evil.example'})).status,403);
  assert.equal((await x.post('/api/pause',{paused:true},{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await x.post('/api/pause',{paused:true,padding:'x'.repeat(80000)})).status,413);
  assert.equal((await fetch(x.url+'/.env')).status,404);
});
test('start is idempotent, state persists, one project runs once, and unverified files never download',async t=>{
  let calls=0,release;const wait=new Promise(r=>{release=r;});
  const x=await setup(t,async()=>{calls++;await wait;return {value:{state:'rejected',reason:'<script>alert(1)</script>',modelMode:'fixture'},artifacts:[]};});
  const body={requestId:'same-request-id',caseId:'standard'};
  const first=await (await x.post('/api/runs',body)).json(),second=await (await x.post('/api/runs',body)).json();
  assert.equal(first.id,second.id);assert.equal(calls,1);
  assert.equal((await x.post('/api/project',{})).status,409);
  assert.equal((await x.post('/api/runs',{requestId:'another-request',caseId:'standard'})).status,409);
  release();await new Promise(r=>setTimeout(r,10));
  assert.equal((await (await fetch(x.url+'/api/state')).json()).runs[0].state,'rejected');
  assert.equal((await fetch(`${x.url}/api/runs/${first.id}/subtitle`)).status,404);
  assert.equal(x.store.getRun(first.id).reason,'<script>alert(1)</script>');
  const html=await (await fetch(x.url+'/')).text();assert.match(html,/app.js/);
});

test('restart keeps an unresolved payment visibly payment_unknown rather than interrupted',async t=>{
  let runId;
  const x=await setup(t,undefined,(store,identities)=>{
    const project=store.createProject(defaultProject()),run=store.createRun(project.id,{caseId:'standard'});runId=run.id;
    const quote=makeQuote({project,changeId:run.id,selection:{color:true,french:true,rush:false},buyerId:'buyer',sellerPolicy:store.getPolicy('seller')},identities.seller);
    const acceptance=makeAcceptance(quote,store.getPolicy('buyer'),identities.buyer);
    const op=store.reservePayment({quote:quote.payload,acceptance:acceptance.payload,runId:run.id}).operation;
    store.markPayment(op.id,'unknown');store.patchRun(run.id,{state:'running'});
  });
  assert.equal(x.state.runs.find(r=>r.id===runId).state,'payment_unknown');
  assert.equal((await x.post('/api/project',{})).status,409);
});
