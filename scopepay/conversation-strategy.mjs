import {samePackage,termViolations} from './conversation-ledger.mjs';
export function optionPolicy(policy,optionId){if(!optionId)return policy;const o=policy.options?.find(o=>o.id===optionId);if(!o)throw Error('Unknown authorized option');return {...policy,...(policy.role==='seller'?o:{}),selectedOptionId:optionId};}
export function authorized(terms,policy){if(policy.options?.length&&!terms.optionId)return false;if(terms.optionId){const o=policy.options?.find(x=>x.id===terms.optionId);if(!o||terms.scope!==o.scope||terms.deliverable!==o.deliverable||terms.deliveryHours!==o.deliveryHours||JSON.stringify(terms.acceptance)!==JSON.stringify(optionTerms(o).acceptance))return false;}if(terms.optionId&&policy.options.find(o=>o.id===terms.optionId)?.fixedPrice&&terms.amountMinor!==policy.options.find(o=>o.id===terms.optionId).askMinor)return false;policy=optionPolicy(policy,terms.optionId);if(policy.role==='seller'&&policy.fixedPrice)return terms.amountMinor===policy.askMinor;return policy.role==='buyer'?terms.amountMinor<=Math.min(policy.capMinor,policy.remainingMinor):terms.amountMinor>=policy.costMinor+policy.minMarginMinor&&terms.amountMinor<=(policy.maxAskMinor??policy.askMinor)&&terms.deliveryHours>=policy.deliveryHours;}
export function strategyPrice(session,policy,ledger,optionId){
 policy=optionPolicy(policy,optionId);
 const fixed=policy.options?.find(o=>o.id===optionId);if(fixed?.fixedPrice)return fixed.askMinor;
 const count=(session.discussion??[]).filter(e=>e.payload.actor===policy.role&&e.payload.action==='offer'&&(e.payload.terms.optionId??null)===(optionId??null)&&!termViolations(ledger,e.payload.terms).length).length;
 const elapsed=Math.max(0,(session.discussion??[]).length-(session.roundStart??0)),progress=Math.min(1,Math.max(count/3,(elapsed-1)/5)),cap=Math.min(policy.capMinor??2400,policy.remainingMinor??2400);
 if(policy.role==='buyer'){const start=Math.floor(cap*.75/100)*100;return Math.min(cap,Math.ceil((start+(cap-start)*progress)/100)*100);}
 const floor=policy.costMinor+policy.minMarginMinor;return Math.max(floor,Math.floor((policy.askMinor-(policy.askMinor-floor)*progress)/100)*100);
}
export function optionTerms(o){return {optionId:o.id,amountMinor:o.askMinor,scope:o.scope,deliverable:o.deliverable,deliveryHours:o.deliveryHours,acceptance:['按上述范围与交付物逐项核验']};}
export function pricedAction({session,policy,ledger,peerTerms,permitted=authorized}){
 if(policy.role==='buyer'&&!permitted(peerTerms,policy)){const alternatives=(policy.options??[]).filter(o=>o.id!==peerTerms.optionId&&o.askMinor<(policy.options.find(x=>x.id===peerTerms.optionId)?.askMinor??peerTerms.amountMinor)).map(o=>{const t=optionTerms(o);return {...t,amountMinor:Math.min(t.amountMinor,strategyPrice(session,policy,ledger,t.optionId))};}).filter(t=>!termViolations(ledger,t).length&&permitted(t,policy)).sort((a,b)=>a.amountMinor-b.amountMinor);if(alternatives.length){const t=alternatives[0];return {action:'offer',terms:{...t,amountMinor:Math.min(t.amountMinor,strategyPrice(session,policy,ledger,t.optionId))},text:session.contractChange?'原合同内的工作和本次必需新增项全部保留。加急是可选条件，我方改提以下标准方案，补款按已确认明细计算。':'在保留必需条件的前提下，改谈卖家已提供的另一方案，具体交期、范围和价格见条款。'};}}
 const target=strategyPrice(session,policy,ledger,peerTerms.optionId),buyer=policy.role==='buyer';
 if(permitted(peerTerms,policy)&&(buyer?peerTerms.amountMinor<=target:peerTerms.amountMinor>=target))return {action:'accept',terms:peerTerms,text:'同意本次完整方案，交付范围、验收条件和价格按此执行。'};
 const turns=(session.discussion??[]).length-(session.roundStart??0);
 if(turns>=7)return {action:'reject',terms:null,text:'在本次授权和已收到的完整报价下未能达成一致，本轮不成交。可以调整可协商条件后再谈，原有要求不变。'};
 const terms={...peerTerms,amountMinor:target};
 if(!permitted(terms,policy))return {action:'reject',terms:null,text:'当前完整方案不符合本方授权条件，本轮不成交。'};
 return {action:'offer',terms,text:`交付条件保持本次完整方案，我方提出 ${(target/100).toFixed(2)} 美元。`};
}
export function protectCounteroffer(action,peerTerms){
 if(action.action==='offer'&&samePackage(action.terms,peerTerms)&&action.terms.amountMinor>peerTerms.amountMinor)return {...action,terms:peerTerms,text:`保持对方已提出的完整方案，报价为 ${(peerTerms.amountMinor/100).toFixed(2)} 美元。`};return action;
}
