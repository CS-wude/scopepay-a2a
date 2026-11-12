import {SOURCE_SRT} from './fixtures.mjs';
import {randomUUID} from 'node:crypto';
import {digest} from './identity.mjs';
import {parseSrt} from './subtitles.mjs';
const fields=['title','agreementText','durationSeconds','subtitleLanguage','colorAllowance','frenchMinor','rushMinor','extraColorMinor','standardHours','rushHours','sourceSrt','priorColorUses'];
export function validateContract(input){
 input={priorColorUses:[],...input};
 if(!input||Object.keys(input).sort().join(',')!==[...fields].sort().join(','))throw Error('原委托字段不完整');
 for(const k of ['title','agreementText','sourceSrt'])if(typeof input[k]!=='string'||input[k].length>(k==='sourceSrt'?16000:k==='title'?80:2000)||!input[k].trim())throw Error('请填写原委托名称、条款和原字幕');
 if(!Number.isInteger(input.durationSeconds)||input.durationSeconds<1||input.durationSeconds>3600||!Number.isInteger(input.colorAllowance)||input.colorAllowance<0||input.colorAllowance>20)throw Error('原片长度或调色次数无效');
 if(input.subtitleLanguage!==null&&(typeof input.subtitleLanguage!=='string'||!input.subtitleLanguage.trim()||input.subtitleLanguage.length>50))throw Error('请明确原字幕语言，无法确认时保留未明确');
 for(const k of ['frenchMinor','rushMinor','extraColorMinor'])if(!Number.isSafeInteger(input[k])||input[k]<0||input[k]>2400||input[k]%100)throw Error('价目须为0至24美元的整数美元');
 if(![24,48].includes(input.standardHours)||![1,2,4,6,12].includes(input.rushHours))throw Error('标准或加急交期无效');
 if(!Array.isArray(input.priorColorUses)||input.priorColorUses.length>input.colorAllowance||input.priorColorUses.some(x=>typeof x!=='string'||!x.trim()||x.length>300))throw Error('既往调色记录须有依据，且不能超过原包含次数');
 const cues=parseSrt(input.sourceSrt);if(cues.at(-1)?.end>input.durationSeconds*1000)throw Error('原字幕时间轴超过原片时长');if(!cues.length)throw Error('原字幕无效');
 return structuredClone(input);
}
export function contractContent(c){return Object.fromEntries(fields.map(k=>[k,k==='priorColorUses'?(c[k]??[]):c[k]]));}
export const contractHash=c=>digest({id:c.id,version:c.version,...contractContent(c)});
export function mountServiceContracts(app,{store,blocked=()=>false}){
 const db=store.db;db.exec('CREATE TABLE IF NOT EXISTS service_contracts(id TEXT PRIMARY KEY,doc TEXT NOT NULL)');
 app.get('/api/market/contracts/template',(_req,res)=>res.json({title:'示例：30秒产品视频',agreementText:'30秒产品视频，包含一次调色和英文字幕。新增法语字幕10美元，加急5美元；免费额度外调色4美元，须另行授权。',durationSeconds:30,subtitleLanguage:'English',colorAllowance:1,priorColorUses:[],frenchMinor:1000,rushMinor:500,extraColorMinor:400,standardHours:24,rushHours:6,sourceSrt:SOURCE_SRT}));
 const load=id=>{const row=db.prepare('SELECT doc FROM service_contracts WHERE id=?').get(id);return row?JSON.parse(row.doc):null;};
 const save=c=>{db.prepare('INSERT OR REPLACE INTO service_contracts VALUES(?,?)').run(c.id,JSON.stringify(c));return c;};
 const usage=c=>Object.values(c.allocations??{}).filter(x=>x.state!=='released').reduce((n,x)=>n+x.color,0);
 const view=c=>({...c,frenchIncluded:Object.values(c.allocations??{}).some(x=>x.french&&x.state==='committed'),pendingFrench:Object.values(c.allocations??{}).some(x=>x.french&&x.state==='reserved'),colorRemaining:Math.max(0,c.colorAllowance-(c.priorColorUses?.length??0)-usage(c)),contentHash:contractHash(c)});
 const resolve=ref=>{const c=load(ref?.id);if(!c||c.version!==ref.version||c.status!=='active')throw Error('原委托版本无效或尚未由双方确认');return view(c);};
 app.get('/api/market/contracts',(req,res)=>{if(!['buyer','seller'].includes(req.query.role))return res.status(400).json({error:'请选择买家或卖家视角'});res.json(db.prepare('SELECT doc FROM service_contracts ORDER BY rowid DESC').all().map(r=>view(JSON.parse(r.doc))));});
 app.post('/api/market/contracts',(req,res)=>{try{const {role,contract}=req.body;if(Object.keys(req.body).sort().join(',')!=='contract,role'||!['buyer','seller'].includes(role))throw Error('原委托来源无效');const data=validateContract(contract),c={...data,id:randomUUID(),version:1,status:'pending',confirmations:{[role]:{version:1,at:Date.now()}},allocations:{},history:[],createdAt:Date.now()};res.status(201).json(view(save(c)));}catch(e){res.status(400).json({error:e.message});}});
 app.post('/api/market/contracts/:id/confirm',(req,res)=>{try{const c=load(req.params.id),{role,version}=req.body;if(!c||Object.keys(req.body).sort().join(',')!=='role,version'||!['buyer','seller'].includes(role)||version!==c.version)throw Error('原委托版本已变化');const confirmations={...c.confirmations,[role]:{version,at:Date.now(),contentHash:contractHash(c)}};res.json(view(save({...c,confirmations,status:confirmations.buyer&&confirmations.seller?'active':'pending'})));}catch(e){res.status(409).json({error:e.message});}});
 app.post('/api/market/contracts/:id/edit',(req,res)=>{try{const c=load(req.params.id),{role,version,contract}=req.body;if(!c||Object.keys(req.body).sort().join(',')!=='contract,role,version'||!['buyer','seller'].includes(role)||version!==c.version||usage(c)||blocked(c.id))throw Error('原委托已有占用或交易，不能覆盖历史；请保留原件另行记录补充约定');const data=validateContract(contract),v=version+1;res.json(view(save({...c,...data,version:v,status:'pending',confirmations:{[role]:{version:v,at:Date.now()}},history:[...c.history,{version,content:contractContent(c),confirmations:c.confirmations,hash:contractHash(c)}]})));}catch(e){res.status(409).json({error:e.message});}});
 function reserve(ref,runId,color,french=false){const c=resolve(ref),latest=load(c.id),old=latest.allocations?.[runId];if(old&&old.state!=='released')return old;if(color>c.colorRemaining)throw Error('原合同免费调色额度已被其他变更占用');const allocation={runId,color,french,state:'reserved',at:Date.now()};save({...latest,allocations:{...latest.allocations,[runId]:allocation}});return allocation;}
 function mark(ref,runId,state){const c=load(ref.id),old=c?.allocations?.[runId];if(!old)return;save({...c,allocations:{...c.allocations,[runId]:{...old,state}}});}
 return {resolve,load,view,reserve,mark};
}
export function planContractChange(contract,intent,authorization={}){
 const obligations=[],additions=[],issues=[];const language=contract.subtitleLanguage;
 if(intent.mandatoryToday)issues.push({code:'calendar_deadline',role:'buyer',question:'本次要求当日必须交付，但当前入口只能按小时交期报价，尚不能验证硬性日历截止时间。不会生成可付款方案；请人工明确处理该期限，或明确改用相对小时交期后重新发起需求。'});
 if(intent.uncertain||intent.extraSeconds||intent.wrap)issues.push({code:'unsupported_scope',role:'buyer',question:'本次包含未授权的新增范围或条件关系，请先明确新增工作与授权；原合同义务继续有效。'});
 if(intent.french&&contract.pendingFrench)issues.push({code:'pending_entitlement',role:'buyer',question:'已有法语变更的付款尚未核验，请先回查原交易；当前不能重复报价或付款。'});
 if(intent.french&&!language)issues.push({code:'language_evidence',role:'seller',question:'原合同只约定包含字幕，语言尚未有双方确认的依据。请补充原字幕语言的合同条款，由双方确认新版本后继续；尚不能认定法语应另收费。'});
 const includedColor=!!intent.color&&contract.colorRemaining>0;
 if(intent.color){if(includedColor)obligations.push({code:'included_color',label:'原合同内调蓝一次',amountMinor:0,evidence:'原合同调色额度'});else if(!authorization.allowPaidColor)issues.push({code:'color_authorization',role:'buyer',question:'原合同内的免费调色额度已占用或用完。是否授权按已确认价目另行报价？原有义务不会因此取消。'});else additions.push({code:'paid_color',label:'额度外调色',amountMinor:contract.extraColorMinor,evidence:'双方确认的额外调色价目'});}
 if(intent.french&&language){const included=contract.frenchIncluded||/^(fr(?:[-_].*)?|french|français|法语|法文)$/i.test(language.trim());(included?obligations:additions).push({code:included?'included_french':'french',label:included?'既有约定法语字幕':'新增法语SRT',amountMinor:included?0:contract.frenchMinor,evidence:included&&contract.frenchIncluded?'已核验的既有法语变更':'原字幕语言：'+language});}
 if(!intent.color&&!intent.french)issues.push({code:'unsupported_scope',role:'buyer',question:'请明确本次新增或修改的工作；当前原委托支持核对调色、字幕语言及加急变更。'});
 const quotes=[];if(!issues.length){const base=[...obligations,...additions];for(const rush of (intent.mandatoryToday?[true]:intent.rush?[true,false]:[false])){const items=[...base,...(rush?[{code:'rush',label:'本次加急交付',amountMinor:contract.rushMinor,evidence:'双方确认的加急价目'}]:[])],amountMinor=items.reduce((n,i)=>n+i.amountMinor,0);if(amountMinor>2400)throw Error('本次变更超过当前24美元金额范围');const scope=[`原委托：${contract.title}（${contract.durationSeconds}秒）`,...items.map(i=>i.label),rush?`交付：${contract.rushHours}小时内`:`交付：${contract.standardHours}小时内`].join('；');quotes.push({id:rush?'change_rush':'change_standard',label:rush?'保留加急':'标准交付',scope,deliverable:intent.french?'法语SRT字幕及调色变更交付记录':'调色变更交付记录',deliveryHours:rush?contract.rushHours:contract.standardHours,actualDeliveryHours:rush?contract.rushHours:contract.standardHours,askMinor:amountMinor,fixedPrice:true,items,selection:{color:!!intent.color,french:!!intent.french,rush},freeColor:includedColor?1:0,newFrench:additions.some(i=>i.code==='french')});}}
 return {contractRef:{id:contract.id,version:contract.version},contentHash:contract.contentHash??contractHash(contract),obligations,additions,issues,quotes,intent,authorization:{allowPaidColor:!!authorization.allowPaidColor},originalAgreement:contract.agreementText,languageEvidence:language,remainingColor:contract.colorRemaining,usageEvidence:contract.priorColorUses??[]};
}
