import {splitOwnerText} from './conversation-policy.mjs';
// Conservative explicit fields; unknown semantics remain visible source requirements for model review.
function extract(text){
 const out={};let m;
 if((m=text.match(/(\d+)\s*(?:分钟|min(?:utes?)?\b)/i)))out.durationMinutes=Number(m[1]);
 if((m=text.match(/(\d{3,4})p\b/i)))out.resolution=m[1]+'p';
 if(/16[:：]9|横屏/.test(text))out.aspect='16:9';else if(/9[:：]16|竖屏/.test(text))out.aspect='9:16';
 if(/(?:素材.{0,16}(?:卖家|卖方|制片方).{0,8}提供|(?:卖家|卖方|制片方).{0,16}提供[^；。]{0,70}素材|素材等.{0,12}全由卖家提供)/.test(text))out.materials='seller';
 if(/(?:素材.{0,10}(?:买家|买方|客户).{0,6}提供|(?:买家|买方|客户).{0,8}提供.{0,6}素材)/.test(text))out.materials='buyer';
 if(/(?:交付|交给|给我|附交|附带|包含|含).{0,15}(?:视频)?脚本|(?:视频)?脚本.{0,8}(?:交付|给我)/.test(text))out.scriptFile=true;
 if((m=text.match(/([1-9一二两三])轮(?:整体|文字)?修改|修改.{0,5}([1-9一二两三])轮/))){const v=m[1]??m[2];out.revisions=Number(v)||({一:1,二:2,两:2,三:3}[v]);}
 if(/配音(?:和|、)?配乐/.test(text))out.audio=true;
 if((m=text.match(/(24|48)\s*小时(?:内)?交付/)))out.deliveryHours=Number(m[1]);
 return out;
}
export function buildLedger(session){
 const sources=[{role:'buyer',text:session.text,source:'request'},...(session.clarifications??[]).map((c,i)=>({...c,source:'supplement:'+i}))];
 const issues={};const requirements=[];
 const prior=(session.resultHistory??[]).at(-1);if(prior?.status==='agreed'&&sources.some(c=>c.role==='buyer'&&/(?:之前|原来|其他|其余).{0,12}(?:不变|保持)/.test(c.text))){const t=prior.terms;for(const [id,value]of Object.entries(extract([t.scope,t.deliverable,...t.acceptance].join('；'))))issues[id]={id,value,hard:true,proposedBy:'buyer',status:'required',source:'agreement:'+prior.revision};}
 for(const c of sources){const text=c.visibility==='private'?'':splitOwnerText(c.text).publicText;if(!text)continue;requirements.push({role:c.role,text,source:c.source});if(c.role==='buyer')for(const [id,value]of Object.entries(extract(text)))issues[id]={id,value,hard:true,proposedBy:'buyer',status:'required',source:c.source};}
 return {version:1,issues:Object.values(issues),requirements};
}
export function termViolations(ledger,terms){
 if(!terms)return ['缺少完整方案'];const text=[terms.scope,terms.deliverable,...terms.acceptance].join('；'),got=extract(text),errors=[];
 for(const {id,value}of ledger.issues){
  if(id==='deliveryHours'){if(terms.deliveryHours>value)errors.push('交期超过要求');}
  else if(id==='materials'){if(got.materials!==value)errors.push(value==='seller'?'须明确素材由卖家提供':'须明确素材由买家提供');}
  else if(id==='scriptFile'){if(!/脚本|剧本/.test(terms.deliverable)||/(?:不含|不提供|不交付|无需交付).{0,6}(?:脚本|剧本)/.test(terms.deliverable))errors.push('交付物缺少脚本文件');}
  else if(id==='revisions'){if((got.revisions??0)<value)errors.push('修改轮次减少');}
  else if(got[id]!==value)errors.push('未保留要求：'+id+'='+value);
 }
 return errors;
}
export function samePackage(a,b){if(!a||!b)return false;const strip=t=>({scope:t.scope,deliverable:t.deliverable,deliveryHours:t.deliveryHours,acceptance:t.acceptance,...(t.optionId?{optionId:t.optionId}:{})});return JSON.stringify(strip(a))===JSON.stringify(strip(b));}
