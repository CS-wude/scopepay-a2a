import test from 'node:test';import assert from 'node:assert/strict';import {checkDiscussionMessage} from '../scopepay/market-conversation.mjs';import {createIdentity,signDocument,digest} from '../scopepay/identity.mjs';
const buyer=createIdentity('buyer'),seller=createIdentity('seller');
const terms={amountMinor:1500,scope:'一张海报',deliverable:'PNG与源文件',deliveryHours:24,acceptance:['一轮修改']};
const session={id:'test',conversationHash:'bound-service-and-request',discussion:[]},policy={role:'buyer',capMinor:1500,remainingMinor:1500};
const payload={type:'market_dialogue',sessionId:session.id,bindingHash:session.conversationHash,actor:'buyer',sequence:1,parentHash:null,action:'offer',text:'按此范围报价',terms};
test('generic dialogue rejects signatures, budget excess, unrelated acceptance and changed terms',()=>{
 const check=(p,s=session)=>checkDiscussionMessage(signDocument(p,buyer.privateKey),{session:s,role:'buyer',publicKey:buyer.publicKey,policy});
 assert.equal(check(payload).terms.amountMinor,1500);
 assert.throws(()=>check({...payload,terms:{...terms,amountMinor:1600}}),/authorization/);
 assert.throws(()=>check({...payload,bindingHash:'another-service'}),/binding/);
 assert.throws(()=>check({...payload,action:'accept'}),/Acceptance/);
 const offer={...payload,actor:'seller'},withOffer={...session,discussion:[signDocument(offer,seller.privateKey)]},accept={...payload,action:'accept',sequence:2,parentHash:digest(offer)};
 assert.equal(check(accept,withOffer).action,'accept');assert.throws(()=>check({...accept,terms:{...terms,scope:'删减范围'}},withOffer),/Acceptance/);
 assert.throws(()=>checkDiscussionMessage(signDocument(payload,seller.privateKey),{session,role:'buyer',publicKey:buyer.publicKey,policy}),/signature/);
});

import {conversationTurn} from '../scopepay/market-conversation.mjs';
test('ungrounded or private model text is held back before the agent signs any public message',async t=>{
 const old=process.env.MODEL_BASE_URL;process.env.MODEL_BASE_URL='https://example.com/v1';t.after(()=>{if(old===undefined)delete process.env.MODEL_BASE_URL;else process.env.MODEL_BASE_URL=old;});
 const run={id:'guard',text:'制作一个40min爱情短剧',service:{title:'ai漫剧',description:'视频定制',kind:'短剧',askMinor:1600,deliveryHours:48},conversationHash:'guard-bound',discussion:[],clarifications:[]};let calls=0;
 const invoke=async(draft,check)=>{let n=0;return conversationTurn({input:{runId:'guard',bindingHash:'guard-bound',requestKey:crypto.randomUUID()},role:'buyer',identity:buyer,peer:seller,store:{get:()=>null,set:(_k,v)=>v},internal:async type=>type==='v2_call'?(calls++,{}):{conversation:run,policy,modelMode:'live'},fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(n++===0?draft:check)}}]})})});};
 const unsafe=await invoke({action:'clarify',text:'预算上限15美元，我需要原创剧本与配乐',terms:null},{grounded:false,privateLeak:true,openQuestions:true,reason:'未授权的条件与隐私披露'});
 assert.equal(unsafe.message.payload.action,'clarify');assert.equal(unsafe.message.payload.text.includes('15'),false);assert.equal(unsafe.message.payload.text.includes('原创剧本'),false);assert.ok(unsafe.message.payload.text.includes(run.text));assert.equal(calls,2);
 const incomplete=await invoke({action:'offer',text:'15美元，请问素材和尺寸是什么？',terms:{amount:'15.00',scope:'海报',deliverable:'PNG',deliveryHours:24,acceptance:['核对文件']}},{grounded:true,privateLeak:false,openQuestions:true,reason:'尺寸未确认'});
 assert.equal(incomplete.message.payload.action,'clarify');assert.equal(incomplete.message.payload.terms,null);
});

