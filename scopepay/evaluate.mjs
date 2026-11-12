// Offline evaluator owns synthetic truth; runtime Negotiators see only their side.
import {writeFileSync} from 'node:fs';
import {createIdentity} from './identity.mjs';
import {Negotiator,candidates,evaluate} from './negotiation.mjs';

function scenario(id,seed){
  const shift=seed*10;
  let options=id==='B2'?[['fast',2400,1400],['standard',2200,800],['revision',2500,1100]]:
    id==='B6'?[['F',2000,800],['FG',2100,1000],['FR',2100,1000],['FGR',3000,1200]]:[['standard',2200,1200]];
  const domain={id:'synthetic-change',version:1,contractVersion:1,currency:'USD',priceMinMinor:id==='B6'?1000:800,priceMaxMinor:id==='B1'||id==='B5'?2400:2000,priceStepMinor:100,required:['french'],packages:options.map(([id])=>({id,scope:['french'],dueAt:id==='fast'?150000:200000,extraRevisions:id==='revision'?1:0}))};
  const buyer={role:'buyer',version:1,capMinor:id==='B3'?1200:2000,remainingMinor:2000,latestDueAt:200000,disagreementMinor:0,values:Object.fromEntries(options.map(([id,v])=>[id,v+shift]))};
  const seller={role:'seller',version:1,minMarginMinor:['B1','B3','B5'].includes(id)?300:100,disagreementMinor:0,costs:Object.fromEntries(options.map(([id,,c])=>[id,(id==='B3'?1300:c)+shift])),available:options.map(x=>x[0])};
  if(id==='B4'){domain.packages[0].id='today';domain.packages[0].dueAt=150000;buyer.values={today:2400+shift};seller.costs={today:1400+shift};seller.available=['today'];buyer.latestDueAt=150000;}
  return {domain,buyer,seller};
}
function simulate(f,beta,strategy){
  const b=createIdentity('buyer'),s=createIdentity('seller'),shared={domain:f.domain,sessionId:'offline-run',expiresAt:300000,maxTurns:12};
  const agents={buyer:new Negotiator({...shared,policy:f.buyer,identity:b,peer:s,beta:1,acceptFirst:strategy==='accept_first'}),seller:new Negotiator({...shared,policy:f.seller,identity:s,peer:b,beta,acceptFirst:strategy==='accept_first'})};
  if(strategy==='price_only')for(const agent of Object.values(agents))agent.options=agent.options.filter(c=>c.packageId===f.domain.packages[0].id);
  let role='seller',result=agents.seller.act(null,100000),messages=1;
  while(result.message&&messages<16){role=role==='seller'?'buyer':'seller';result=agents[role].act(result.message,100000);if(result.message)messages++;}
  return {...result,messages};
}
export function runEvaluation(seedOffset=0,strategy='package'){
  const rows=[];
  for(const id of ['B1','B2','B3','B4','B5','B6'])for(let seed=0;seed<10;seed++)for(let repeat=0;repeat<3;repeat++){
    const f=scenario(id,seed+seedOffset),all=candidates(f.domain,f.buyer).flatMap(c=>{const s=evaluate(f.domain,f.seller,{packageId:c.packageId,amountMinor:c.amountMinor});return s===null?[]:[{...c,s,n:c.utility*s}];});
    const result=simulate(f,id==='B5'?[.2,1,3][repeat]:1,strategy),agreed=result.state==='agreed';
    let b=null,s=null,n=0,pareto=false;
    if(agreed){b=evaluate(f.domain,f.buyer,result.candidate);s=evaluate(f.domain,f.seller,result.candidate);if(b!==null&&s!==null){n=b*s;pareto=!all.some(c=>c.utility>=b&&c.s>=s&&(c.utility>b||c.s>s));}}
    const optimum=Math.max(0,...all.map(c=>c.n));
    rows.push({id,seed,repeat,terminal:result.state,candidate:result.candidate,messages:result.messages,feasible:all.length>0,correct:all.length>0?agreed&&b!==null&&s!==null:!agreed,hardViolation:agreed&&(b===null||s===null),pareto,score:optimum?n/optimum:null});
  }
  return {strategy,seedOffset,scope:'Offline deterministic negotiation only; no A2A, model or PSP calls. Six B-domain families, not full 18-case acceptance.',runs:rows.length,groups:['B1','B2','B3','B4','B5','B6'].map(id=>{const r=rows.filter(x=>x.id===id),numeric=r.filter(x=>x.score!==null);return {id,runs:r.length,correct:r.filter(x=>x.correct).length,hardViolations:r.filter(x=>x.hardViolation).length,agreed:r.filter(x=>x.terminal==='agreed').length,pareto:r.filter(x=>x.pareto).length,meanScore:numeric.length?numeric.reduce((a,x)=>a+x.score,0)/numeric.length:null};}),rows};
}
if(import.meta.url===new URL(process.argv[1],'file:').href){
  const report=runEvaluation(Number(process.argv[3]??0),process.argv[4]??'package');if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2));
  console.log(JSON.stringify({scope:report.scope,runs:report.runs,groups:report.groups},null,2));
  if(report.rows.some(x=>x.hardViolation))process.exitCode=1;
}
