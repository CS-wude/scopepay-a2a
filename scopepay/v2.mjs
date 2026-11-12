import {mountServiceContracts,planContractChange,contractHash} from './service-contract.mjs';
import {projectConversation,publicOwnerEntries} from './conversation-policy.mjs';
import {buildLedger} from './conversation-ledger.mjs';
import {mountInteraction,sealResult} from './interaction.mjs';
import {checkDiscussionMessage,routineDecisionPolicy} from './market-conversation.mjs';
import {randomUUID} from 'node:crypto';
import {digest,verifyDocument} from './identity.mjs';
import {validateDomain,validatePolicy,evaluate} from './negotiation.mjs';
import {SOURCE_SRT,FRENCH_SRT} from './fixtures.mjs';
import {validateSrt} from './subtitles.mjs';
import {interpretRequest} from './interpret.mjs';
import {defaultProject} from './domain.mjs';
import {serviceNegotiation,publicListing} from './marketplace.mjs';

export function defaultDelegation(){
  return {version:1,capMinor:2000,totalCapMinor:4000,standardValue:2200,rushValue:2400,revisionValue:2500,standardCost:800,rushCost:1400,revisionCost:1100,minMarginMinor:100,requireToday:false,allowStandard:true,colorRemaining:1,frenchIncluded:false,subtitleLanguageKnown:true,autoPay:false,allowPaidColor:false,colorCostMinor:400,colorValueMinor:600,wrapCostMinor:500,wrapValueMinor:1100};
}
export function validateDelegation(p){
  const base=defaultDelegation();
  if(!p||Object.keys(p).sort().join(',')!==Object.keys(base).sort().join(','))throw new Error('Invalid delegation fields');
  for(const k of Object.keys(base)){
    if(typeof base[k]==='boolean'){if(typeof p[k]!=='boolean')throw new Error('Invalid delegation flag');}
    else if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>1000000)throw new Error('Invalid delegation amount');
  }
  if(p.version<1||p.totalCapMinor<p.capMinor)throw new Error('Invalid delegation version or cap');return p;
}
export function intake(text,owners,{id=randomUUID(),now=Date.now(),remainingMinor=owners.totalCapMinor,intent=null}={}){
  if(typeof text!=='string'||!text.trim()||text.length>2000)throw new Error('Invalid request text');
  const french=intent?.french??/法语|法文|french/i.test(text),color=intent?.color??/调蓝|调色|蓝色|colou?r|blue/i.test(text),rush=intent?.rush??/今晚|今天|today|tonight/i.test(text);
  const mandatory=intent?.mandatoryToday??(rush&&/必须|务必|最晚|must|no later/i.test(text));
  if(intent?.uncertain)return {state:'needs_clarification',question:'请明确条件关系和需要的工作；当前请求不能可靠映射到已授权服务。'};
  if(intent?.extraSeconds>0||/(?:加|补).{0,3}\d+\s*秒|扩片|重写|额外调色|\bextra footage\b/i.test(text))return {state:'needs_owner',question:'请确认新增工作范围、费用上限及交期；原调色义务继续有效。'};
  const wrap=intent?.wrap??/压缩.{0,6}(字幕|行长)|字幕.{0,6}(压缩|行长)|wrap.{0,10}subtitle|subtitle.{0,10}wrap/i.test(text);
  if(!french&&!color&&!wrap)return {state:'needs_clarification',question:'请明确本次需要调色、法语字幕或额外修改的哪些工作。'};
  if(french&&!owners.subtitleLanguageKnown)return {state:'needs_clarification',question:'原合同的字幕包含哪种语言？请补充双方确认的语言约定。'};
  if(color&&owners.colorRemaining<1&&!owners.allowPaidColor)return {state:'needs_owner',question:'免费调色额度已用完，请确认本次额外调色的收费授权。'};
  const colorPaid=color&&owners.colorRemaining<1;
  const scope=[...(color?[colorPaid?'paid_color':'included_color']:[]),...(french?['french']:[]),...(wrap?['subtitle_wrap']:[])];
  const tomorrow=now+86400000,today=now+3600000;
  const frenchPaid=french&&!owners.frenchIncluded,hasPaid=frenchPaid||colorPaid||wrap;
  const domain={id,version:owners.version,contractVersion:1,currency:'USD',priceMinMinor:frenchPaid?800:0,priceMaxMinor:hasPaid?2400:0,priceStepMinor:100,required:scope,packages:[]};
  const values={},costs={},available=[];
  function add(name,dueAt,extraRevisions,value,cost){domain.packages.push({id:name,scope:[...scope],dueAt,extraRevisions});values[name]=value+(colorPaid?owners.colorValueMinor:0)+(wrap?owners.wrapValueMinor:0);costs[name]=cost+(colorPaid?owners.colorCostMinor:0)+(wrap?owners.wrapCostMinor:0);available.push(name);}
  const paid=frenchPaid;
  const todayOnly=mandatory||owners.requireToday||!owners.allowStandard;
  if(!todayOnly)add('standard',tomorrow,0,paid?owners.standardValue:0,paid?owners.standardCost:0);
  if(rush||todayOnly)add('today',today,0,paid?owners.rushValue:0,paid?owners.rushCost:0);
  if(!todayOnly&&paid)add('standard_revision',tomorrow,1,owners.revisionValue,owners.revisionCost);
  const buyer={role:'buyer',version:owners.version,capMinor:owners.capMinor,remainingMinor:Math.max(0,remainingMinor),latestDueAt:todayOnly?today:tomorrow,disagreementMinor:0,values};
  const seller={role:'seller',version:owners.version,minMarginMinor:hasPaid?owners.minMarginMinor:0,disagreementMinor:0,costs,available};
  validateDomain(domain);validatePolicy(domain,buyer,'buyer');validatePolicy(domain,seller,'seller');
  return {state:'ready',domain,buyer,seller};
}

