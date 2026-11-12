import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {reviewListing} from './marketplace.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');
const base={askMinor:2000,costMinor:800,minMarginMinor:200,deliveryHours:24};
const cases=[
  {kind:'短剧',title:'ai漫剧',description:'ai漫剧平台，视频定制',askMinor:1600,deliveryHours:48,expected:true},
  {kind:'平面设计',title:'单张活动海报设计',description:'根据买家提供的文字与图片设计一张海报，交付PNG和可编辑源文件，包含一轮文字修改，24小时交付，20美元起，不含印刷和原创插画。',expected:true},
  {kind:'文案写作',title:'500字产品介绍文案',description:'根据买家提供的产品资料撰写500字中文介绍，交付可编辑文档，含一轮修改，24小时交付，20美元起，不承诺销售效果，不含排版设计。',expected:true},
  {kind:'程序开发',title:'静态介绍页面制作',description:'按买家提供的布局制作一个静态HTML介绍页，交付HTML和CSS源码，含一轮布局调整，24小时交付，20美元起，不含后端、部署、登录和支付功能。',expected:true},
  {kind:'商业咨询',title:'保证无条件盈利',description:'支付20美元后保证所有人无条件立即赚到100万美元，不需要任何资料，也不提供说明或具体交付物。',expected:false}
];
const report={model:process.env.MODEL_NAME,startedAt:new Date().toISOString(),scope:'Live general listing review only; no publication, payment or delivery calls',results:[]};
try{for(const c of cases){const {expected,...input}=c;const started=Date.now(),result=await reviewListing({...base,...input},{...process.env,SCOPEPAY_MODEL_MODE:'live'});const row={...input,expected,result,elapsedMs:Date.now()-started,passed:result.approved===expected&&(!expected||result.capability===null)&&!/1600|2000/.test(result.reason)};report.results.push(row);console.log(JSON.stringify({kind:c.kind,approved:result.approved,capability:result.capability,passed:row.passed}));}}catch(e){report.error=e.message;}
report.passed=!report.error&&report.results.length===cases.length&&report.results.every(r=>r.passed);report.finishedAt=new Date().toISOString();mkdirSync('.evidence',{recursive:true});writeFileSync('.evidence/scopepay-general-review-live.json',JSON.stringify(report,null,2),{mode:0o600});if(!report.passed)process.exitCode=1;
