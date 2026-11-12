// Owner instructions are not counterpart messages. Default to withholding ambiguous money text.
const sensitive=/(?:预算|底线|底价|成本|最低收益|最高.{0,6}(?:付|出|价)|最多.{0,6}(?:付|出)|上限|保留价).{0,12}(?:\d|[一二三四五六七八九十]+(?:元|美元))|不要(?:告诉|透露|公开)|别告诉|仅(?:本方|自己|我的代表)|私下.{0,6}(?:说|告诉)|请.{0,4}保密|\b(?:budget|cost|ceiling|reservation|maximum|minimum margin)[^.;]{0,24}\d/i;
export function splitOwnerText(text=''){
 const publicParts=[],privateParts=[];
 for(const part of String(text).split(/(?<=[。；;！!？?\n，,])/u).map(x=>x.trim()).filter(Boolean))(sensitive.test(part)?privateParts:publicParts).push(part);
 return {publicText:publicParts.join(''),privateText:privateParts.join('')};
}
export const hasPrivateLanguage=text=>sensitive.test(text??'');
export function projectConversation(session,role){
 const text=splitOwnerText(session.text).publicText;
 const clarifications=(session.clarifications??[]).map(c=>({...c,text:c.visibility==='private'?'':splitOwnerText(c.text).publicText})).filter(c=>c.text);
 const ownInstructions=[{role:'buyer',text:session.text},...(session.clarifications??[])].filter(c=>c.role===role).map(c=>c.visibility==='private'?c.text:splitOwnerText(c.text).privateText).filter(Boolean);
 return {...session,text,clarifications,ownInstructions:[...(session.ownInstructions??[]),...ownInstructions]};
}
export function publicOwnerEntries(session,role){
 const projected=projectConversation(session,role);
 return {requestVisibility:role==='buyer'&&splitOwnerText(session.text).privateText?'own':'shared',text:role==='buyer'?session.text:projected.text,clarifications:(session.clarifications??[]).map(c=>c.role===role?{...c,visibility:c.visibility==='private'?'private':splitOwnerText(c.text).privateText?'own':'shared'}:{...c,text:c.visibility==='private'?'':splitOwnerText(c.text).publicText,visibility:'shared'}).filter(c=>c.text)};
}
