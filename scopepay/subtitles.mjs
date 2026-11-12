const timing=/^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
export function parseSrt(text){
  if(typeof text!=='string'||text.length>30000||!text.trim())throw new Error('SRT content missing or too large');
  let previous=0;
  return text.replace(/\r/g,'').trim().split(/\n\s*\n/).map((block,i)=>{
    const [number,time,...lines]=block.split('\n'),m=time?.match(timing);
    if(Number(number)!==i+1||!m)throw new Error('Invalid SRT sequence or timing');
    const parts=m.slice(1).map(Number);
    if(parts[1]>59||parts[2]>59||parts[5]>59||parts[6]>59)throw new Error('Invalid timing range');
    const ms=(a)=>a[0]*3600000+a[1]*60000+a[2]*1000+a[3];
    const start=ms(parts.slice(0,4)),end=ms(parts.slice(4));
    if(start<previous||end<=start)throw new Error('Invalid overlapping SRT timing');previous=end;
    const content=lines.join('\n').trim();
    if(content.length<8||content.length>600||/[<>\u0000-\u0008]/.test(content))throw new Error('Empty or insufficient SRT content');
    return {number:i+1,time,text:content,start,end};
  });
}
export function validateSrt(source,target){
  const a=parseSrt(source),b=parseSrt(target);
  if(a.length!==b.length)throw new Error('SRT cue count mismatch');
  if(a.some((cue,i)=>cue.time!==b[i].time))throw new Error('SRT timing changed');
  return {valid:true,cueCount:b.length,durationMs:b.at(-1).end};
}
export function wrapSrt(source,width=42){
  if(!Number.isInteger(width)||width<20||width>80)throw new Error('Invalid subtitle width');
  return parseSrt(source).map(cue=>{
    const lines=[];let line='';
    for(const word of cue.text.split(/\s+/)){
      if(word.length>width)throw new Error('Subtitle word exceeds allowed line length');
      if(line&&line.length+1+word.length>width){lines.push(line);line=word;}else line+=(line?' ':'')+word;
    }
    if(line)lines.push(line);return `${cue.number}\n${cue.time}\n${lines.join('\n')}`;
  }).join('\n\n')+'\n';
}
