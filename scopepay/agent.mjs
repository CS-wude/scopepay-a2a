import {conversationTurn} from './market-conversation.mjs';
import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentCard,Message,Task,Role,TaskState,A2A_PROTOCOL_VERSION} from '@a2a-js/sdk';
import {DefaultRequestHandler,AgentEvent} from '@a2a-js/sdk/server';
import {agentCardHandler,jsonRpcHandler} from '@a2a-js/sdk/server/express';
import {ClientFactory} from '@a2a-js/sdk/client';
import {signDocument,verifyDocument,digest,canonical} from './identity.mjs';
import {makeQuote,makeAcceptance,validateQuote,validateBuyerPolicy,validateTaskSelection} from './domain.mjs';
import {CASES,SOURCE_SRT} from './fixtures.mjs';
import {validateSrt} from './subtitles.mjs';
import {negotiationTurn,deliveryAction} from './v2-agent.mjs';

class AgentStore{
  constructor(file){mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);chmodSync(file,0o600);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,owner TEXT,doc TEXT); CREATE TABLE IF NOT EXISTS business(id TEXT PRIMARY KEY,doc TEXT);');}
  async save(task,context){this.db.prepare('INSERT OR REPLACE INTO tasks VALUES(?,?,?)').run(task.id,context.user.userName,JSON.stringify(Task.toJSON(task)));}
  async load(id,context){const r=this.db.prepare('SELECT doc FROM tasks WHERE id=? AND owner=?').get(id,context.user.userName);return r?Task.fromJSON(JSON.parse(r.doc)):undefined;}
  async list(params,context){let tasks=this.db.prepare('SELECT doc FROM tasks WHERE owner=? ORDER BY rowid DESC').all(context.user.userName).map(r=>Task.fromJSON(JSON.parse(r.doc)));if(params.contextId)tasks=tasks.filter(t=>t.contextId===params.contextId);if(params.status)tasks=tasks.filter(t=>t.status.state===params.status);const totalSize=tasks.length;return {tasks:tasks.slice(0,Math.min(params.pageSize||50,100)),totalSize,pageSize:Math.min(params.pageSize||50,100),nextPageToken:''};}
  get(id){const r=this.db.prepare('SELECT doc FROM business WHERE id=?').get(id);return r?JSON.parse(r.doc):null;}
  set(id,v){this.db.prepare('INSERT OR REPLACE INTO business VALUES(?,?)').run(id,JSON.stringify(v));return v;}
  close(){this.db.close();}
}
const dataPart=value=>({content:{$case:'data',value},mediaType:'application/json',filename:''});
const textPart=(value,filename,mediaType)=>({content:{$case:'text',value},filename,mediaType});
const message=(value,contextId,taskId='',role=Role.ROLE_AGENT)=>({messageId:randomUUID(),role,contextId,taskId,parts:[dataPart(value)],extensions:[],referenceTaskIds:[],metadata:{}});
const failure=(stage,errorCode,error)=>Object.assign(new Error(error),{stage,errorCode});
const peerFailure=(value,fallback)=>failure(value.stage??'seller.request',value.errorCode??'AGENT_TASK_FAILED',value.error??fallback);
function checkedSrt(source,target,stage){try{return validateSrt(source,target);}catch(e){throw failure(stage,'SRT_INVALID',e.message);}}
export async function requestAgent(url,token,value,contextId){
  const client=await new ClientFactory().createFromUrl(url);
  const task=await client.sendMessage({message:message(value,contextId,'',Role.ROLE_USER),configuration:{acceptedOutputModes:['application/json','application/x-subrip'],returnImmediately:false}},
    {signal:AbortSignal.timeout(240000),serviceParameters:{Authorization:`Bearer ${token}`}});
  const reply=task.status?.message??task;
  const result=reply.parts?.find(p=>p.content?.$case==='data')?.content.value;
  if(!result)throw new Error('Agent returned no structured result');
  return {value:result,artifacts:task.artifacts??[],taskId:task.id,contextId:task.contextId};
}
export async function startAgent(config){
  const {role,identity,peer,model,taskFile,paymentURL,internalToken,incomingToken,sellerURL,sellerToken}=config;
  if(!['buyer','seller'].includes(role)||identity.id!==role||peer.id===role||!incomingToken||!internalToken)throw new Error('Invalid agent identity configuration');
  const store=new AgentStore(taskFile),inflight=new Map();
  async function internal(action,runId,body={}){
    const response=await fetch(`${paymentURL}/internal/${action}`,{method:'POST',signal:AbortSignal.timeout(90000),headers:{Authorization:`Bearer ${internalToken}`,'Content-Type':'application/json'},body:JSON.stringify({runId,...body})});
    const value=await response.json();if(!response.ok)throw new Error(value.error??'Agent operation failed');return value;
  }
  const emit=(runId,event)=>internal('event',runId,{event:{...event,modelMode:model.mode}});
  const call=async(runId,action,input)=>{
    try{return await model.call(role,action,input,{consume:()=>internal('call',runId)});}
    catch(e){
      const schema=e.message.startsWith('Model output schema invalid'),limit=/Model call limit/i.test(e.message);
      throw failure(`${role}.${action}.model`,schema?'MODEL_SCHEMA':limit?'MODEL_LIMIT':'MODEL_PROVIDER',schema?'Model output schema invalid':limit?'Model call limit reached':'Model provider request failed (details redacted)');
    }
  };
  async function seller(input,context){
    const payload=verifyDocument(input,peer.publicKey),{runId}=payload;
    if(payload.buyerId!=='buyer'||payload.sellerId!=='seller'||runId!==context.contextId)throw new Error('Peer identity or context binding mismatch');
    const {project,policy,run}=await internal('context',runId);
    if(payload.type==='quote_request'){
      const key=`offer:${runId}:${digest(payload.selection)}`,cached=store.get(key);if(cached)return cached;
      const count=store.get(`round:${runId}`)??0;if(count>=3)throw new Error('Negotiation round limit reached');
      const decision=await call(runId,'offer',{project,request:CASES[run.caseId]?.request,selection:payload.selection,catalog:policy});
      if(canonical(decision.value.selection)!==canonical(payload.selection))throw new Error('Seller changed requested scope');
      const quote=makeQuote({project,changeId:runId,selection:decision.value.selection,buyerId:'buyer',sellerPolicy:policy,quoteVersion:count+1},identity);
      await internal('quote',runId,{quote});store.set(`round:${runId}`,count+1);
      await emit(runId,{type:'quote',quoteVersion:quote.payload.quoteVersion,amountMinor:quote.payload.amountMinor,selection:quote.payload.selection,quoteHash:digest(quote.payload),reason:decision.value.reason});
      return store.set(key,{state:'offered',quote,modelMode:model.mode});
    }
    if(payload.type==='accept'||payload.type==='repair'){
      const key=`${payload.type==='repair'?'repair':'delivery'}:${runId}`,cached=store.get(key);if(cached)return cached;
      const {quote,acceptance}=payload;
      if(quote.payload.changeId!==runId)throw new Error('Acceptance run binding mismatch');
      const previous=payload.type==='repair'?store.get(`delivery:${runId}`):null;
      if(payload.type==='repair'&&(!previous||previous.manifest.payload.quoteHash!==digest(quote.payload)))throw new Error('Repair requires original paid delivery');
      let receipt;try{({receipt}=await internal('pay',runId,{quote,acceptance}));}catch(e){throw failure('seller.payment',/unknown/i.test(e.message)?'PAYMENT_UNKNOWN':'PAYMENT_FAILED',e.message);}
      let srt=null;
      if(quote.payload.selection.french){
        const translation=await call(runId,'translate',{source:SOURCE_SRT,language:'French',...(previous?{previous:previous.srt,feedback:payload.feedback}: {})});srt=translation.value.srt;checkedSrt(SOURCE_SRT,srt,'seller.delivery.structure');
      }
      const revision={requestedColor:quote.payload.selection.color?'blue':null,delivery:quote.payload.selection.rush?'rush':'standard',note:'Scope amendment and subtitle delivery only. No video rendering performed.'};
      const manifest=signDocument({type:'delivery',deliveryVersion:previous?2:1,runId,quoteHash:digest(quote.payload),transactionId:receipt.transactionId,srtHash:digest(srt),revisionHash:digest(revision),modelMode:model.mode},identity.privateKey);
      await emit(runId,{type:'delivery',subtitleCues:srt?5:0,transactionId:receipt.transactionId,artifactHash:digest(srt)});
      const result=store.set(key,{state:'delivered',receipt,manifest,srt,revision,modelMode:model.mode});if(previous)store.set(`delivery:${runId}`,result);return result;
    }
    throw new Error('Unsupported seller operation');
  }
  async function buyer(input,context){
    const {runId}=input;if(input.type!=='start'||runId!==context.contextId)throw new Error('Start context binding mismatch');
    const cached=store.get(`result:${runId}`);if(cached)return cached;
    const {project,policy,catalog,run}=await internal('context',runId);
    const requested=run.requestedSelection??CASES[run.caseId]?.selection;
    let selection=requested;if(!selection)throw new Error('Unknown scenario');
    let quote,decision;
    for(let round=1;round<=3;round++){
      const request=signDocument({type:'quote_request',runId,buyerId:'buyer',sellerId:'seller',selection},identity.privateKey);
      const offer=await requestAgent(sellerURL,sellerToken,request,runId);
      await emit(runId,{type:'a2a',direction:'buyer → seller',operation:'quote_request',taskId:offer.taskId,contextId:offer.contextId,round});
      if(offer.value.state!=='offered')throw peerFailure(offer.value,'Seller offer failed');
      quote=offer.value.quote;const q=verifyDocument(quote,peer.publicKey);validateQuote(q,{project,sellerPolicy:catalog});
      if(q.buyerId!=='buyer'||q.sellerId!=='seller'||q.changeId!==runId||canonical(q.selection)!==canonical(selection))throw new Error('Seller quote binding mismatch');
      validateTaskSelection(q.selection,requested,policy);
      decision=await call(runId,'decide',{quote:q,policy});
      await emit(runId,{type:'decision',round,decision:decision.value.decision,reason:decision.value.reason});
      if(decision.value.decision==='reject')return store.set(`result:${runId}`,{state:'rejected',reason:decision.value.reason,modelMode:model.mode});
      if(decision.value.decision==='accept'){
        if(canonical(decision.value.selection)!==canonical(q.selection))throw new Error('Accepted selection changed');validateBuyerPolicy(q,policy);break;
      }
      selection=decision.value.selection;
      validateTaskSelection(selection,requested,policy);
      if((policy.required.includes('french_subtitles')&&!selection.french)||(!policy.allowStandard&&!selection.rush))throw new Error('Counteroffer removes required scope');
    }
    if(decision?.value.decision!=='accept')throw new Error('Negotiation round limit reached');
    const acceptance=makeAcceptance(quote,policy,identity);
    await emit(runId,{type:'authorization',quoteHash:digest(quote.payload),policyVersion:policy.version,amountMinor:quote.payload.amountMinor});
    const delivered=await requestAgent(sellerURL,sellerToken,signDocument({type:'accept',runId,buyerId:'buyer',sellerId:'seller',quote,acceptance},identity.privateKey),runId);
    await emit(runId,{type:'a2a',direction:'buyer → seller',operation:'accept_and_deliver',taskId:delivered.taskId,contextId:delivered.contextId});
    if(delivered.value.state!=='delivered')throw peerFailure(delivered.value,'Seller delivery failed');
    let delivery=delivered.value;
    const confirmed=(await internal('context',runId)).receipt;
    let review={source:model.mode,value:{accepted:true,reason:'Included scope amendment verified; no video rendering claimed.'}},structure=null;
    for(let attempt=0;attempt<2;attempt++){
      const manifest=verifyDocument(delivery.manifest,peer.publicKey);
      if(!confirmed||!confirmed.verified||manifest.runId!==runId||manifest.quoteHash!==digest(quote.payload)||manifest.transactionId!==confirmed.transactionId||manifest.srtHash!==digest(delivery.srt)||manifest.revisionHash!==digest(delivery.revision))throw new Error('Delivery receipt binding mismatch');
      if(quote.payload.selection.french){structure=checkedSrt(SOURCE_SRT,delivery.srt,'buyer.delivery.structure');review=await call(runId,'review',{source:SOURCE_SRT,target:delivery.srt,language:'French'});}
      await emit(runId,{type:'review',accepted:review.value.accepted,reason:review.value.reason});
      if(review.value.accepted||attempt===1)break;
      const repair=await requestAgent(sellerURL,sellerToken,signDocument({type:'repair',runId,buyerId:'buyer',sellerId:'seller',quote,acceptance,feedback:review.value.reason},identity.privateKey),runId);
      await emit(runId,{type:'a2a',direction:'buyer → seller',operation:'repair',taskId:repair.taskId,contextId:repair.contextId});
      if(repair.value.state!=='delivered')throw peerFailure(repair.value,'Seller repair failed');delivery=repair.value;
    }
    return store.set(`result:${runId}`,{state:review.value.accepted?'accepted':'paid_delivery_failed',quote,acceptance,receipt:confirmed,manifest:delivery.manifest,srt:delivery.srt,revision:delivery.revision,structure,review,modelMode:model.mode});
  }
  const executor={
    async execute(context,bus){
      const {taskId,contextId}=context;
      bus.publish(AgentEvent.task({id:taskId,contextId,status:{state:TaskState.TASK_STATE_WORKING},artifacts:[],history:[context.userMessage],metadata:{agent:role,modelMode:model.mode}}));
      let value;
      try{
        const input=context.userMessage.parts.find(p=>p.content?.$case==='data')?.content.value;
        const key=`${contextId}:${digest(input)}`;
        if(!inflight.has(key))inflight.set(key,(input?.type==='v2_market_turn'&&input.runId===contextId?conversationTurn({input,role,identity,peer,store,internal}):input?.type==='v2_turn'&&input.runId===contextId?negotiationTurn({input,role,identity,peer,store,internal}):['v2_deliver','v2_review'].includes(input?.type)&&input.runId===contextId?deliveryAction({input,role,identity,store,internal,model}):role==='buyer'?buyer(input,context):seller(input,context)).finally(()=>inflight.delete(key)));
        value=await inflight.get(key);
      }catch(e){
        const error=e.errorCode||/budget|limit|expired|version|unknown|superseded|signature|binding|locked|failed|policy|scope/i.test(e.message)?e.message:'Agent task failed';
        const status=await internal('context',contextId).catch(()=>({})),receipt=status.receipt,payment=status.payment;
        value={state:receipt?'paid_delivery_failed':['reserved','unknown'].includes(payment?.state)?'payment_unknown':'failed',error,stage:e.stage??`${role}.request`,errorCode:e.errorCode??'AGENT_TASK_FAILED',modelMode:model.mode,...(receipt?{receipt}:{}),...(payment?{payment}:{})};
      }
      const artifacts=[];
      if(value.srt)artifacts.push({artifactId:digest(value.srt),name:'aurora.fr.srt',description:`French subtitle delivery · model: ${value.modelMode}`,parts:[textPart(value.srt,'aurora.fr.srt','application/x-subrip')],metadata:{modelMode:value.modelMode},extensions:[]});
      if(value.revision)artifacts.push({artifactId:digest(value.revision),name:'scope-amendment.json',description:'Scope amendment; no video rendering',parts:[textPart(JSON.stringify(value.revision,null,2),'scope-amendment.json','application/json')],metadata:{modelMode:value.modelMode},extensions:[]});
      for(const artifact of artifacts)bus.publish(AgentEvent.artifactUpdate({taskId,contextId,artifact,lastChunk:true,append:false}));
      bus.publish(AgentEvent.statusUpdate({taskId,contextId,status:{state:['failed','paid_delivery_failed','payment_unknown'].includes(value.state)?TaskState.TASK_STATE_FAILED:TaskState.TASK_STATE_COMPLETED,message:message(value,contextId,taskId),timestamp:new Date().toISOString()}}));bus.finished();
    },
    async cancelTask(){throw new Error('Use operator pause to stop new payment authorization');},
  };
  const app=express();app.disable('x-powered-by');
  let url;
  app.use((req,res,next)=>{if(req.headers.origin)return res.status(403).json({error:'Agent endpoint is server-to-server only'});if(url&&req.headers.host!==new URL(url).host)return res.status(403).json({error:'Invalid host'});next();});
  app.get('/health',(_req,res)=>res.json({role,pid:process.pid,modelMode:model.mode}));
  let handler;
  app.use('/.well-known/agent-card.json',(req,res,next)=>agentCardHandler({agentCardProvider:handler})(req,res,next));
  app.use((req,res,next)=>{if(req.headers.authorization!==`Bearer ${incomingToken}`)return res.status(401).json({error:'Agent authentication required'});next();});
  app.use(express.json({limit:'64kb'}));
  app.use((req,res,next)=>jsonRpcHandler({requestHandler:handler,userBuilder:async()=>({isAuthenticated:true,userName:role==='buyer'?'operator':'buyer'})})(req,res,next));
  const server=await new Promise((resolve,reject)=>{const s=app.listen(config.port,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
  url=`http://127.0.0.1:${server.address().port}`;
  const card=AgentCard.fromJSON({name:`ScopePay ${role==='buyer'?'Buyer':'Creator'} Agent`,description:`Autonomous ${role} under owner policy. Model: ${model.mode}. Sandbox prototype.`,version:'0.1.0',supportedInterfaces:[{url,protocolBinding:'JSONRPC',protocolVersion:A2A_PROTOCOL_VERSION}],capabilities:{streaming:false,pushNotifications:false},securitySchemes:{bearer:{httpAuthSecurityScheme:{scheme:'Bearer',bearerFormat:'opaque',description:'Local peer capability'}}},securityRequirements:[{schemes:{bearer:{list:[]}}}],defaultInputModes:['application/json'],defaultOutputModes:['application/json','application/x-subrip'],skills:[{id:role==='buyer'?'negotiate-and-accept':'quote-and-deliver',name:role==='buyer'?'Negotiate authorized change':'Quote and deliver scope additions',description:'Signed scope changes over A2A; deterministic payment verification.',tags:['scope-change','a2a','sandbox']} ]});
  handler=new DefaultRequestHandler(card,store,executor);
  return {url,card,store,close:()=>new Promise(r=>server.close(()=>{store.close();r();}))};
}
