import test from 'node:test';import assert from 'node:assert/strict';import {conversationTimeline} from '../scopepay/public/conversation-timeline.mjs';
test('full transcript starts with the original buyer request, even before any agent reply',()=>{
 const request='制作40分钟1080p爱情短剧，素材和剧情由制片方提供';
 assert.deepEqual(conversationTimeline({text:request,createdAt:123}).map(e=>({kind:e.kind,text:e.request?.text})),[{kind:'request',text:request}]);
 assert.deepEqual(conversationTimeline({text:'  '}),[]);
});
test('both human sides and agents remain in order across a new discussion round',()=>{
 const s={text:'原始需求',roundStart:2,discussion:[1,2,3].map(sequence=>({payload:{sequence,actor:sequence%2?'seller':'buyer',text:'代表'+sequence}})),clarifications:[{role:'buyer',text:'买家补充',afterSequence:1,at:1},{role:'seller',text:'卖家补充',afterSequence:2,at:2},{role:'buyer',text:'补充后重谈',afterSequence:2,at:3},{role:'seller',text:'等待代表回复的补充',afterSequence:3,at:4}]};
 assert.deepEqual(conversationTimeline(s).map(e=>e.request?.text??e.clarification?.text??e.message.payload.text),['原始需求','代表1','买家补充','代表2','卖家补充','补充后重谈','代表3','等待代表回复的补充']);
});
test('owner supplement precedes the subsequent agent replies instead of appearing at the end',()=>{
 const s={discussion:[16,17,18,19,20,21].map(sequence=>({payload:{sequence,text:'消息'+sequence}})),clarifications:[{afterSequence:16,at:1,text:'我还要他把视频脚本给我'}]};
 assert.deepEqual(conversationTimeline(s).map(e=>e.kind==='message'?e.message.payload.sequence:e.clarification.text),[16,'我还要他把视频脚本给我',17,18,19,20,21]);
});
test('same-position supplements retain chronological order; pending supplements and sparse snapshots remain visible',()=>{
 const s={discussion:[1,3].map(sequence=>({payload:{sequence}})),clarifications:[{afterSequence:3,at:6,text:'待回复'},{afterSequence:0,at:0,text:'开头'},{afterSequence:2,at:2,text:'中间'},{afterSequence:1,at:5,text:'后补充'},{afterSequence:1,at:1,text:'先补充'}]};
 assert.deepEqual(conversationTimeline(s).map(e=>e.kind==='message'?e.message.payload.sequence:e.clarification.text),['开头',1,'先补充','后补充','中间',3,'待回复']);
 assert.deepEqual(conversationTimeline({}),[]);
});
