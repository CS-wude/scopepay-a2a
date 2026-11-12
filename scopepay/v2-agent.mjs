import {Negotiator} from './negotiation.mjs';
import {advise} from './advisor.mjs';
import {verifyDocument} from './identity.mjs';
import {signDocument,digest} from './identity.mjs';
import {SOURCE_SRT} from './fixtures.mjs';
import {validateSrt,parseSrt,wrapSrt} from './subtitles.mjs';

export async function deliveryAction({input,role,identity,store,internal,model}){
  const context=await internal('v2_context',input.runId),{session,receipt}=context;
  const source=context.sourceSrt??SOURCE_SRT;
  if(receipt?.state!=='verified')throw new Error('Verified original payment required');
  if(session.domain.sourceHash&&session.domain.sourceHash!==digest(context.sourceSrt))throw new Error('Original subtitle binding mismatch');
  const key=`v2:${input.runId}:${input.type}:${digest(input.feedback??input.srt??null)}`,cached=store.get(key);if(cached)return cached;
  if(input.type==='v2_deliver'&&role==='seller'){
    const pack=session.domain.packages.find(p=>p.id===session.candidate.packageId);
    let srt=null;
    if(pack.scope.includes('french')){
      let feedback=input.feedback,previous=input.previous;
      for(let attempt=0;attempt<2;attempt++){
        const translated=await model.call(role,'translate',{source,language:'French',...(feedback?{feedback,previous}: {})},{consume:()=>internal('v2_call',input.runId)});
        srt=translated.value.srt;
        try{validateSrt(source,srt);break;}catch(e){if(attempt)throw e;feedback='Preserve every original cue, numbering and exact timing. Repair subtitle structure.';previous=srt;}
      }
    }
    if(pack.scope.includes('subtitle_wrap'))srt=wrapSrt(srt??context.sourceSrt);
    return store.set(key,{srt,manifest:signDocument({type:'v2_delivery',runId:input.runId,agreementHash:receipt.agreementHash,transactionId:receipt.transactionId,srtHash:digest(srt),modelMode:model.mode},identity.privateKey)});
  }
  if(input.type==='v2_review'&&role==='buyer'){
    const pack=session.domain.packages.find(p=>p.id===session.candidate.packageId);
    if(pack.scope.includes('subtitle_wrap')&&!pack.scope.includes('french')){
      validateSrt(context.sourceSrt,input.srt);
      const a=parseSrt(context.sourceSrt),b=parseSrt(input.srt);
      const accepted=a.every((cue,i)=>cue.text.replace(/\s+/g,' ')===b[i].text.replace(/\s+/g,' ')&&b[i].text.split('\n').every(l=>l.length<=42));
      return store.set(key,{review:{accepted,reason:'Exact words and timing preserved; subtitle lines checked against 42-character limit.'},modelMode:'deterministic_verifier'});
    }
    if(input.srt)validateSrt(source,input.srt);
    const review=input.srt?await model.call(role,'review',{source,target:input.srt,language:'French'},{consume:()=>internal('v2_call',input.runId)}):{value:{accepted:true,reason:'Scope amendment checked; no video rendering claimed.'}};
    return store.set(key,{review:review.value,modelMode:model.mode});
  }
  throw new Error('Invalid delivery role');
}

// Runs inside each existing Agent process; the gateway returns only this role's policy.
export async function negotiationTurn({input,role,identity,peer,store,internal}){
  const context=await internal('v2_context',input.runId);
  const session=context.session;
  const key=`v2:${input.runId}`,saved=store.get(key);
  const negotiator=new Negotiator({domain:session.domain,policy:context.policy,identity,peer,sessionId:session.id,expiresAt:session.expiresAt,maxTurns:12,beta:1});
  if(saved){
    if(saved.requestKey===input.requestKey)return saved.result;
    negotiator.history=saved.history;negotiator.terminal=saved.terminal;
  }
  if(input.domainHash!==session.domainHash)throw new Error('Domain binding mismatch');
  let hint=null;
  if(context.modelMode==='live'){
    await internal('v2_call',input.runId);
    hint=await advise(negotiator,{SCOPEPAY_MODEL_MODE:'live',MODEL_BASE_URL:process.env.MODEL_BASE_URL,MODEL_API_KEY:process.env.MODEL_API_KEY,MODEL_NAME:process.env.MODEL_NAME},fetch,input.message?verifyDocument(input.message,peer.publicKey):null);
  }
  const result=negotiator.act(input.message??null,Date.now(),hint);
  result.advisor=context.modelMode==='live'?'live':'deterministic';
  store.set(key,{requestKey:input.requestKey,history:negotiator.history,terminal:negotiator.terminal,result});
  return result;
}
