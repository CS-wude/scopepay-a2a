import {existsSync,mkdirSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {startCluster} from './start.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');let c;const report={startedAt:new Date().toISOString(),model:process.env.MODEL_NAME,cases:[],scope:'Real A2A dual-mode, isolated owner workspace, no charges'};
try{
 c=await startCluster({root:new URL(`../.scopepay/dual-smoke-${Date.now()}/`,import.meta.url).pathname,port:0,buyerPort:0,sellerPort:0,modelMode:'live',paymentMode:'fixture',env:process.env});const csrf=(await fetch(c.url+'/api/market/bootstrap').then(r=>r.json())).csrf;
 const get=p=>fetch(c.url+p).then(r=>r.json()),post=async(p,b)=>{const r=await fetch(c.url+p,{method:'POST',headers:{Origin:c.url,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(b)});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
 const wait=async id=>{for(let i=0;i<480;i++){const s=(await get('/api/market/workspace?role=buyer')).sessions.find(s=>s.id===id);if(!['ready','negotiating'].includes(s.state))return s;await new Promise(r=>setTimeout(r,500));}throw Error('Timeout');};
 await post('/api/market/buyer/delegation',{capMinor:1500,totalCapMinor:2600,autoPay:true});
 for(const modes of [{buyer:'auto',seller:'auto'},{buyer:'auto',seller:'manual'},{buyer:'manual',seller:'auto'}]){
  for(const role of ['buyer','seller'])await post('/api/market/interaction',{role,mode:modes[role]});
  const clear=modes.buyer==='auto'&&modes.seller==='auto',d=await post('/api/market/seller/services',{title:clear?'海报设计':'视频定制',description:clear?'一张1080x1920黑白简约海报，买家提供文字图片；PNG及可编辑源文件；一轮文字修改；24小时交付；验收核对尺寸文案图片齐全，不含印刷和插画。':'视频定制，具体规格需协商',kind:clear?'设计':'短剧',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:24});
  await post(`/api/market/platform/services/${d.id}/publish`,{version:1,reason:'隔离双模式测试'});
  const r=await post('/api/v2/sessions',{workflow:'dual_mode',requestId:randomUUID(),text:clear?'按服务说明制作海报，文字图片由我提供，其余无特别标准，代表自行协商。':'制作一个40分钟爱情短剧，素材由制片方提供，剧情自然，其余无特别标准。',service:{id:d.id,version:1}}),s=await wait(r.id);report.cases.push({modes,session:s});
  if(clear){assert.equal(s.state,'awaiting_review');assert.equal(s.discussionResult.status,'agreed');for(const role of ['buyer','seller'])await post(`/api/v2/sessions/${s.id}/decision`,{role,revision:s.discussionResult.revision,hash:s.discussionResult.hash,action:'approve'});assert.equal((await wait(s.id)).state,'confirmed');}
  else{assert.equal(s.state,'needs_clarification',JSON.stringify({state:s.state,error:s.error}));assert.equal(modes[s.awaitingRole],'manual');}
  assert.equal(s.payment,null);console.log(JSON.stringify({modes,state:s.state,awaitingRole:s.awaitingRole,messages:s.discussion.length}));
 }
 assert.equal((await get('/api/market/workspace?role=buyer')).budgetUsed,0);report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await c?.close();report.finishedAt=new Date().toISOString();mkdirSync('.evidence',{recursive:true});writeFileSync('.evidence/scopepay-dual-mode-live.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({passed:report.passed,error:report.error}));}