export function mountV2(app,{store,payments,identities,turn,modelEnv={},marketplace}){
  const db=store.db,active=new Set();
  db.exec('CREATE TABLE IF NOT EXISTS v2_payments(id TEXT PRIMARY KEY, run_id TEXT UNIQUE, amount INTEGER NOT NULL, state TEXT NOT NULL, doc TEXT NOT NULL)');
  if(!store.getSetting('v2:owners',null))store.setSetting('v2:owners',defaultDelegation());
  store.setSetting('v2:owners',{...defaultDelegation(),...store.getSetting('v2:owners')});
  if(!store.getSetting('v2:contract',null)){
    const past=db.prepare("SELECT run_id FROM v2_payments WHERE state='verified'").all().map(r=>store.getSetting(`v2:${r.run_id}`,null)).filter(Boolean);
    const scopes=past.map(s=>s.domain.packages.find(p=>p.id===s.candidate.packageId).scope);
    store.setSetting('v2:contract',{version:1+past.length,colorRemaining:Math.max(0,1-scopes.filter(s=>s.includes('included_color')).length),frenchIncluded:scopes.some(s=>s.includes('french'))});
  }
  const owner=()=>store.getSetting('v2:owners');
  const contract=()=>store.getSetting('v2:contract');
  const used=()=>db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM v2_payments WHERE state!='failed'").get().n;
  const load=id=>store.getSetting(`v2:${id}`,null);
  const save=s=>{const previous=load(s.id);s={...s,...(s.kernelVersion===3?{ledger:buildLedger(s)}:{}),calls:Math.max(previous?.calls??0,s.calls??0)};store.setSetting(`v2:${s.id}`,s);return s;};
  const contracts=mountServiceContracts(app,{store,blocked:id=>db.prepare("SELECT doc FROM settings WHERE id LIKE 'v2:%'").all().some(r=>{const s=JSON.parse(r.doc);return s?.contractChange?.contractRef.id===id&&db.prepare("SELECT id FROM v2_payments WHERE run_id=? AND state!='failed'").get(s.id);})});
  const payment=id=>{const row=db.prepare('SELECT doc FROM v2_payments WHERE run_id=?').get(id);return row?JSON.parse(row.doc):null;};
  const mark=(op,state,patch={})=>store.tx(()=>{
    const latest=payment(op.runId);if(['verified','failed'].includes(latest?.state))return latest;
    const next={...latest,...patch,state};db.prepare('UPDATE v2_payments SET state=?,doc=? WHERE id=?').run(state,JSON.stringify(next),op.id);
    if(state==='verified'){
      const s=load(op.runId);if(s.contractChange){contracts.mark(s.contractChange.contractRef,s.id,'committed');return next;}const pack=s.domain.packages.find(p=>p.id===s.candidate.packageId),current=contract();
      if(current.version!==s.domain.contractVersion)throw new Error('Contract changed during payment');
      store.setSetting('v2:contract',{version:current.version+1,colorRemaining:current.colorRemaining-(pack.scope.includes('included_color')?1:0),frenchIncluded:current.frenchIncluded||pack.scope.includes('french')});
    }
    if(state==='failed'){const s=load(op.runId);if(s?.contractChange)contracts.mark(s.contractChange.contractRef,s.id,'released');}
    return next;
  });
  function publicSession(s,role){if(!s)return null;const {buyer,seller,diagnostic,changeAuthorization,...pub}=s;return {...pub,...(changeAuthorization?{changeAuthorization:role==='buyer'?changeAuthorization:{allowPaidColor:!!changeAuthorization.allowPaidColor}}:{}),...(s.negotiationMode==='market_conversation'?publicOwnerEntries(s,role):{}),...(s.workflow==='dual_mode'?{interactionSources:Object.fromEntries(['buyer','seller'].map(role=>[role,['confirmed','cancelled'].includes(s.state)?'snapshot':['manual','auto'].includes(s.interactionOverrides?.[role])?'session':'global']))}:{}),...(s.negotiationMode==='market_conversation'?{routineDecisions:{buyer:routineDecisionPolicy(s,'buyer').delegated,seller:routineDecisionPolicy(s,'seller').delegated}}:{}),payment:payment(s.id)};}
  async function recover(op){
    if(op.state==='verified')return op;
    if(op.state==='failed')throw new Error('Payment definitively failed');
    try{
      const found=await payments.psp.findByOrder(op.id);
      if(found.length===1){const t=found[0];
        if(t.id&&(!op.transactionId||op.transactionId===t.id)&&t.type==='sale'&&t.orderId===op.id&&t.amountMinor===op.amountMinor&&t.currency==='USD'&&t.merchantAccountId===payments.psp.merchantAccountId&&['submitted_for_settlement','settling','settled','settlement_pending','settlement_confirmed'].includes(t.status))return mark(op,'verified',{transactionId:t.id,status:t.status});
      }
    }catch{}
    const latest=mark(op,'unknown');if(latest.state==='verified')return latest;throw new Error('Original payment unknown; budget remains reserved');
  }
  function verifyAgreement(s){
    if(s.domainHash!==digest(s.domain)||s.service&&s.domain.serviceHash!==digest(s.service))throw new Error('Agreement service binding mismatch');
    if(s.state!=='agreed'||!s.candidate)throw new Error('No accepted agreement');
    if(s.expiresAt<=Date.now()||s.ownerVersion!==owner().version)throw new Error('Authorization or quote expired; renegotiate');
    if(s.domain.contractVersion!==contract().version)throw new Error('Original contract changed; renegotiate');
    let parent=null,last=null;const versions={};
    for(let i=0;i<s.messages.length;i++){
      const env=s.messages[i],m=verifyDocument(env,identities[env.payload.actor]?.publicKey);
      if(m.sessionId!==s.id||m.domainHash!==s.domainHash||m.sequence!==i+1||m.parentHash!==parent||m.expiresAt!==s.expiresAt||m.policyVersion!==s.ownerVersion||(last&&m.actor===last.actor))throw new Error('Agreement chain mismatch');
      versions[m.actor]=m.policyVersion;parent=digest(m);last=m;
    }
    const preceding=s.messages.at(-2)?.payload;
    if(last?.type!=='accept'||preceding?.type!=='offer'||digest(preceding.candidate)!==digest(s.candidate)||digest(last.candidate)!==digest(s.candidate)||!versions.buyer||!versions.seller)throw new Error('Missing bilateral acceptance');
    if(evaluate(s.domain,s.buyer,s.candidate)===null||evaluate(s.domain,s.seller,s.candidate)===null)throw new Error('Agreement violates delegation');
  }
  async function charge(s){
    if(s.negotiationMode==='market_conversation'&&!s.contractChange)throw new Error('本次仅协商服务方案，交付与验收方式确认前不能付款');
    const existing=payment(s.id);if(existing)return existing.state==='verified'?existing:recover(existing);
    const amendmentQuote=s.contractChange?verifyChange(s):null;if(!s.contractChange)verifyAgreement(s);
    const amount=amendmentQuote?.askMinor??s.candidate.amountMinor;
    if(store.getSetting('paused',false))throw new Error('New payments paused');
    const op=store.tx(()=>{
      if(used()+amount>owner().totalCapMinor)throw new Error('Remaining budget changed; renegotiate');
      if(db.prepare("SELECT id FROM v2_payments WHERE state IN ('reserved','unknown') LIMIT 1").get())throw new Error('Resolve original payment first');
      if(amendmentQuote)contracts.reserve(s.contractChange.contractRef,s.id,amendmentQuote.freeColor,amendmentQuote.newFrench);
      const op={id:`sp-v2-${randomUUID()}`,runId:s.id,amountMinor:amount,currency:'USD',agreementHash:digest(s.contractChange?s.discussion.at(-1).payload:s.messages.at(-1).payload),state:'reserved'};
      db.prepare('INSERT INTO v2_payments VALUES(?,?,?,?,?)').run(op.id,s.id,op.amountMinor,op.state,JSON.stringify(op));return op;
    });
    if(!op.amountMinor)return mark(op,'verified',{transactionId:`included-${op.id}`,status:'included'});
    try{const t=await payments.psp.create(op);const submitted=mark(op,'reserved',{transactionId:t.id});return await recover(submitted);}
    catch(e){if(e.definitiveFailure){mark(op,'failed');throw new Error('Payment failed before charge; reservation released');}mark(op,'unknown');throw new Error('Original payment unknown; query before retry');}
  }
  function conversationContext(s){return {kernelVersion:s.kernelVersion??null,interactionModes:s.interactionModes??null,roundStart:s.roundStart??0,id:s.id,text:s.text,service:s.service,conversationHash:s.conversationHash,resultHistory:s.resultHistory??[],ownerChoices:s.ownerChoices??{},contractChange:s.contractChange??null,discussion:s.discussion??[],clarifications:s.clarifications??[]};}
  function prepareChange(s){
    const c=contracts.resolve(s.contractChange.contractRef),p=owner();
    if(c.contentHash!==s.contractChange.contentHash)throw Error('Original contract changed');
    if(s.changeAuthorization.capMinor!==undefined&&(!Number.isSafeInteger(s.changeAuthorization.capMinor)||s.changeAuthorization.capMinor<0||s.changeAuthorization.capMinor>p.capMinor))throw Error('本次补款上限不能超过现有购买授权');
    const plan=planContractChange(c,{...s.intent,mandatoryToday:s.intent.mandatoryToday||p.requireToday||!p.allowStandard},s.changeAuthorization),opts=plan.quotes;
    const service={id:c.id,version:c.version,title:c.title+' · 变更',kind:'创作服务变更',description:c.agreementText,askMinor:opts.length?Math.min(...opts.map(q=>q.askMinor)):0,deliveryHours:c.standardHours,fulfillmentKind:null,currency:'USD',includes:c.agreementText,options:opts};
    return {...s,contractChange:plan,contractSnapshot:c,service,sourceSrt:c.sourceSrt,ownerVersion:p.version,
      buyer:{role:'buyer',capMinor:Math.min(p.capMinor,s.changeAuthorization.capMinor??p.capMinor),remainingMinor:Math.max(0,p.totalCapMinor-used()),options:opts},seller:{role:'seller',options:opts,askMinor:opts[0]?.askMinor??0,fixedPrice:true,deliveryHours:24},
      state:plan.issues.length?'needs_clarification':'ready',awaitingRole:plan.issues[0]?.role??null,question:plan.issues[0]?.question??null};
  }
  function changeQuote(s){const q=s.contractChange.quotes.find(q=>q.id===s.discussionResult?.terms?.optionId);if(!q||q.askMinor!==s.discussionResult.terms.amountMinor)throw Error('Contract price mismatch');return q;}
  function verifyChange(s){
    if(s.state!=='confirmed'||!s.discussionResult?.approvals.buyer||!s.discussionResult.approvals.seller)throw Error('买卖双方尚未认可同一版本方案');
    if(s.expiresAt<=Date.now()||s.ownerVersion!==owner().version)throw Error('Authorization or quote expired; renegotiate');
    const c=contracts.resolve(s.contractChange.contractRef);if(c.contentHash!==s.contractChange.contentHash)throw Error('Original contract changed');
    const q=changeQuote(s),fresh=planContractChange({...c,colorRemaining:c.colorRemaining+(c.allocations?.[s.id]?.state!=='released'?(c.allocations?.[s.id]?.color??0):0)},s.intent,s.changeAuthorization).quotes.find(x=>x.id===q.id);
    if(!fresh||digest(q)!==digest(fresh))throw Error('Original contract changed; allowance or price no longer available');
    let prior=null;for(let i=0;i<s.discussion.length;i++){const m=s.discussion[i].payload;if(m.sequence!==i+1||m.parentHash!==(prior?digest(prior):null))throw Error('Agreement chain mismatch');verifyDocument(s.discussion[i],identities[m.actor].publicKey);prior=m;}
    if(prior?.action!=='accept'||digest(prior.terms)!==digest(s.discussionResult.terms)||s.discussion.at(-2)?.payload.action!=='offer'||digest(s.discussion.at(-2).payload.terms)!==digest(prior.terms))throw Error('Missing bilateral acceptance');
    const checkSession=conversationContext(s);checkSession.discussion=s.discussion.slice(0,-1);checkDiscussionMessage(s.discussion.at(-1),{session:checkSession,role:prior.actor,publicKey:identities[prior.actor].publicKey,policy:s[prior.actor]});
    return q;
  }
  async function discuss(id){
    if(active.has(id))return;let s=load(id);if(!s||s.state!=='ready')return;
    active.add(id);save({...s,state:'negotiating',question:null,error:null});
    try{
      let role=s.discussion?.at(-1)?.payload.actor==='seller'?'buyer':'seller',pendingHandoff=null,pendingQuestion=null;
      for(let i=0;i<8;i++){
        s=load(id);if(s.state!=='negotiating')return;if(s.workflow==='dual_mode'){const last=s.discussion.at(-1)?.payload,replied=s.clarifications.some(c=>c.role===role&&c.afterSequence>=s.discussion.length);if(['clarify','offer'].includes(last?.action)&&s.discussion.length>(s.roundStart??0)&&s.interactionModes[role]==='manual'&&!replied){save({...s,state:'needs_clarification',awaitingRole:role,question:last.text});return;}}if(s.ownerVersion!==owner().version)throw Error('Authorization changed');
        const requestedMode=s.interactionModes?.[role];
        const response=await turn(role,{type:'v2_market_turn',runId:id,bindingHash:s.conversationHash,requestKey:`${id}:${s.discussion.length}:${digest(s.clarifications??[])}:${digest(s.interactionModes??null)}`},id);
        const message=response.value?.message;if(!message){const e=Error(response.value?.error??'Agent did not return a signed conversation action');e.errorCode=response.value?.errorCode??'AGENT_RESPONSE_INVALID';throw e;}
        s=load(id);if(s.state!=='negotiating')return;if(s.workflow==='dual_mode'&&requestedMode==='auto'&&s.interactionModes[role]==='manual'){save({...s,state:'needs_clarification',awaitingRole:role,question:s.discussion.at(-1)?.payload.text??'本方已切换为人工参与，请回复当前需求或方案。'});return;}const m=checkDiscussionMessage(message,{session:conversationContext(s),role,publicKey:identities[role].publicKey,policy:s[role]});
        s.discussion.push(message);s.a2aTasks.push({role,taskId:response.taskId,contextId:response.contextId,sequence:m.sequence});
        if(m.action==='accept'){save(s.workflow==='dual_mode'?sealResult(s,'agreed',m.terms,'双方代表已谈妥方案，等待买卖双方本人处理结果。'):{...s,state:'agreed',agreement:m.terms,question:null,result:'双方已同意本次报价、范围和验收条款。方案已记录，尚未付款或交付。'});return;}
        if(m.action==='reject'){save(s.workflow==='dual_mode'?sealResult(s,'rejected',null,m.text):{...s,state:'rejected',result:m.text,question:null});return;}
        if(m.action==='clarify'&&m.handoff&&(s.workflow!=='dual_mode'||s.interactionModes[m.handoff]==='manual')){if(!pendingHandoff){pendingHandoff=m.handoff;pendingQuestion=m.text;}}
        if(i>0&&pendingHandoff){save({...s,state:'needs_clarification',awaitingRole:pendingHandoff,question:s.workflow==='dual_mode'?pendingQuestion:pendingHandoff==='seller'?'等待卖家补充其可承接范围或授权；买家无需重复确认已委托的常规细节。':'本轮涉及买家尚未授权的核心条件，请查看具体问题后补充。'});return;}
        save({...s,state:'negotiating'});role=role==='seller'?'buyer':'seller';
      }
      s=load(id);save(s.workflow==='dual_mode'?sealResult(s,s.kernelVersion===3?'rejected':'stalled',null,s.kernelVersion===3?'在本次时限与公开条件下未形成可接受的完整方案，本轮未成交。可调整未解决的交付条件后重谈。':'本轮未形成双方接受的方案，可补充条件后重新讨论，或结束本次协商。'):{...s,state:'negotiation_stalled',awaitingRole:null,question:'本轮协商暂未达成一致，未要求你补充常规细节；可继续让双方协商或调整交易条件。'});
    }catch(e){if(load(id)?.state==='cancelled')return;save({...load(id),state:/Authorization/.test(e.message)?'needs_renegotiation':'failed',diagnostic:e.message,errorCode:e.errorCode??'CONVERSATION_FAILED',error:e.errorCode==='MODEL_ACCOUNT_OVERDUE'?'模型账户欠费，本轮尚未完成；已保留实际记录。':'本轮协商未完成，已保留双方实际对话；请检查模型连接或补充条件后继续。'});}
    finally{active.delete(id);}
  }
  async function negotiate(id){
    if(load(id)?.negotiationMode==='market_conversation')return discuss(id);
    let s=load(id);if(!s||s.state!=='ready')return;
    active.add(id);save({...s,state:'negotiating'});
    try{
      let role='seller',message=null,result;
      for(let i=0;i<14;i++){
        result=(await turn(role,{type:'v2_turn',runId:id,domainHash:s.domainHash,requestKey:`${id}:${i}`,message},id)).value;
        if(result.message){s.messages.push(result.message);save({...s,state:'negotiating'});}
        if(result.state!=='negotiating')break;
        if(!result.message)throw new Error('Agent missing signed action');
        message=result.message;role=role==='seller'?'buyer':'seller';
      }
      if(!['agreed','rejected'].includes(result?.state))throw new Error('Negotiation did not terminate');
      s={...s,state:result.state,candidate:result.candidate};save(s);
      if(s.state==='agreed'){
        verifyAgreement(s);
        if(owner().autoPay){save({...s,state:'paying'});const receipt=await charge(s);save({...s,state:'paid',receipt});await deliverSession(s.id);}
      }
    }catch(e){const op=payment(id),changed=/Authorization|contract changed|Remaining budget/i.test(e.message);save({...s,state:op?.state==='verified'?'paid_delivery_failed':op&&op.state!=='failed'?'payment_unknown':changed?'needs_renegotiation':'failed',error:changed?'Owner authorization, original contract or remaining budget changed; start a new negotiation.':'Review recorded negotiation and original payment before retry.'});}
    finally{active.delete(id);}
  }
  // Persisted unfinished sessions never replay a payment or assume delivery succeeded.
  const allRuns=()=>db.prepare("SELECT id FROM runs WHERE state='v2' ORDER BY created DESC").all();
  for(const r of allRuns()){const s=load(r.id);if(s&&['negotiating','paying'].includes(s.state))save({...s,state:payment(s.id)?'payment_unknown':'interrupted'});}
  app.get('/api/v2/state',(_req,res)=>res.json({owners:owner(),contract:contract(),budgetUsed:used(),modelMode:modelEnv.SCOPEPAY_MODEL_MODE==='live'?'live_assisted':'deterministic',paymentMode:payments.psp.mode,sessions:allRuns().map(r=>publicSession(load(r.id))).filter(Boolean)}));
  app.get('/api/market/workspace',(req,res)=>{
    const role=req.query.role;if(!['buyer','seller'].includes(role))return res.status(400).json({error:'请选择买家或卖家视角'});
    const p=owner();res.json({role,localOwnerWorkspace:true,paymentMode:payments.psp.mode,modelMode:modelEnv.SCOPEPAY_MODEL_MODE==='live'?'live':'fixture',interactionMode:interaction.defaults()[role],...(role==='buyer'?{delegation:{capMinor:p.capMinor,totalCapMinor:p.totalCapMinor,autoPay:p.autoPay},budgetUsed:used()}:{}),sessions:allRuns().map(r=>load(r.id)).filter(s=>s?.service).map(s=>publicSession(s,role))});
  });
  app.post('/api/market/buyer/delegation',(req,res)=>{
    try{
      if(Object.keys(req.body).sort().join(',')!=='autoPay,capMinor,totalCapMinor'||active.size||db.prepare("SELECT id FROM v2_payments WHERE state IN ('reserved','unknown') LIMIT 1").get())throw new Error();
      const p=validateDelegation({...owner(),...req.body,version:owner().version+1});if(p.totalCapMinor<used())throw new Error();store.setSetting('v2:owners',p);res.json({ok:true});
    }catch{res.status(409).json({error:'委托无效、预算低于已用金额或有活跃交易；请检查后重试'});}
  });
  app.post('/api/v2/owners',(req,res)=>{
    try{
      if(active.size||db.prepare("SELECT id FROM v2_payments WHERE state IN ('reserved','unknown') LIMIT 1").get())throw new Error('Active or unresolved transaction');
      const p=validateDelegation({...req.body,version:owner().version+1});if(p.totalCapMinor<used())throw new Error('Budget below committed spend');store.setSetting('v2:owners',p);res.json({ok:true});
    }catch{res.status(409).json({error:'Delegation invalid or blocked by active transaction'});}
  });
  app.post('/api/v2/project',(_req,res)=>{
    try{
      if(active.size||db.prepare("SELECT id FROM v2_payments WHERE state IN ('reserved','unknown') LIMIT 1").get())throw new Error('Resolve active operation first');
      const project=store.createProject(defaultProject());
      store.setSetting('v2:contract',{version:contract().version+1,colorRemaining:1,frenchIncluded:false});
      res.json({projectId:project.id,contract:contract(),budgetUsed:used()});
    }catch{res.status(409).json({error:'Active negotiation or unresolved payment prevents a new project'});}
  });
  app.post('/api/v2/sessions',async(req,res)=>{
    try{
      const {requestId,text,service:serviceRef,contract:contractRef,authorization:changeAuthorization={}}=req.body;
      if(contractRef&&(serviceRef||req.body.workflow!=='dual_mode'||Object.keys(contractRef).sort().join(',')!=='id,version'||Object.keys(changeAuthorization).some(k=>!['allowPaidColor','capMinor'].includes(k))||changeAuthorization.allowPaidColor!==undefined&&typeof changeAuthorization.allowPaidColor!=='boolean'))throw Error('Invalid change request');
      if(typeof requestId!=='string'||!/^[\w-]{8,80}$/.test(requestId))throw new Error('Invalid request id');
      const previous=store.getSetting(`v2:request:${requestId}`,null);if(previous){const old=load(previous);if((old.workflow??null)!==(req.body.workflow??null)||old.text!==text||JSON.stringify(old.serviceRef??null)!==JSON.stringify(serviceRef??null)||JSON.stringify(old.contractChange?.contractRef??null)!==JSON.stringify(contractRef??null)||digest(old.changeAuthorization??{})!==digest(changeAuthorization))throw new Error('Request identity reused');return res.json(publicSession(old));}
      if(contractRef)contracts.resolve(contractRef);
      const service=serviceRef?marketplace.resolve(serviceRef):null;
      if(store.getSetting('paused',false))throw new Error('New transactions paused');
      if(typeof text!=='string'||!text.trim()||text.length>2000)throw new Error('Invalid request');
      if(req.body.workflow!==undefined&&req.body.workflow!=='dual_mode')throw Error('Unknown workflow');
      if(contractRef){
        const intent=await interpretRequest(text,modelEnv)??{french:/法语|法文|french/i.test(text),color:/调蓝|调色|blue/i.test(text),rush:/今天|今晚|加急|tonight/i.test(text),mandatoryToday:/(?:今晚|今天).{0,6}(?:必须|务必)|(?:必须|务必).{0,6}(?:今晚|今天)/.test(text),extraSeconds:/(?:加|补).{0,3}\d+\s*秒/.test(text)?1:0,uncertain:/配音|重写/.test(text)};
        const prior=store.getSetting(`v2:request:${requestId}`,null);if(prior)return res.json(publicSession(load(prior)));
        const c=contracts.resolve(contractRef),run=store.createRun(store.projectList()[0].id,{state:'v2',text});
        let s=prepareChange({id:run.id,text,intent,changeAuthorization,contractChange:{contractRef,contentHash:c.contentHash},workflow:'dual_mode',kernelVersion:3,negotiationMode:'market_conversation',interactionModes:interaction.defaults(),interactionOverrides:{},resultRevision:1,roundStart:0,conversationPolicyVersion:2,discussion:[],a2aTasks:[],clarifications:[],resultHistory:[],calls:modelEnv.SCOPEPAY_MODEL_MODE==='live'?1:0,createdAt:Date.now(),expiresAt:Date.now()+900000});
        s.conversationHash=digest({contractRef,contentHash:c.contentHash,intent,text:projectConversation(s).text,authorization:s.contractChange.authorization,quotes:s.contractChange.quotes});s=save(s);store.setSetting(`v2:request:${requestId}`,s.id);if(s.state==='ready')void discuss(s.id);return res.status(202).json(publicSession(s));
      }
      const intent=service&&(req.body.workflow==='dual_mode'||service.fulfillmentKind===null)?null:await interpretRequest(text,modelEnv);
      const duplicate=store.getSetting(`v2:request:${requestId}`,null);if(duplicate)return res.json(publicSession(load(duplicate)));
      const run=store.createRun(store.projectList()[0].id,{state:'v2',text}),p=owner(),ct=contract();
      // Resolve again after model I/O: a concurrent edit/withdraw must invalidate the selection.
      if(serviceRef)marketplace.resolve(serviceRef);
      const marketIntent=intent??{french:/法语|法文/.test(text),wrap:/行长|换行|重排/.test(text),color:/调蓝|调色/.test(text),rush:/今天|今晚|加急/.test(text),uncertain:/配音|剪辑|重写|秒|术语表/.test(text)};
      const parsed=service?serviceNegotiation(req.body.workflow==='dual_mode'?{...service,fulfillmentKind:null}:service,p,{id:run.id,remainingMinor:Math.max(0,p.totalCapMinor-used()),intent:marketIntent}):intake(text,{...p,colorRemaining:Math.min(p.colorRemaining,ct.colorRemaining),frenchIncluded:p.frenchIncluded||ct.frenchIncluded},{id:run.id,remainingMinor:p.totalCapMinor-used(),intent});
      const sourceSrt=store.getSetting(`v2:srt:${run.projectId}`,SOURCE_SRT);
      if(parsed.domain){parsed.domain.contractVersion=ct.version;parsed.domain.sourceHash=digest(sourceSrt);}
      const s=save({id:run.id,text,intent,sourceSrt,...(service?{service:publicListing(service),serviceRef}:{}),calls:intent?1:0,intakeMode:intent?'live':'deterministic',...parsed,ownerVersion:p.version,domainHash:parsed.domain?digest(parsed.domain):null,expiresAt:Date.now()+900000,messages:[],...(parsed.negotiationMode==='market_conversation'?{...(req.body.workflow==='dual_mode'?{workflow:'dual_mode',kernelVersion:3,interactionModes:interaction.defaults(),interactionOverrides:{},resultRevision:1,roundStart:0}:{}),conversationPolicyVersion:2,discussion:[],a2aTasks:[],clarifications:[],conversationHash:digest({service:publicListing(service),text})}:{}),createdAt:Date.now()});store.setSetting(`v2:request:${requestId}`,s.id);
      if(s.state==='ready')void negotiate(s.id);res.status(202).json(publicSession(s));
    }catch{res.status(409).json({error:'Request invalid or new transactions paused'});}
  });
  app.post('/api/v2/sessions/:id/resume',(req,res)=>{
    try{
      const old=load(req.params.id);if(!old||!(['needs_owner','needs_clarification','negotiation_stalled'].includes(old.state)||old.workflow==='dual_mode'&&['failed','interrupted'].includes(old.state)))throw new Error('Session not awaiting clarification');
      if(old.contractChange){const next=save(prepareChange(old));if(next.state==='ready')void discuss(next.id);return res.status(202).json(publicSession(next));}
      if(old.service){
        if(old.workflow!=='dual_mode'&&old.service.fulfillmentKind!==null)throw new Error('Fixed integrated service');
        if(old.contractChange)throw Error('请在原委托资料中解决证据或授权问题');
      const service=marketplace.resolve(old.serviceRef),p=owner();if(digest(publicListing(service))!==digest(old.service))throw new Error('Service changed');
        const parsed=serviceNegotiation(old.workflow==='dual_mode'?{...service,fulfillmentKind:null}:service,p,{id:old.id,remainingMinor:Math.max(0,p.totalCapMinor-used())});
        const next=save({...old,...parsed,...(old.workflow==='dual_mode'?{kernelVersion:3}:{}),conversationPolicyVersion:2,earlierUnverifiedCount:old.earlierUnverifiedCount??(old.conversationPolicyVersion===2?0:old.discussion?.length??0),question:null,error:null,awaitingRole:null,ownerVersion:p.version,discussion:old.discussion??[],a2aTasks:old.a2aTasks??[],clarifications:old.clarifications??[],conversationHash:old.conversationHash??digest({service:old.service,text:old.text})});
        void discuss(next.id);return res.status(202).json(publicSession(next));
      }
      const p=owner(),ct=contract(),parsed=intake(old.text,{...p,colorRemaining:Math.min(p.colorRemaining,ct.colorRemaining),frenchIncluded:p.frenchIncluded||ct.frenchIncluded},{id:old.id,remainingMinor:p.totalCapMinor-used(),intent:old.intent});
      if(parsed.domain){parsed.domain.contractVersion=ct.version;parsed.domain.sourceHash=digest(old.sourceSrt??SOURCE_SRT);}
      const s=save({...old,...parsed,question:parsed.question??null,ownerVersion:p.version,domainHash:parsed.domain?digest(parsed.domain):null,expiresAt:Date.now()+900000});
      if(s.state==='ready')void negotiate(s.id);res.json(publicSession(s));
    }catch{res.status(409).json({error:'Cannot resume this session'});}
  });
  app.post('/api/v2/sessions/:id/clarify',(req,res)=>{
    try{
      const old=load(req.params.id),{role,text,visibility}=req.body;
      if(!old||old.negotiationMode!=='market_conversation'||!['needs_clarification','failed','interrupted'].includes(old.state)||active.has(old.id)||!['buyer','seller'].includes(role)||typeof text!=='string'||!text.trim()||text.length>2000||Object.keys(req.body).filter(k=>k!=='visibility').sort().join(',')!=='role,text'||visibility!==undefined&&!['private','shared'].includes(visibility))throw Error('Invalid clarification');
      if(old.contractChange)throw Error('请在原委托资料中解决证据或授权问题');
      const service=marketplace.resolve(old.serviceRef),p=owner();if(digest(publicListing(service))!==digest(old.service))throw Error('Service changed');
      if(old.workflow==='dual_mode'&&old.awaitingRole&&old.awaitingRole!==role)throw Error('Wrong reply role');
      if((old.clarifications??[]).length>=24)throw Error('Clarification limit');
      const parsed=serviceNegotiation(old.workflow==='dual_mode'?{...service,fulfillmentKind:null}:service,p,{id:old.id,remainingMinor:Math.max(0,p.totalCapMinor-used())});
      const next=save({...old,...parsed,...(old.workflow==='dual_mode'?{kernelVersion:3}:{}),conversationPolicyVersion:2,earlierUnverifiedCount:old.earlierUnverifiedCount??(old.conversationPolicyVersion===2?0:old.discussion?.length??0),error:null,question:null,awaitingRole:null,ownerVersion:p.version,clarifications:[...(old.clarifications??[]),{role,text:text.trim(),...(visibility?{visibility}:{}),at:Date.now(),afterSequence:old.discussion.length}]});
      void discuss(next.id);res.status(202).json(publicSession(next));
    }catch{res.status(409).json({error:'当前会话不能继续，请检查服务版本或补充内容后重试'});}
  });
  const interaction=mountInteraction(app,{load,save,active,start:discuss,store,list:()=>allRuns().map(r=>load(r.id)).filter(Boolean),prepare:s=>{
    if(s.contractChange){const next=prepareChange(s);if(next.state!=='ready')throw Error('原委托需要补充证据或授权');return next;}
    const service=marketplace.resolve(s.serviceRef),p=owner();if(digest(publicListing(service))!==digest(s.service))throw Error('Service changed');
    const parsed=serviceNegotiation({...service,fulfillmentKind:null},p,{id:s.id,remainingMinor:Math.max(0,p.totalCapMinor-used())});
    return {...s,...parsed,ownerVersion:p.version};
  }});
  app.post('/api/v2/sessions/:id/change-choice',(req,res)=>{
    try{const s=load(req.params.id),{role,optionId}=req.body;if(!s?.contractChange||s.state!=='needs_clarification'||s.contractChange.issues.length||s.awaitingRole!==role||s.interactionModes[role]!=='manual'||active.has(s.id)||Object.keys(req.body).sort().join(',')!=='optionId,role'||!s.contractChange.quotes.some(q=>q.id===optionId))throw Error('当前没有需要本方选择的有效方案');
      const next=save({...prepareChange(s),ownerChoices:{...s.ownerChoices,[role]:optionId},clarifications:[...s.clarifications,{role,text:'本方选择已确认价目中的完整方案：'+s.contractChange.quotes.find(q=>q.id===optionId).label,at:Date.now(),afterSequence:s.discussion.length}]});void discuss(s.id);res.json(publicSession(next,role));
    }catch(e){res.status(409).json({error:e.message});}
  });
  app.post('/api/v2/sessions/:id/change-authorization',(req,res)=>{
    try{const s=load(req.params.id);if(!s?.contractChange||s.state!=='needs_clarification'||s.discussion.length||req.body.role!=='buyer'||req.body.allowPaidColor!==true||Object.keys(req.body).sort().join(',')!=='allowPaidColor,role'||active.has(s.id))throw Error('当前不能改变本次授权');
      let next=prepareChange({...s,changeAuthorization:{...s.changeAuthorization,allowPaidColor:true},clarifications:[...s.clarifications,{role:'buyer',text:'允许按已确认价目对额度外调色另行报价；支付上限保持不变。',at:Date.now(),afterSequence:0}]});
      next.conversationHash=digest({previous:s.conversationHash,authorization:next.contractChange.authorization,quotes:next.contractChange.quotes});next=save(next);if(next.state==='ready')void discuss(s.id);res.json(publicSession(next,'buyer'));
    }catch(e){res.status(409).json({error:e.message});}
  });
  app.post('/api/v2/sessions/:id/color-delivery',(req,res)=>{
    try{const s=load(req.params.id),op=payment(s?.id),{role,reference}=req.body;if(!s?.contractChange||!s.intent.color||op?.state!=='verified'||role!=='seller'||Object.keys(req.body).sort().join(',')!=='reference,role'||typeof reference!=='string'||!reference.trim()||reference.length>600)throw Error('请先核验原付款，再由卖家填写调色交付凭据');
      if(s.colorDelivery?.review?.accepted)throw Error('该版本已验收，不能覆盖原交付');
      const entry={reference:reference.trim(),at:Date.now(),agreementHash:op.agreementHash,version:(s.colorDelivery?.version??0)+1};entry.hash=digest(entry);save({...s,state:'partially_delivered',colorDelivery:entry,colorDeliveryHistory:[...(s.colorDeliveryHistory??[]),...(s.colorDelivery?[s.colorDelivery]:[])]});res.json({colorDelivery:entry});
    }catch(e){res.status(409).json({error:e.message});}
  });
  app.post('/api/v2/sessions/:id/color-review',(req,res)=>{
    try{const s=load(req.params.id),{role,hash,accepted}=req.body;if(!s?.contractChange||payment(s.id)?.state!=='verified'||role!=='buyer'||typeof accepted!=='boolean'||Object.keys(req.body).sort().join(',')!=='accepted,hash,role'||hash!==s.colorDelivery?.hash)throw Error('交付凭据已变化，请按当前版本验收');
      const colorDelivery={...s.colorDelivery,review:{accepted,at:Date.now(),hash}};if(s.colorDelivery.review&&s.colorDelivery.review.accepted!==accepted)throw Error('已记录验收结果，修改交付请由卖家提交新版本');save({...s,colorDelivery,state:!accepted?'paid_delivery_failed':s.delivery?.review.accepted?'delivered':'partially_delivered'});res.json({colorDelivery});
    }catch(e){res.status(409).json({error:e.message});}
  });
  const financial=new Set();
  app.post('/api/v2/sessions/:id/pay',async(req,res)=>{
    const id=req.params.id;if(financial.has(id))return res.status(409).json({error:'Operation in progress'});financial.add(id);
    try{const s=load(id);if(!s)throw new Error('Unknown session');const receipt=await charge(s);save({...s,state:s.contractChange?(s.state==='delivered'?'delivered':s.delivery||s.colorDelivery?'partially_delivered':'paid'):s.delivery?(s.delivery.review.accepted?'delivered':'paid_delivery_failed'):'paid',receipt});res.json({receipt});}
    catch(e){const s=load(id);if(s&&!payment(id)&&/Authorization|contract changed|Remaining budget/i.test(e.message))save({...s,state:'needs_renegotiation',error:'Current authorization or contract changed. Please negotiate again.'});res.status(409).json({error:e.message});}finally{financial.delete(id);}
  });
  async function deliverSession(id){
      const s=load(id),op=payment(s?.id);if(s?.negotiationMode==='market_conversation'&&!s.contractChange)throw new Error('No automatic fulfillment configured');if(!s||op?.state!=='verified')throw new Error('Verified payment required');
      if(s.delivery?.review.accepted)return {delivery:s.delivery};
      const pack=s.contractChange?deliveryContext(s).domain.packages.find(p=>p.id===s.discussionResult.terms.optionId):s.domain.packages.find(p=>p.id===s.candidate.packageId);
      let delivered,review;
      for(let attempt=0;attempt<2;attempt++){
        delivered=(await turn('seller',{type:'v2_deliver',runId:s.id,...(attempt?{feedback:review.reason,previous:delivered.srt}: {})},s.id)).value;
        const manifest=verifyDocument(delivered.manifest,identities.seller.publicKey);
        if(manifest.type!=='v2_delivery'||manifest.runId!==s.id||manifest.agreementHash!==op.agreementHash||manifest.transactionId!==op.transactionId||manifest.srtHash!==digest(delivered.srt))throw new Error('Delivery binding mismatch');
        if(pack.scope.includes('french'))validateSrt(s.sourceSrt??SOURCE_SRT,delivered.srt);
        review=(await turn('buyer',{type:'v2_review',runId:s.id,srt:delivered.srt},s.id)).value.review;
        if(typeof review?.accepted!=='boolean')throw new Error('Invalid review');if(review.accepted)break;
      }
      const delivery={mode:modelEnv.SCOPEPAY_MODEL_MODE==='live'?'live':'authored_fixture',srt:delivered.srt,manifest:delivered.manifest,review,hash:digest(delivered.srt),agreementHash:op.agreementHash,transactionId:op.transactionId,scope:pack.scope,dueAt:pack.dueAt,extraRevisions:pack.extraRevisions,note:'SRT and scope amendment; no video rendering.'};
      if(review.accepted&&delivered.srt)store.setSetting(s.contractChange?`service-contract:srt:${s.contractChange.contractRef.id}:${s.contractChange.contractRef.version}`:`v2:srt:${store.getRun(s.id).projectId}`,delivered.srt);
      const waitingColor=s.contractChange&&s.intent.color&&!s.colorDelivery?.review?.accepted;save({...load(s.id),state:review.accepted?(waitingColor?'partially_delivered':'delivered'):'paid_delivery_failed',delivery});return {delivery};
  }
  app.post('/api/v2/sessions/:id/deliver',async(req,res)=>{
    try{res.json(await deliverSession(req.params.id));}
    catch{res.status(409).json({error:'Delivery incomplete; original payment retained. Retry checks original task, never recharges.'});}
  });
  function deliveryContext(s){const q=changeQuote(s);return {id:s.id,candidate:{packageId:q.id,amountMinor:q.askMinor},domain:{sourceHash:digest(s.sourceSrt),packages:[{id:q.id,scope:[...(s.intent.french?['french']:[]),...(s.intent.color?[q.freeColor?'included_color':'paid_color']:[])],dueAt:s.createdAt+q.actualDeliveryHours*3600000,extraRevisions:0}]}};}
  return {load,publicSession,consume:id=>store.tx(()=>{const s=load(id);if(!s||s.calls>=(s.negotiationMode==='market_conversation'?48:18))throw new Error('Model call limit');save({...s,calls:(s.calls??0)+1});return {ok:true};}),context:(id,role)=>{const s=load(id);if(s?.negotiationMode==='market_conversation')return {modelMode:modelEnv.SCOPEPAY_MODEL_MODE==='live'?'live':'fixture',conversation:projectConversation(conversationContext(s),role),ownInstructions:projectConversation(conversationContext(s),role).ownInstructions,policy:s[role],...(s.contractChange&&payment(id)?.state==='verified'?{session:deliveryContext(s),sourceSrt:s.sourceSrt,receipt:payment(id)}:{})};if(!s||!s.domain)throw new Error('No negotiation context');return {modelMode:modelEnv.SCOPEPAY_MODEL_MODE==='live'?'live':'deterministic',session:{id:s.id,domain:s.domain,domainHash:s.domainHash,expiresAt:s.expiresAt,candidate:s.candidate},sourceSrt:s.sourceSrt??SOURCE_SRT,receipt:payment(id),policy:s[role]};},negotiate};
}