test('model cannot accept a quote above buyer authorization even if its own response asks to accept',async t=>{
 const old=process.env.MODEL_BASE_URL;process.env.MODEL_BASE_URL='https://example.com/v1';t.after(()=>{if(old===undefined)delete process.env.MODEL_BASE_URL;else process.env.MODEL_BASE_URL=old;});
 const offer={...payload,actor:'seller',sessionId:'bounded',bindingHash:'bounded',terms:{...terms,amountMinor:1600}},run={id:'bounded',text:'一张海报',service:{title:'海报',description:'PNG海报',kind:'设计',askMinor:1600,deliveryHours:24},conversationHash:'bounded',discussion:[signDocument(offer,seller.privateKey)],clarifications:[]};let n=0;
 const out=await conversationTurn({input:{runId:run.id,bindingHash:'bounded',requestKey:'bounded-buyer'},role:'buyer',identity:buyer,peer:seller,store:{get:()=>null,set:(_k,v)=>v},internal:async type=>type==='v2_call'?{}:{conversation:run,policy,modelMode:'live'},fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(n++===0?{action:'accept',text:'最多能出15美元，接受16美元',terms:{amount:'16.00',scope:terms.scope,deliverable:terms.deliverable,deliveryHours:24,acceptance:terms.acceptance}}:{grounded:true,privateLeak:false,openQuestions:false,reason:'报价条款无推测'})}}]})})});
 assert.equal(out.message.payload.action,'offer');assert.equal(out.message.payload.terms.amountMinor,1500);assert.equal(out.message.payload.text.includes('授权上限'),false);assert.equal(out.message.payload.text.includes('最多'),false);
});

test('buyer supplements reach both generation and seller grounding as requirements, not seller commitments',async t=>{
 const old=process.env.MODEL_BASE_URL;process.env.MODEL_BASE_URL='https://example.com/v1';t.after(()=>{if(old===undefined)delete process.env.MODEL_BASE_URL;else process.env.MODEL_BASE_URL=old;});
 const supplement='素材都制片方提供，交付标准为符合爱情题材并且剧情ok，还有就是去ai味';
 const run={id:'supplement',text:'制作一个40min爱情短剧',service:{title:'ai漫剧',description:'视频定制',kind:'短剧',askMinor:1600,deliveryHours:48},conversationHash:'supplement-bound',discussion:[],clarifications:[{role:'buyer',text:supplement,at:1,afterSequence:0}]};
 for(const role of ['buyer','seller']){const bodies=[];let n=0;const identity=role==='buyer'?buyer:seller,peer=role==='buyer'?seller:buyer,ownPolicy=role==='buyer'?policy:{role:'seller',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:48};
 const out=await conversationTurn({input:{runId:run.id,bindingHash:run.conversationHash,requestKey:role},role,identity,peer,store:{get:()=>null,set:(_k,v)=>v},internal:async type=>type==='v2_call'?{}:{conversation:run,policy:ownPolicy,modelMode:'live'},fetchImpl:async(_url,req)=>{bodies.push(JSON.parse(req.body));return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(n++===0?{action:'clarify',text:'待核对',terms:null}:{grounded:false,privateLeak:false,openQuestions:true,reason:'仍有未证实的承诺'})}}]})};}});
 for(const body of bodies){const context=JSON.parse(body.messages[1].content);assert.ok(JSON.stringify(context.sharedFacts).includes(supplement));assert.equal(context.sharedFacts.buyerRequirements.at(-1).text,supplement);assert.equal(context.sharedFacts.sellerCommitments.some(x=>x.text===supplement),false);}
 assert.ok(out.message.payload.text.includes(supplement));assert.equal(out.message.payload.text.includes('需求只有'),false);
 }
});

import {routineDecisionPolicy} from '../scopepay/market-conversation.mjs';
test('routine delegation is role-specific, revocable and does not expand payment boundaries',()=>{
 const s={clarifications:[{role:'buyer',text:'其他没有特别标准，不需要再确认了，我方agent尽力帮我争取利益就行'}]};
 assert.equal(routineDecisionPolicy(s,'buyer').delegated,true);assert.equal(routineDecisionPolicy(s,'seller').delegated,false);
 s.clarifications.push({role:'buyer',text:'撤回自主授权，必须问我确认'});assert.equal(routineDecisionPolicy(s,'buyer').delegated,false);
});
