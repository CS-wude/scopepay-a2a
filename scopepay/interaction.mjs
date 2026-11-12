import {buildLedger,termViolations} from './conversation-ledger.mjs';
import {digest} from './identity.mjs';
export const validRole=r=>['buyer','seller'].includes(r);
export const validMode=m=>['manual','auto'].includes(m);
export function sealResult(s,status,terms=null,summary=''){
 const revision=s.resultRevision??1,hash=digest({sessionId:s.id,revision,status,terms,summary});
 return {...s,state:'awaiting_review',awaitingRole:null,question:null,error:null,discussionResult:{revision,hash,status,terms,summary,approvals:{}},agreement:terms,result:summary};
}
export function mountInteraction(app,{load,save,active,start,store,prepare,list}){
 const defaults=()=>({buyer:store.getSetting('market:mode:buyer','auto'),seller:store.getSetting('market:mode:seller','auto')});
 app.post('/api/market/interaction',(req,res)=>{
   const {role,mode}=req.body??{};if(Object.keys(req.body??{}).sort().join(',')!=='mode,role'||!validRole(role)||!validMode(mode))return res.status(400).json({error:'请选择本方的人工参与或全权代理模式'});
   store.setSetting('market:mode:'+role,mode);
   for(const old of list()){
     if(old.workflow!=='dual_mode'||['confirmed','cancelled'].includes(old.state)||validMode(old.interactionOverrides?.[role]))continue;
     let next={...old,interactionModes:{...old.interactionModes,[role]:mode}};
     if(!active.has(old.id)&&old.state==='needs_clarification'&&old.awaitingRole===role&&mode==='auto'){try{next={...prepare(next),state:'ready',question:null,awaitingRole:null};save(next);void start(old.id);}catch{save({...next,state:'failed',awaitingRole:null,error:'全局模式已更新；原服务状态发生变化，请重新选择服务开启协商。'});}}else save(next);
   }
   res.json({role,mode});
 });
 app.post('/api/v2/sessions/:id/interaction',(req,res)=>{
  try{const s=load(req.params.id),{role,mode}=req.body??{};
   if(!s?.service||s.negotiationMode!=='market_conversation'||!validRole(role)||!(validMode(mode)||mode===null)||Object.keys(req.body).sort().join(',')!=='mode,role'||active.has(s.id)||['confirmed','cancelled'].includes(s.state))throw Error();
   const effective=mode??defaults()[role],overrides={...(s.interactionOverrides??{}),[role]:mode};
   const next=save({...s,workflow:'dual_mode',kernelVersion:3,interactionOverrides:overrides,interactionModes:{...(s.interactionModes??defaults()),[role]:effective},resultRevision:s.resultRevision??1});
   if(s.state==='agreed'||s.state==='rejected')save(sealResult(next,s.state,s.state==='agreed'?s.agreement:null,s.state==='agreed'?'双方代表已谈妥方案，等待买卖双方本人处理结果。':s.result??''));
   else if(s.state==='needs_clarification'&&s.awaitingRole===role&&effective==='auto'){const ready=prepare(next);save({...ready,state:'ready',question:null,awaitingRole:null});void start(s.id);}
   res.json({ok:true});
  }catch{res.status(409).json({error:'当前会话暂不能切换模式，请等待本轮处理完成'});}
 });
 app.post('/api/v2/sessions/:id/cancel',(req,res)=>{
  const s=load(req.params.id),{role}=req.body??{};
  if(!s||s.workflow!=='dual_mode'||!validRole(role)||Object.keys(req.body).join(',')!=='role'||['confirmed','cancelled'].includes(s.state))return res.status(409).json({error:'当前会话不能结束'});
  save({...s,state:'cancelled',cancelledBy:role,question:null,awaitingRole:null});res.json({ok:true});
 });
 app.post('/api/v2/sessions/:id/decision',(req,res)=>{
  try{let s=load(req.params.id);const {role,revision,hash,action,text,visibility}=req.body??{};
   if(!s||s.workflow!=='dual_mode'||!validRole(role)||!['approve','revise','cancel'].includes(action))throw Error();
   if(visibility!==undefined&&(action!=='revise'||!['private','shared'].includes(visibility)))throw Error();
   if(Object.keys(req.body).filter(k=>k!=='visibility').sort().join(',')!==(action==='revise'?'action,hash,revision,role,text':'action,hash,revision,role'))throw Error();
   const r=s.discussionResult;if(!r||r.revision!==revision||r.hash!==hash||!['awaiting_review','confirmed'].includes(s.state))throw Error();
   if(s.state==='confirmed'){if(action==='approve'&&r.approvals[role])return res.json({ok:true,state:s.state});throw Error();}
   if(action==='approve'){
     if(r.status!=='agreed'||s.kernelVersion===3&&termViolations(buildLedger(s),r.terms).length)throw Error();const approvals={...r.approvals,[role]:{revision,hash,at:Date.now()}};
     s=save({...s,state:approvals.buyer&&approvals.seller?'confirmed':'awaiting_review',discussionResult:{...r,approvals}});
   }else if(action==='cancel'){s=save({...s,state:'cancelled',cancelledBy:role,question:null,awaitingRole:null});}
   else{
     if(s.contractChange)throw Error('请从原委托重新填写变更需求，当前方案与记录保留');
     if(active.has(s.id)||typeof text!=='string'||!text.trim()||text.length>2000)throw Error();
     const ready=prepare(s),history=[...(s.resultHistory??[]),r];
     s=save({...ready,state:'ready',resultRevision:revision+1,resultHistory:history,discussionResult:null,agreement:null,result:null,question:null,error:null,awaitingRole:null,roundStart:s.discussion.length,clarifications:[...s.clarifications,{role,text:text.trim(),...(visibility?{visibility}:{}),at:Date.now(),afterSequence:s.discussion.length}]});void start(s.id);
   }
   res.json({ok:true,state:s.state});
  }catch{res.status(409).json({error:'结果已变化或操作无效，请刷新后处理当前版本'});}
 });
 return {defaults};
}
