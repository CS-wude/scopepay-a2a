import express from 'express';
import {randomBytes} from 'node:crypto';
import {defaultProject,validatePolicies} from './domain.mjs';
import {mountGateway} from './gateway.mjs';
import {validateSrt} from './subtitles.mjs';
import {SOURCE_SRT,CASES} from './fixtures.mjs';
import {mountV2} from './v2.mjs';
import {mountMarketplace} from './marketplace.mjs';
import {requestOrigin} from './network.mjs';

export function createApp({store,payments,identities,tokens,driver,metadata,turn,modelEnv,allowedAddresses=['127.0.0.1']}){
  const app=express(),csrf=randomBytes(32).toString('hex'),active=new Set();
  app.disable('x-powered-by');
  if(!store.projectList().length)store.createProject(defaultProject());
  // A restart never silently restarts a sale or an agent loop.
  for(const run of store.runList()){
    const op=store.paymentForRun(run.id),pending=['reserved','unknown'].includes(op?.state);
    if(pending||['requested','running','paid'].includes(run.state))store.patchRun(run.id,{state:pending?'payment_unknown':op?.receipt?'paid_delivery_failed':'interrupted',error:'Process restarted. Review the recorded operation; no automatic payment retry.'});
  }
  app.use((req,res,next)=>{
    const origin=requestOrigin(req.headers.host,req.socket.localPort,allowedAddresses);
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
    if(!origin||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==origin))return res.status(403).json({error:'Local origin required'});
    if(req.method==='POST'&&!req.path.startsWith('/internal/')){
      if(req.headers.origin!==origin||req.headers['x-csrf-token']!==csrf)return res.status(403).json({error:'Refresh the local page to authorize this request'});
      if(!req.is('application/json'))return res.status(415).json({error:'JSON required'});
    }
    next();
  });
  app.use(express.json({limit:'64kb',strict:true}));
  const marketplace=mountMarketplace(app,{store,modelEnv,csrf});
  const v2=turn?mountV2(app,{store,payments,identities,turn,modelEnv,marketplace}):null;
  mountGateway(app,{store,payments,identities,tokens,v2});
  const publicRun=run=>({...run,payment:store.paymentForRun(run.id)?{operationId:store.paymentForRun(run.id).id,state:store.paymentForRun(run.id).state,amountMinor:store.paymentForRun(run.id).amountMinor}:null});
  app.get('/api/state',(_req,res)=>res.json({app:'ScopePay A2A',csrf,...metadata,paused:store.getSetting('paused',false),project:store.projectList()[0],policies:{buyer:store.getPolicy('buyer'),seller:store.getPolicy('seller')},budgetUsed:store.budgetUsed(),runs:store.runList().map(publicRun),sourceSrt:SOURCE_SRT}));
  app.post('/api/pause',(req,res)=>{
    if(typeof req.body.paused!=='boolean'||Object.keys(req.body).length!==1)return res.status(400).json({error:'Invalid pause request'});
    store.setSetting('paused',req.body.paused);res.json({paused:req.body.paused});
  });
  app.post('/api/policies',(req,res)=>{
    try{
      if(active.size)throw new Error('An agent run is active');
      const old=store.getPolicy('buyer'),body=req.body;
      if(Object.keys(body).sort().join(',')!=='allowStandard,requireFrench,singleCapMinor,totalCapMinor'||typeof body.requireFrench!=='boolean')return res.status(400).json({error:'Invalid owner policy fields'});
      const policies={buyer:{...old,version:old.version+1,singleCapMinor:body.singleCapMinor,totalCapMinor:body.totalCapMinor,required:body.requireFrench?['french_subtitles']:[],allowStandard:body.allowStandard},seller:store.getPolicy('seller')};
      validatePolicies(policies);if(body.totalCapMinor<store.budgetUsed())throw new Error('Total budget below reserved or spent amount');store.setPolicies(policies);res.json({ok:true});
    }catch{res.status(409).json({error:'Policy update blocked: check caps, active runs and unresolved payments'});}
  });
  app.post('/api/project',(_req,res)=>{
    try{if(active.size)throw new Error('Run active');for(const p of store.projectList())store.resetProject(p.id);res.json(store.createProject(defaultProject()));}
    catch{res.status(409).json({error:'An active run or unresolved payment prevents a new project'});}
  });
  app.post('/api/runs',(req,res)=>{
    const {requestId,caseId}=req.body??{};
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)||!Object.hasOwn(CASES,caseId)||Object.keys(req.body).length!==2)return res.status(400).json({error:'Invalid run request'});
    const prior=store.getSetting(`request:${requestId}`,null);if(prior)return res.json(publicRun(store.getRun(prior)));
    const project=store.projectList()[0];
    if(active.size||store.runList().some(r=>r.projectId===project.id))return res.status(409).json({error:'This project already has a run. Review it or create a new project.'});
    if(store.getSetting('paused',false))return res.status(409).json({error:'New transactions paused'});
    const run=store.createRun(project.id,{caseId,requestedSelection:CASES[caseId].selection,modelMode:metadata.modelMode,paymentMode:metadata.paymentMode});
    store.setSetting(`request:${requestId}`,run.id);active.add(run.id);store.patchRun(run.id,{state:'running'});
    Promise.resolve().then(()=>driver(run)).then(result=>{
      const op=store.paymentForRun(run.id),value={...result.value};
      if(['reserved','unknown'].includes(op?.state))value.state='payment_unknown';
      if(op?.receipt){value.receipt=op.receipt;if(value.state==='failed')value.state='paid_delivery_failed';}
      store.patchRun(run.id,{...value,a2aTaskId:result.taskId,a2aContextId:result.contextId,artifacts:result.artifacts,finishedAt:new Date().toISOString()});
    }).catch(()=>{const op=store.paymentForRun(run.id);store.patchRun(run.id,{state:op?.receipt?'paid_delivery_failed':op?'payment_unknown':'failed',error:'Agent run interrupted. Review recorded events and original payment; no automatic recharge.'});}).finally(()=>active.delete(run.id));
    res.status(202).json(publicRun(store.getRun(run.id)));
  });
  app.post('/api/runs/:id/recover',async(req,res)=>{
    try{
      if(active.has(req.params.id))throw new Error('Active run');const op=store.paymentForRun(req.params.id);if(!op)throw new Error('No recorded payment');
      const receipt=await payments.recover(op.id);const run=store.getRun(req.params.id);store.patchRun(run.id,{receipt,state:run.state==='accepted'?'accepted':'paid_delivery_failed',error:run.state==='accepted'?null:'Payment verified; delivery still needs review. No additional sale performed.'});res.json({receipt});
    }catch{res.status(409).json({error:'Original payment is not uniquely verified. Budget remains reserved; no new sale was sent.'});}
  });
  app.get('/api/runs/:id/subtitle',(req,res)=>{
    const run=store.getRun(req.params.id),op=store.paymentForRun(req.params.id);
    if(run?.state!=='accepted'||!op?.receipt?.verified||!run.review?.value?.accepted||!run.srt)return res.status(404).json({error:'No accepted subtitle artifact'});
    try{validateSrt(SOURCE_SRT,run.srt);}catch{return res.status(404).json({error:'Invalid subtitle artifact'});}
    res.set({'Content-Type':'application/x-subrip; charset=utf-8','Content-Disposition':'attachment; filename="aurora.fr.srt"'}).send(run.srt);
  });
  const root=new URL('./public/',import.meta.url);
  for(const [path,name,type]of [['/market','market.html','text/html'],['/market.js','market.js','text/javascript'],['/contracts.js','contracts.js','text/javascript'],['/request-id.mjs','request-id.mjs','text/javascript'],['/conversation-timeline.mjs','conversation-timeline.mjs','text/javascript'],['/market.css','market.css','text/css']])app.get(path,(_req,res)=>res.type(type).sendFile(new URL(name,root).pathname));
  for(const [path,name,type]of [['/','index.html','text/html'],['/app.js','app.js','text/javascript'],['/style.css','style.css','text/css'],['/negotiate','v2.html','text/html'],['/v2.js','v2.js','text/javascript'],['/v2.css','v2.css','text/css']])app.get(path,(_req,res)=>res.type(type).sendFile(new URL(name,root).pathname));
  app.use((_req,res)=>res.status(404).json({error:'Not found'}));
  app.use((error,_req,res,_next)=>res.status(error.type==='entity.too.large'?413:400).json({error:error.type==='entity.too.large'?'Request too large':'Invalid request'}));
  return app;
}
