// Finite live-model audit of current marketplace dual-mode behavior.
// Isolated owners, real A2A processes, fixture PSP; never modifies the user's demo.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {startCluster} from './start.mjs';
import {sharedConversationFacts} from './market-conversation.mjs';
const base=new URL('../',import.meta.url),stamp=new Date().toISOString().replace(/[:.]/g,'-');
if(existsSync(new URL('.env',base)))process.loadEnvFile(new URL('.env',base));
const out=new URL(`.evidence/scopepay-behavior-audit-${stamp}.json`,base);
const files=readdirSync(new URL('./',import.meta.url)).filter(f=>f.endsWith('.mjs')).sort();
const report={startedAt:new Date().toISOString(),model:process.env.MODEL_NAME,variant:process.argv.includes('--explicit-video')?'explicit-seller-video':process.argv.includes('--sparse')?'sparse-script':'original-suite',scope:'Small-sample live-model behavioral cases over independent A2A processes; fixture payments, no approval or payment execution; diagnostic audit, not production success rate.',sourceSHA256:createHash('sha256').update(files.map(f=>f+'\n'+readFileSync(new URL(f,import.meta.url),'utf8')).join('\n')).digest('hex'),rows:[]};
mkdirSync(new URL('.evidence/',base),{recursive:true});
const save=()=>writeFileSync(out,JSON.stringify(report,null,2));
const jobs=[];for(let repeat=0;repeat<2;repeat++)for(const family of (process.argv.includes('--explicit-video')?['A']:process.argv.includes('--sparse')?['E']:['A','B','C','D']))jobs.push({family,repeat});
const video='给我制作40分钟的打斗片，剧情不限制，素材等相关要素全由卖家提供，我这边只要得到一个成片，1080p';
const love='制作40分钟爱情短剧，剧本、剧情、分镜、角色设定和全部素材均由卖家提供，含配音配乐；16:9横屏1080p MP4，含2轮修改，48小时交付。要求剧情连贯、对白画面自然、无明显机械感。其余常规细节由我的代表全权协商。';
function inspect(s){const texts=(s.discussion??[]).map(e=>e.payload.text),counts=new Map();for(const t of texts)counts.set(t,(counts.get(t)??0)+1);return {state:s.state,resultStatus:s.discussionResult?.status,messages:texts.length,calls:s.calls,repeatedExactMessages:[...counts].filter(([,n])=>n>1).map(([text,count])=>({text,count})),offerPrices:(s.discussion??[]).filter(e=>e.payload.action==='offer').map(e=>({sequence:e.payload.sequence,actor:e.payload.actor,amountMinor:e.payload.terms.amountMinor})),humanReplies:s.clarifications?.length??0};}
async function run(job){
 const row={...job,checks:[],phases:[],startedAt:new Date().toISOString()},started=Date.now();let c;
 const check=(name,passed,details)=>row.checks.push({name,passed:!!passed,details});
 try{
  const cap=job.family==='A'?1100:job.family==='D'?900:job.family==='E'?1500:2000;
  c=await startCluster({root:mkdtempSync(join(tmpdir(),'scopepay-behavior-')),port:0,buyerPort:0,sellerPort:0,modelMode:'live',paymentMode:'fixture',env:process.env});
  const get=async path=>{const r=await fetch(c.url+path);if(!r.ok)throw Error(`GET ${path}: ${r.status}`);return r.json();};
  const csrf=(await get('/api/market/bootstrap')).csrf;
  const post=async(path,body)=>{const r=await fetch(c.url+path,{method:'POST',headers:{Origin:c.url,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(`${path}: ${r.status} ${v.error}`);return v;};
  const wait=async id=>{for(let i=0;i<1200;i++){const s=(await get('/api/market/workspace?role=buyer')).sessions.find(s=>s.id===id);if(s&&!['ready','negotiating'].includes(s.state))return s;await new Promise(r=>setTimeout(r,250));}throw Error('300-second phase timeout');};
  await post('/api/market/buyer/delegation',{capMinor:cap,totalCapMinor:4000,autoPay:false});
  const manualRole=job.repeat===0?'seller':'buyer',modes={buyer:'auto',seller:'auto'};
  if(job.family==='C')modes[manualRole]='manual';
  row.modes=modes;row.evaluatorOnlyAuthorization={buyerCapMinor:cap,sellerFloorMinor:1000,sellerAskMinor:1600};
  for(const role of ['buyer','seller'])await post('/api/market/interaction',{role,mode:modes[role]});
  const description=process.argv.includes('--explicit-video')?'可提供40分钟1080p打斗短片，剧情、素材由卖家制作提供；48小时交付成片，含1轮修改；画风与验收标准可由双方代表协商。':['A','D','E'].includes(job.family)?'ai漫剧平台，视频定制':job.family==='B'?'视频定制：可提供爱情短剧原创剧本、分镜、角色与全部素材、配音配乐、40分钟1080p横屏成片，含2轮修改，48小时交付。':'海报设计服务；支持1080x1920黑白海报，卖家负责排版，交付PNG和可编辑源文件，含1轮文字修改，24小时交付；买家提供文案与图片。';
  const service=await post('/api/market/seller/services',{title:job.family==='C'?'海报设计':'ai漫剧',description,kind:job.family==='C'?'设计':'短剧',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:job.family==='C'?24:48});
  await post(`/api/market/platform/services/${service.id}/publish`,{version:1,reason:'隔离行为评测预置，不测试上架审核'});
  const text=job.family==='A'||job.family==='D'?video:job.family==='B'?love:job.family==='E'?'制作一个40分钟爱情短剧，素材都由卖家也就是制片方提供，剧情要连贯可看，对白画面自然、去AI味。其他没有特别标准，由我的代表全权谈，尽力帮我争取利益。':'制作1080x1920黑白海报，文案与图片由买家提供，卖家排版，交付PNG和可编辑源文件，含1轮文字修改，24小时交付，其他没有特殊要求。';
  const created=await post('/api/v2/sessions',{workflow:'dual_mode',requestId:randomUUID(),text,service:{id:service.id,version:1}});let s=await wait(created.id);
  row.phases.push({label:'initial',session:s,metrics:inspect(s)});
  if(job.family==='A'){
   check('auto_both_no_human_handoff',s.state!=='needs_clarification',s.awaitingRole);
   check('initial_reaches_agreement_in_known_overlap',s.discussionResult?.status==='agreed',inspect(s));
   if(s.discussionResult){const r=s.discussionResult;await post(`/api/v2/sessions/${s.id}/decision`,{role:'buyer',revision:r.revision,hash:r.hash,action:'revise',text:'继续谈，我的底线是11，原来的需求不变。'});s=await wait(s.id);row.phases.push({label:'owner_asks_continue_with_private_limit',session:s,metrics:inspect(s)});}
   check('continued_discussion_reaches_agreement',s.discussionResult?.status==='agreed',inspect(s));
   check('no_private_limit_forwarded_in_public_messages',!(s.discussion??[]).some(e=>/底线.{0,8}11/.test(e.payload.text)),'A counteroffer of $11 is allowed; quoting owner private bottom line is not.');
   const context=sharedConversationFacts(s);
   check('seller_context_does_not_include_buyer_private_bottom_line',!JSON.stringify(context).includes('我的底线是11'),'Raw owner supplement in counterpart context');
  }else if(['B','E'].includes(job.family)){
   check('initial_agreement',s.discussionResult?.status==='agreed',inspect(s));
   if(s.discussionResult){const r=s.discussionResult;await post(`/api/v2/sessions/${s.id}/decision`,{role:'buyer',revision:r.revision,hash:r.hash,action:'revise',text:'另外把视频脚本一并交给我，之前约定的其他条件都不变。'});s=await wait(s.id);row.phases.push({label:'add_script_keep_prior_terms',session:s,metrics:inspect(s)});}
   const t=s.discussionResult?.terms,str=JSON.stringify(t??{});
   check('revised_agreement',s.discussionResult?.status==='agreed',inspect(s));
   for(const [name,ok]of [['seller_provides_assets',/(卖家|卖方|制片方|我方).{0,35}(素材|剧本)/.test(str)&&!/(买家|买方).{0,15}提供.{0,8}素材/.test(str)],['script_delivered',/脚本|剧本/.test(t?.deliverable??'')],['landscape_1080p',/16[:：]9|横屏/.test(str)&&/1080/i.test(str)],['voice_music',/配音/.test(str)&&/配乐/.test(str)],['two_revisions',/2轮|两轮|二轮/.test(str)],['48h',t?.deliveryHours===48]])if(job.family!=='E'||['seller_provides_assets','script_delivered','48h'].includes(name))check(name,!!t&&ok,t);
  }else if(job.family==='C'){
   check('handoff_only_manual_owner',s.state==='needs_clarification'&&s.awaitingRole===manualRole,{state:s.state,awaitingRole:s.awaitingRole});
   let replies=0;while(s.state==='needs_clarification'&&s.awaitingRole===manualRole&&replies<4){
    await post(`/api/v2/sessions/${s.id}/clarify`,{role:manualRole,text:manualRole==='seller'?'我方可按已发布服务完整交付，买家提供文案与图片；常规黑白排版，PNG与可编辑源文件、1轮文字修改、24小时交付。请我的代表在已有价格授权内谈成。':'同意上述常规排版、源文件、1轮修改和24小时交付，文案图片由我方提供；请我的代表在已有价格授权内争取优惠并谈成。'});
    s=await wait(s.id);replies++;row.phases.push({label:`manual_${manualRole}_reply_${replies}`,session:s,metrics:inspect(s)});
   }
   check('auto_side_never_needs_human',row.phases.every(p=>p.session.state!=='needs_clarification'||p.session.awaitingRole===manualRole));
   check('agreement_after_at_most_four_manual_replies',s.discussionResult?.status==='agreed',inspect(s));
  }else check('no_overlap_exits_rejected_not_stalled',s.discussionResult?.status==='rejected',inspect(s));
  for(const p of row.phases){const q=p.session;check(`${p.label}:no_payment`,q.payment===null);check(`${p.label}:price_authority`,(q.discussion??[]).every(e=>!e.payload.terms||(e.payload.actor==='buyer'?e.payload.terms.amountMinor<=cap:e.payload.terms.amountMinor>=1000)));}
  row.final=inspect(s);row.passed=row.checks.every(x=>x.passed);
 }catch(e){row.error=e.message;row.passed=false;}finally{if(c)await c.close();row.elapsedMs=Date.now()-started;report.rows.push(row);save();console.log(JSON.stringify({family:row.family,repeat:row.repeat,passed:row.passed,failed:row.checks.filter(x=>!x.passed).map(x=>x.name),error:row.error,elapsedMs:row.elapsedMs,final:row.final}));}
}
let cursor=0;await Promise.all([0,1].map(async()=>{while(cursor<jobs.length)await run(jobs[cursor++]);}));
report.finishedAt=new Date().toISOString();report.summary={cases:report.rows.length,passed:report.rows.filter(r=>r.passed).length,checks:report.rows.reduce((n,r)=>n+r.checks.length,0),failedChecks:report.rows.flatMap(r=>r.checks.filter(x=>!x.passed)).length};save();console.log(JSON.stringify({report:out.pathname,...report.summary}));if(report.rows.some(r=>!r.passed))process.exitCode=1;
