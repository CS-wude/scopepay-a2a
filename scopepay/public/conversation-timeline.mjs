// Owner contributions are anchored after a signed sequence, not after the entire transcript.
export function conversationTimeline(session){
 const events=[...(session.discussion??[]).map((message,index)=>({kind:'message',message,anchor:message.payload.sequence*2,at:0,index})),...(session.clarifications??[]).map((clarification,index)=>({kind:'clarification',clarification,anchor:(clarification.afterSequence??0)*2+1,at:clarification.at??0,index}))];
 if(typeof session.text==='string'&&session.text.trim())events.push({kind:'request',request:{role:'buyer',text:session.text,visibility:session.requestVisibility??'shared',at:session.createdAt??null},anchor:-1,at:0,index:0});
 return events.sort((a,b)=>a.anchor-b.anchor||a.at-b.at||a.index-b.index);
}
