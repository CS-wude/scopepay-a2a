import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const url=process.env.SCOPEPAY_URL??'http://127.0.0.1:8980';
try{
  const get=async()=>{const r=await fetch(url+'/api/state');if(!r.ok)throw new Error('Observer unavailable');return r.json();};
  let state=await get();if(state.app!=='ScopePay A2A')throw new Error('Wrong local application');
  const requestId=`scopepay-engineering-${state.paymentMode}-${state.modelMode}-v1`;
  const r=await fetch(url+'/api/runs',{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify({requestId,caseId:'standard'})});
  if(!r.ok)throw new Error((await r.json()).error);const run=await r.json();
  let result;
  for(let i=0;i<240;i++){
    state=await get();result=state.runs.find(x=>x.id===run.id);
    if(!['running','requested','paid'].includes(result.state))break;
    await new Promise(r=>setTimeout(r,1000));
  }
  if(result.state!=='accepted'||!result.receipt?.verified||result.receipt.amountMinor!==1000||!result.review?.value?.accepted||!result.srt)throw new Error(`Engineering run incomplete: ${result.state}. Inspect the observer; do not start another sale.`);
  const file=await fetch(`${url}/api/runs/${run.id}/subtitle`);if(!file.ok)throw new Error('Accepted artifact unavailable');
  const evidence={checkedAt:new Date().toISOString(),modelMode:state.modelMode,paymentMode:state.paymentMode,agents:state.agents.map(a=>({role:a.role,pid:a.pid,url:a.url})),run:result};
  const evidenceDir=new URL('../.evidence/',import.meta.url);await mkdir(evidenceDir,{recursive:true,mode:0o700});
  const destination=new URL(`scopepay-${state.paymentMode}-${state.modelMode}.json`,evidenceDir);await writeFile(destination,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({runId:run.id,modelMode:state.modelMode,paymentMode:state.paymentMode,receipt:result.receipt,modelCalls:result.modelCalls,quoteAmounts:result.events.filter(e=>e.type==='quote').map(e=>e.amountMinor),artifact:'aurora.fr.srt',evidence:fileURLToPath(destination)},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
