import {isDeepStrictEqual} from 'node:util';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function dominatedCounteroffers(discussion){
 const witnesses=[];let previous;
 for(const {payload:m} of discussion??[]){
  if(m.actor==='buyer'&&m.action==='offer'&&previous?.actor==='seller'&&previous.action==='offer'){
   const {amountMinor:buyerPrice,...buyerTerms}=m.terms;
   const {amountMinor:sellerPrice,...sellerTerms}=previous.terms;
   if(buyerPrice>sellerPrice&&isDeepStrictEqual(buyerTerms,sellerTerms))witnesses.push({sellerSequence:previous.sequence,buyerSequence:m.sequence,sellerPrice,buyerPrice,terms:buyerTerms});
  }
  previous=m;
 }
 return witnesses;
}
export function assessBehavior(reports){
 const rows=reports.flatMap(r=>r.rows.map(row=>{
  const latest=row.phases.at(-1)?.session,witnesses=dominatedCounteroffers(latest?.discussion),checks=[...row.checks,{name:'no_dominated_buyer_counteroffer',passed:!witnesses.length,details:witnesses}];
  return {...row,checks,passed:!row.error&&checks.every(c=>c.passed)};
 }));
 return {createdAt:new Date().toISOString(),scope:'Live behavior reports plus post-run independent economic rationality check. Added check detects a buyer increasing the price for exactly the same counterpart terms; it does not claim optimal negotiation.',inputs:reports.map(r=>({startedAt:r.startedAt,model:r.model,sourceSHA256:r.sourceSHA256,summary:r.summary})),rows,summary:{cases:rows.length,passed:rows.filter(r=>r.passed).length,checks:rows.reduce((n,r)=>n+r.checks.length,0),failedChecks:rows.flatMap(r=>r.checks.filter(c=>!c.passed)).length,groups:[...new Set(rows.map(r=>r.family))].sort().map(family=>({family,runs:rows.filter(r=>r.family===family).length,passed:rows.filter(r=>r.family===family&&r.passed).length}))}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=assessBehavior(process.argv.slice(3).map(f=>JSON.parse(readFileSync(f,'utf8'))));writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));}
