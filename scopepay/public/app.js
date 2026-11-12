import {requestId} from './request-id.mjs';
const $=id=>document.getElementById(id),money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((v??0)/100);
let state,selected,loadedPolicy=false,pending=false,lastSignature='';
const labels={requested:'Requested',running:'Agents working',paid:'Paid · delivering',accepted:'Accepted',rejected:'Declined',failed:'Stopped',payment_unknown:'Payment unresolved',paid_delivery_failed:'Paid · delivery needs review',interrupted:'Interrupted'};
async function api(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error??'Request failed');return value;}
function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
function eventView(e){
  const row=node('li',`event ${e.agent==='seller'?'seller-event':''}`),dot=node('span','event-dot',e.agent==='seller'?'C':'B'),content=node('div');
  let title='',detail='';
  if(e.type==='quote'){title=`Creator quotes ${money(e.amountMinor)}`;detail=e.selection.rush?'French subtitles $10 + rush $5. Color revision included.':'French subtitles $10. Color revision included. Standard delivery.';if(e.amountMinor===0)detail='Included scope amendment. No payment processor call.';}
  if(e.type==='decision'){title=e.decision==='counter'?'Buyer proposes standard delivery':e.decision==='accept'?'Buyer accepts the exact scope':'Buyer declines the quote';detail=e.reason;}
  if(e.type==='authorization'){title='Buyer signs the change order';detail=`${money(e.amountMinor)} authorized under owner policy v${e.policyVersion}. No per-payment human confirmation.`;}
  if(e.type==='delivery'){title='Creator delivers the work';detail=e.subtitleCues?'French SRT, five cues with preserved timing.':'Scope amendment recorded; no video rendering claimed.';}
  if(e.type==='review'){title=e.accepted?'Buyer accepts delivery':'Delivery needs review';detail=e.reason;}
  if(e.type==='a2a'){title=`A2A · ${{quote_request:'quote request',repair:'delivery correction',accept_and_deliver:'accept & deliver'}[e.operation]??e.operation}`;detail=`${e.direction} · task ${e.taskId?.slice(0,8)} · context ${e.contextId?.slice(0,8)}`;}
  const heading=node('div','event-title');heading.append(node('strong','',title),node('small','',new Date(e.at).toLocaleTimeString('en-US',{hour12:false})));content.append(heading,node('p','',detail));
  if(e.quoteHash)content.append(node('div','event-detail',`quote${e.quoteVersion?` v${e.quoteVersion}`:''} / sha256 ${e.quoteHash.slice(0,18)}…`));
  row.append(dot,content);return row;
}
function render(){
  $('model-badge').textContent=`Model: ${state.modelMode==='fixture'?'FIXTURE / offline':'LIVE'}`;
  $('payment-badge').textContent=`Payments: ${state.paymentMode==='sandbox'?'BRAINTREE SANDBOX':'FIXTURE / no PSP'}`;
  $('network-badge').textContent=`Agents: ${state.agentError?'process stopped':`${state.agents.length} separate processes · A2A 1.0`}`;
  $('mode-note').textContent=state.agentError??(state.modelMode==='fixture'?'Engineering demo: decisions and French copy use labeled fixtures. Configure a model to validate real AI reasoning.':'Live model enabled. Each agent remains bound by deterministic owner authorization.');
  $('version').textContent=`v${state.project.version}`;
  $('budget-note').textContent=`Reserved / spent: ${money(state.budgetUsed)} of ${money(state.policies.buyer.totalCapMinor)}`;
  if(!loadedPolicy){$('single-cap').value=state.policies.buyer.singleCapMinor/100;$('total-cap').value=state.policies.buyer.totalCapMinor/100;$('require-french').checked=state.policies.buyer.required.includes('french_subtitles');$('allow-standard').checked=state.policies.buyer.allowStandard;loadedPolicy=true;}
  const run=state.runs.find(r=>r.id===selected)??state.runs.find(r=>r.projectId===state.project.id);if(run)selected=run.id;
  const active=state.runs.some(r=>['running','paid','requested'].includes(r.state));
  $('start').disabled=pending||active||state.paused||state.runs.some(r=>r.projectId===state.project.id);$('new-project').disabled=pending||active;$('pause').textContent=state.paused?'Resume new payments':'Pause new payments';
  $('run-state').textContent=run?labels[run.state]??run.state:'Ready';$('empty-state').hidden=!!run;
  $('run-reference').textContent=run?`run / ${run.id.slice(0,8)} · calls ${run.modelCalls??0}/8`:'No active run';
  $('run-error').textContent=run?.error?`${run.stage?`[${run.stage}] `:''}${run.error}`:(run?.state==='rejected'?run.reason:'')??'';
  const signature=JSON.stringify([selected,run?.events]);if(signature!==lastSignature){$('timeline').replaceChildren(...(run?.events??[]).map(eventView));lastSignature=signature;}
  const receipt=run?.receipt;$('receipt').hidden=!receipt;
  if(receipt){const box=$('receipt');box.replaceChildren();const top=node('div','receipt-head'),left=node('div');left.append(node('p','eyebrow',receipt.amountMinor===0?'INCLUDED CHANGE · NO CHARGE':'PAYMENT VERIFIED'),node('p','',`${receipt.provider} · ${receipt.status}`));top.append(left,node('span','receipt-amount',money(receipt.amountMinor)));box.append(top,node('p','',`Transaction: ${receipt.transactionId}`),node('p','',`Scope v${run.quote?.payload?.baseVersion??1} → v${(run.quote?.payload?.baseVersion??1)+1} · quote ${receipt.quoteHash.slice(0,16)}…`));if(receipt.amountMinor>0&&!receipt.settled)box.append(node('p','',`Current status is ${receipt.status}; final settlement has not been confirmed.`));}
  $('delivery').hidden=!(run?.state==='accepted'&&run.srt);
  if(run?.srt){$('subtitle-preview').textContent=run.srt;$('download').href=`/api/runs/${encodeURIComponent(run.id)}/subtitle`;$('delivery-note').textContent=`${run.structure?.cueCount??5} cues · timing validated · semantic review: ${run.review?.source}. Model: ${run.modelMode}.`;}
  $('recover').hidden=!run?.payment||active;$('recover').disabled=pending;
  $('history-list').replaceChildren(...state.runs.map(r=>{const button=node('button','history-item');button.append(node('span','',`${new Date(r.created).toLocaleString()} / ${r.id.slice(0,8)}`),node('span','',`${labels[r.state]??r.state} · ${r.receipt?money(r.receipt.amountMinor):'—'}`));button.addEventListener('click',()=>{selected=r.id;render();});return button;}));
}
async function refresh(){try{state=await api('/api/state');render();}catch(e){$('notice').textContent=e.message;}}
async function action(work){if(pending)return;pending=true;$('notice').textContent='';try{await work();await refresh();}catch(e){$('notice').textContent=e.message;}finally{pending=false;if(state)render();}}
$('start').addEventListener('click',()=>action(async()=>{const run=await api('/api/runs',{requestId:requestId(),caseId:$('case-select').value});selected=run.id;}));
$('pause').addEventListener('click',()=>action(()=>api('/api/pause',{paused:!state.paused})));
$('new-project').addEventListener('click',()=>action(async()=>{await api('/api/project',{});selected=null;}));
$('recover').addEventListener('click',()=>action(()=>api(`/api/runs/${encodeURIComponent(selected)}/recover`,{})));
$('policy-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{await api('/api/policies',{singleCapMinor:Math.round(Number($('single-cap').value)*100),totalCapMinor:Math.round(Number($('total-cap').value)*100),requireFrench:$('require-french').checked,allowStandard:$('allow-standard').checked});loadedPolicy=false;});});
refresh();setInterval(refresh,1200);
