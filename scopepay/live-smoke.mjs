import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:8994';
const initial=await fetch(base+'/api/state').then(r=>r.json());
const get=()=>fetch(base+'/api/v2/state').then(r=>r.json());
const post=async(path,body={})=>{const r=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':initial.csrf},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(v.error??'Local operation failed');return v;};
const first=await get();if(first.paymentMode!=='fixture'||first.modelMode!=='live_assisted')throw new Error('This smoke only uses real models with isolated fixture payments');
async function configure(extra={}){const state=await get();await post('/api/v2/owners',{...state.owners,capMinor:2000,totalCapMinor:state.budgetUsed+4000,standardCost:800,rushCost:1400,revisionCost:1100,minMarginMinor:100,requireToday:false,allowStandard:true,autoPay:true,...extra});}
async function request(text){
  const start=Date.now(),created=await post('/api/v2/sessions',{requestId:randomUUID(),text});
  for(let i=0;i<600;i++){
    const s=(await get()).sessions.find(x=>x.id===created.id);
    if(!['ready','negotiating','agreed','paying','paid'].includes(s?.state))return {id:s.id,state:s.state,intent:s.intent,calls:s.calls,candidate:s.candidate,paymentState:s.payment?.state,deliveryMode:s.delivery?.mode,reviewAccepted:s.delivery?.review?.accepted,elapsedMs:Date.now()-start};
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('Live smoke timeout');
}
const results=[];
for(let repeat=0;repeat<3;repeat++){
  await configure();await post('/api/v2/project');
  const a=await request(['调蓝一点，加法语字幕，最好今晚给','希望调成蓝色并补法语字幕，能今天给最好，明天也可以','把颜色调蓝，添加法语字幕，倾向今晚交付但接受明天'][repeat]);
  results.push({family:'A',repeat,...a,passed:a.state==='delivered'&&a.reviewAccepted===true&&a.intent.rush===true&&!a.intent.mandatoryToday});console.log(JSON.stringify(results.at(-1)));
  await configure();await post('/api/v2/project');
  const b=await request(['加法语字幕，今晚必须交付','法语字幕今天务必给我','添加法语字幕，必须今天完成'][repeat]);
  results.push({family:'B',repeat,...b,passed:b.state==='delivered'&&b.candidate?.packageId==='today'&&b.intent.mandatoryToday});console.log(JSON.stringify(results.at(-1)));
  await configure();await post('/api/v2/project');
  const before=await get();await post('/api/v2/owners',{...before.owners,totalCapMinor:before.budgetUsed+2000});
  const firstChange=await request('加法语字幕，明天交付即可');
  const remaining=2000-((await get()).budgetUsed-before.budgetUsed);
  const c=await request(['压缩字幕行长','调整字幕换行，压缩每行长度','请把字幕行长压缩一下'][repeat]);
  results.push({family:'C',repeat,...c,remainingBefore:remaining,passed:firstChange.state==='delivered'&&c.state==='delivered'&&c.candidate.amountMinor<=remaining});console.log(JSON.stringify(results.at(-1)));
}
await configure();
const report={scope:'Nine live-model pilot cases, three repetitions per class. Real A2A; fixture payments. Not the full 18-case acceptance campaign.',results,passed:results.filter(r=>r.passed).length,total:results.length};
writeFileSync('.evidence/scopepay-v2-live-pilot.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,total:report.total}));if(report.passed!==report.total)process.exitCode=1;
