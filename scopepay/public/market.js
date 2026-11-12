import {renderContracts,renderChangeEvidence,renderChangeControls,changeDialog} from './contracts.js';
import {requestId} from './request-id.mjs';
import {conversationTimeline} from './conversation-timeline.mjs';
const processOpen=new Set(),settingsOpen=new Set();
const $=id=>document.getElementById(id),money=n=>'$'+(n/100).toFixed(2),statuses={awaiting_review:'讨论结果待处理',confirmed:'双方已认可',cancelled:'已结束',draft:'草稿',pending:'待审核',reviewing:'审核中',approved:'审核通过，待上架',published:'已上架',rejected:'退回修改',review_error:'审核未完成',withdrawn:'已下架',ready:'准备协商',negotiating:'双方正在协商',agreed:'已达成协议',rejected_trade:'未达成协议',paid:'已付款，待交付',delivered:'交付已记录',needs_owner:'需要补充授权',needs_clarification:'需要澄清',negotiation_stalled:'协商暂未达成一致',needs_renegotiation:'需要重新协商',payment_unknown:'原付款待核验',paid_delivery_failed:'已付款，交付待修复',failed:'运行中断',interrupted:'运行已中断',partially_delivered:'已付款，待完成交付',paying:'正在核验付款'};
let role=new URLSearchParams(location.search).get('role')||'buyer',view,bootstrap,workspace,catalog=[],contracts=[],services=[],selected,editing=null,busy=false,signature='';
if(!['buyer','seller','platform'].includes(role))role='buyer';view=role==='buyer'?'market':role==='seller'?'listing':'review';
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function button(text,fn,cls){const b=node('button',text,cls);b.type='button';b.disabled=busy;b.onclick=fn;return b;}
function notice(t){$('notice').textContent=t;}
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{Origin:location.origin,'Content-Type':'application/json','X-CSRF-Token':bootstrap.csrf},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(v.error||'操作失败');return v;}
async function mutate(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);if($('service-dialog').open)$('service-dialog-notice').textContent='正在保存…';else notice('正在处理，请稍候…');try{await fn();notice('操作完成');}catch(e){if($('service-dialog').open)$('service-dialog-notice').textContent=e.message;else notice(e.message);}finally{busy=false;$('service-dialog').querySelectorAll('button').forEach(b=>b.disabled=false);$('refresh').disabled=false;await refresh().catch(e=>notice(e.message));}}
function navigate(next){view=next;editing=null;signature='';notice('');render();}
function facts(parent,rows){const dl=node('dl');for(const [a,b]of rows)dl.append(node('dt',a),node('dd',b));parent.append(dl);}
function title(a,b){
  $('title').textContent=a;$('subtitle').textContent=b;$('eyebrow').textContent='';
  const show=['market','listing','review','public'].includes(view);$('overview-summary').hidden=!show;
  $('overview-summary').replaceChildren();if(!show)return;
  const rows=role==='buyer'?[['可选服务',catalog.length+' 项'],['本次授权',money(workspace.delegation.capMinor)],['累计可用',money(Math.max(0,workspace.delegation.totalCapMinor-workspace.budgetUsed))]]:[['服务总数',services.length+' 项'],['已上架',services.filter(s=>s.status==='published').length+' 项'],['待审核',services.filter(s=>['pending','reviewing'].includes(s.status)).length+' 项']];
  for(const [label,value]of rows){const span=node('span',label);span.append(node('strong',value));$('overview-summary').append(span);}
}
function empty(a,b,action){const box=node('div',undefined,'empty');box.append(node('h2',a),node('p',b));if(action)box.append(action);$('view').append(box);}
function switchRole(r){role=r;history.replaceState({},'',`/market?role=${r}`);view=r==='buyer'?'market':r==='seller'?'listing':'review';editing=null;selected=null;signature='';notice('');refresh().catch(e=>notice(e.message));}
function contractContext(){return {role,contracts,api,mutate,requestId,capMinor:workspace?.delegation?.capMinor,openSession:id=>{selected=id;view='talk';},showContracts:()=>navigate(role==='buyer'?'delegation':'contracts')};}
async function refresh(){if(role!=='platform')contracts=await api('/api/market/contracts?role='+role);if(role==='buyer'){[catalog,workspace]=await Promise.all([api('/api/market/catalog'),api('/api/market/workspace?role=buyer')]);}else if(role==='seller'){[services,workspace]=await Promise.all([api('/api/market/seller/services'),api('/api/market/workspace?role=seller')]);}else{services=await api('/api/market/platform/services');workspace=null;}render();}
function render(){renderInteractionSettings();document.querySelectorAll('[data-role]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.role===role));b.disabled=busy;});$('role-label').textContent={buyer:'买家工作区',seller:'卖家工作区',platform:'平台工作区'}[role];const menus=role==='buyer'?[['market','服务市场'],['talk','交易会话'],['delegation','我的委托']]:role==='seller'?[['listing','我的服务'],['contracts','已有委托'],['talk','交易会话']]:[['review','上架审核'],['public','已上架服务']];$('nav').replaceChildren();for(const [key,label]of menus){const b=button(label,()=>navigate(key));if(key===view)b.setAttribute('aria-current','page');$('nav').append(b);}
  $('view').replaceChildren();if(view==='market'||view==='public')market();else if(view==='detail')detail();else if(view==='listing')listings();else if(view==='review')review();else if(view==='delegation'){delegation();renderContracts($('view'),contractContext());}else if(view==='contracts'){title('已有委托','核对原约定，再协商变更。');renderContracts($('view'),contractContext());}else room();}
function publicFacts(s,parent){facts(parent,[['服务类型',bootstrap.kinds[s.kind]?.label??s.kind],['标准交期',`${s.deliveryHours}小时`],['包含',s.includes??bootstrap.kinds[s.fulfillmentKind??s.kind]?.includes??'审核后确认'],['不包含',s.excludes??bootstrap.kinds[s.fulfillmentKind??s.kind]?.excludes??'审核后确认']]);}
function market(){
  title('服务市场','浏览服务，查看报价与交期。');
  const data=role==='platform'?services.filter(s=>s.status==='published').map(s=>s.published):catalog;
  if(!data.length){empty('暂无上架服务','服务确认上架后，将显示在这里。',button('去卖家端管理服务',()=>switchRole('seller'),'primary'));return;}
  const cards=node('div',undefined,'cards catalog-cards');
  for(const s of data){const card=node('section',undefined,'card product-card'),top=node('div',undefined,'product-top');
    top.append(node('span',bootstrap.kinds[s.kind]?.label??s.kind,'category'),node('span',s.deliveryHours+'小时交付','delivery-time'));
    card.append(top,node('h2',s.title),node('p',s.description,'product-description'));
    const bottom=node('div',undefined,'product-bottom'),price=node('div',undefined,'product-price');price.append(node('strong',money(s.askMinor)),node('span','起 · USD'));
    bottom.append(price,button(role==='buyer'?'查看服务':'查看详情',()=>{selected=s;view='detail';render();},'primary'));card.append(bottom);cards.append(card);
  }$('view').append(cards);
}
function detail(){if(!selected){navigate('market');return;}const s=selected;title(s.title,'查看完整服务说明与交付条件。');const split=node('div',undefined,'split'),card=node('section',undefined,'card'),side=node('aside',undefined,'card');card.append(button('返回服务市场',()=>navigate(role==='platform'?'public':'market')),node('span',`服务版本 v${s.version}`,'tag'),node('p',s.description));publicFacts(s,card);card.append(node('div','具体范围以服务说明和最终协议为准。','hint'));if(role==='platform'){split.append(card);$('view').append(split);return;}side.append(node('h2','购买需求'),node('strong',money(s.askMinor)+' 起','amount'));facts(side,[['我的单次上限',money(workspace.delegation.capMinor)],['累计剩余',money(Math.max(0,workspace.delegation.totalCapMinor-workspace.budgetUsed))]]);const label=node('label','本次需求'),input=node('textarea');input.value=s.fulfillmentKind===null?'请按服务说明报价，并确认交付内容和时间。':(s.fulfillmentKind??s.kind)==='french'?'请制作法语字幕，按标准交期交付。':'请调整字幕行长，保留原文字和时间码。';label.append(input);side.append(label,button('开始协商',()=>mutate(async()=>{const r=await api('/api/v2/sessions',{workflow:'dual_mode',requestId:requestId(),text:input.value,service:{id:s.id,version:s.version}});selected=r.id;view='talk';}),'primary'),button('调整我的授权',()=>navigate('delegation')));split.append(card,side);$('view').append(split);}
function listings(){title('我的服务','管理服务内容、价格和上架状态。');if(services.length){const actions=node('div',undefined,'listing-actions');actions.append(button('创建服务草稿',()=>openServiceDialog(),'primary'));$('view').append(actions);}if(!services.length){empty('暂无服务','创建草稿，填写服务信息后提交审核。',button('创建服务草稿',()=>openServiceDialog(),'primary'));return;}const cards=node('div',undefined,'cards');for(const d of services){const card=node('section',undefined,'card');card.append(node('span',statuses[d.status]||d.status,'tag'),node('h2',d.draft.title),node('p',d.draft.description));facts(card,[['服务类型',bootstrap.kinds[d.draft.kind]?.label??d.draft.kind],['公开起价',money(d.draft.askMinor)],['我的成本 / 最低收益',money(d.draft.costMinor)+' / '+money(d.draft.minMarginMinor)],['版本',String(d.version)]]);if(d.currentReview)card.append(node('p','当前审核：'+d.currentReview.reason));if(d.error)card.append(node('p',d.error));const row=node('div',undefined,'subrow');row.append(button('修改服务',()=>openServiceDialog(d)));if(['draft','rejected','review_error'].includes(d.status))row.append(button('提交审核',()=>mutate(()=>api(`/api/market/seller/services/${d.id}/submit`,{version:d.version})),'primary'));if(['approved','withdrawn'].includes(d.status)&&d.currentReview?.approved)row.append(button('上架服务',()=>mutate(()=>api(`/api/market/seller/services/${d.id}/publish`,{version:d.version})),'primary'));if(['published','pending','reviewing'].includes(d.status))row.append(button('下架 / 撤回',()=>mutate(()=>api(`/api/market/seller/services/${d.id}/withdraw`,{version:d.version}))));card.append(row);cards.append(card);}$('view').append(cards);}
function openServiceDialog(record=null){
  notice('');editing=record;const dialog=$('service-dialog'),body=$('service-form-body');body.replaceChildren();$('service-dialog-title').textContent=record?'修改服务':'创建服务草稿';$('service-dialog-notice').textContent='';
  const values=record?.draft||{title:'',description:'',kind:'',askMinor:1600,costMinor:800,minMarginMinor:200,deliveryHours:24};
  const form=node('form',undefined,'form');form.id='service-form';
  const fields=[['title','服务名称','text'],['kind','服务类型','category'],['description','公开说明','textarea'],['askMinor','公开起价（美元）','number'],['deliveryHours','标准交期','hours'],['costMinor','我的成本（美元，仅卖家端）','number'],['minMarginMinor','最低收益（美元，仅卖家端）','number']];
  for(const [key,label,type]of fields){const wrap=node('label',label);if(type==='textarea')wrap.className='wide';const input=node(type==='textarea'?'textarea':type==='hours'?'select':'input');input.name=key;input.required=true;
    if(type==='category'){input.type='text';input.maxLength=60;input.setAttribute('list','service-category-options');input.placeholder='输入服务类型，也可选择已有类型';}
    else if(type==='hours')for(const n of [24,48]){const o=node('option',n+'小时');o.value=n;input.append(o);}
    else if(type==='number'){input.type='number';input.min=key==='askMinor'?1:0;input.max=24;input.step=1;}
    else if(type==='text')input.maxLength=80;
    else input.maxLength=1000;
    input.value=['askMinor','costMinor','minMarginMinor'].includes(key)?values[key]/100:key==='kind'?(bootstrap.kinds[values.kind]?.label??values.kind):values[key];wrap.append(input);form.append(wrap);
  }
  const options=node('datalist');options.id='service-category-options';const categories=new Set([...Object.values(bootstrap.kinds).map(k=>k.label),...services.map(s=>bootstrap.kinds[s.draft.kind]?.label??s.draft.kind)]);for(const name of categories){const option=node('option');option.value=name;options.append(option);}form.append(options);
  const packageBox=node('details',undefined,'wide');packageBox.append(node('summary','可选报价方案（最多3项）'),node('p','按可交付范围设置不同交期或交付物，代表只能在你授权的价格和成本内谈。','muted'));const packageRows=node('div');packageBox.append(packageRows);const editors=[];
  function addPackage(value={}){if(editors.length>=3)return;const row=node('div',undefined,'card'),controls={};const spec=[['label','方案名称','text'],['scope','完整服务范围','textarea'],['deliverable','交付文件与验收说明','textarea'],['askMinor','方案报价（美元）','number'],['costMinor','成本（仅本方）','number'],['minMarginMinor','最低收益（仅本方）','number'],['deliveryHours','交期','hours']];for(const [key,label,type]of spec){const wrap=node('label',label),i=node(type==='textarea'?'textarea':type==='hours'?'select':'input');i.setAttribute('aria-label',label);i.required=true;if(type==='hours')for(const h of [24,48]){const o=node('option',h+'小时');o.value=h;i.append(o);}else if(type==='number'){i.type='number';i.min=0;i.max=24;i.step=1;}else i.maxLength=key==='label'?60:800;i.value=value[key]===undefined?(type==='number'?0:type==='hours'?24:''):type==='number'?value[key]/100:value[key];wrap.append(i);row.append(wrap);controls[key]=i;}const entry={id:value.id??('p-'+requestId()).slice(0,60),controls};editors.push(entry);const remove=button('移除此方案',()=>{editors.splice(editors.indexOf(entry),1);row.remove();});remove.type='button';row.append(remove);packageRows.append(row);packageBox.open=true;}
  const add=button('添加可选方案',()=>addPackage());add.type='button';packageBox.append(add);for(const o of values.options??[])addPackage(o);form.append(packageBox);
  form.onsubmit=e=>{e.preventDefault();const input={};for(const [key]of fields)input[key]=['askMinor','costMinor','minMarginMinor'].includes(key)?Number(form.elements[key].value)*100:key==='deliveryHours'?Number(form.elements[key].value):form.elements[key].value;
    if(editors.length||values.options)input.options=editors.map(e=>({id:e.id,...Object.fromEntries(Object.entries(e.controls).map(([k,i])=>[k,['askMinor','costMinor','minMarginMinor'].includes(k)?Number(i.value)*100:k==='deliveryHours'?Number(i.value):i.value]))}));
    mutate(async()=>{if(record)await api(`/api/market/seller/services/${record.id}/edit`,{version:record.version,draft:input});else await api('/api/market/seller/services',input);dialog.close();editing=null;view='listing';});};
  body.append(form);dialog.showModal();
}

function review(){
  title('服务上架审核','审核与上架分别确认，平台可直接复核上架。');
  if(!services.length){empty('暂无服务待审','卖家创建后会出现在这里。');return;}
  const list=node('div',undefined,'cards');
  for(const d of services){const card=node('section',undefined,'card'),actions=node('div',undefined,'subrow');
    card.append(node('span',statuses[d.status]||d.status,'tag'),node('h2',d.draft.title),node('p',d.draft.description));
    facts(card,[['服务类型',bootstrap.kinds[d.draft.kind]?.label??d.draft.kind],['公开起价',money(d.draft.askMinor)+' USD'],['标准交期',d.draft.deliveryHours+'小时'],['当前服务版本','v'+d.version]]);
    if(!d.reviewRun&&['pending','rejected','review_error','approved','published'].includes(d.status))actions.append(button(d.status==='pending'?'执行审核':'重新审核',()=>mutate(()=>api(`/api/market/platform/services/${d.id}/review`,{version:d.version}))));
    const publish=button(d.status==='published'?'已上架':'上架服务',()=>openPublishDialog(d),'primary');if(d.status==='published')publish.disabled=true;actions.append(publish);
    if(d.status==='published')actions.append(button('下架服务',()=>mutate(()=>api(`/api/market/seller/services/${d.id}/withdraw`,{version:d.version}))));
    card.append(actions);
    if(d.status==='reviewing'||d.reviewRun)card.append(node('p','审核中；请稍后刷新。'));if(d.error)card.append(node('p',d.error));
    if(d.reviews.length){const panel=node('div',undefined,'review-history'),label=node('label','审核记录'),select=node('select'),result=node('div',undefined,'review-result');select.setAttribute('aria-label',d.draft.title+'审核记录');
      for(let i=d.reviews.length-1;i>=0;i--){const r=d.reviews[i],option=node('option',`v${r.version} · ${r.approved?'通过':'退回'} · ${new Date(r.at).toLocaleString()}`);option.value=i;select.append(option);}
      function showReview(){const r=d.reviews[Number(select.value)];result.replaceChildren(node('strong',r.approved?'审核通过':'退回修改'),node('p',r.reason),node('small',`服务版本 v${r.version} · ${r.mode==='live'?'自动审核':'测试审核'}`,'muted'));}
      select.onchange=showReview;label.append(select);panel.append(label,result);card.append(panel);showReview();
    }else card.append(node('p','暂无审核记录','muted'));
    if(d.decisions?.length){const decision=d.decisions.at(-1);card.append(node('p',`${decision.actor==='local_seller_owner'?'卖家':'平台'}上架：${decision.reason}`,'muted'));}
    list.append(card);
  }$('view').append(list);
}
function delegation(){title('我的购买授权','设置单次和累计支付上限。');const d=workspace.delegation,card=node('section',undefined,'card'),form=node('form',undefined,'form');for(const [key,text]of [['capMinor','单次上限（美元）'],['totalCapMinor','累计上限（美元）']]){const l=node('label',text),i=node('input');i.type='number';i.min=0;i.step=.01;i.max=10000;i.name=key;i.value=d[key]/100;i.required=true;l.append(i);form.append(l);}const l=node('label',undefined,'check wide'),checkbox=node('input');checkbox.type='checkbox';checkbox.name='autoPay';checkbox.checked=d.autoPay;l.append(checkbox,node('span','谈妥后按当前模式自动付款并交付'));form.append(l);form.append(node('p',`当前已付或预留 ${money(workspace.budgetUsed)}。${workspace.paymentMode==='fixture'?'本地模拟支付，不扣真实资金。':'当前使用外部沙箱测试支付。'}`,'hint wide'));const b=node('button','保存购买授权','primary');b.type='submit';form.append(b);form.onsubmit=e=>{e.preventDefault();mutate(()=>api('/api/market/buyer/delegation',{capMinor:Math.round(Number(form.elements.capMinor.value)*100),totalCapMinor:Math.round(Number(form.elements.totalCapMinor.value)*100),autoPay:checkbox.checked}));};card.append(form);$('view').append(card);}
function room(){title('交易会话','处理讨论结果，查看双方沟通。');const sessions=workspace.sessions;if(!sessions.length){empty('暂无交易','买家从已审核的服务详情发起请求，即可进入这里。',role==='buyer'?button('浏览市场',()=>navigate('market'),'primary'):undefined);return;}const s=sessions.find(s=>s.id===selected)||sessions[0];selected=s.id;if(s.negotiationMode==='market_conversation'){conversationRoom(s,sessions);return;}const room=node('div',undefined,'room'),threads=node('aside',undefined,'threads'),chat=node('section',undefined,'conversation'),side=node('aside',undefined,'room-side');for(const t of sessions){const b=button(t.service.title,()=>{selected=t.id;render();},'thread'+(t.id===s.id?' active':''));b.append(node('span',(t.state==='rejected'?'未达成协议':statuses[t.state]||t.state)+' · '+t.id.slice(0,8)));threads.append(b);}chat.append(node('h2',s.service.title),node('p','服务 v'+s.service.version+' · 交易 '+s.id.slice(0,8)),node('div','委托 → 协商 → 付款 → 交付','stages'),node('p',s.text));for(const e of s.messages){const m=e.payload,pack=s.domain.packages.find(p=>p.id===m.candidate?.packageId),box=node('div',undefined,'message'+(m.actor===role?' mine':''));box.append(node('strong',m.actor==='buyer'?'买方':'卖方'),node('p',m.type==='offer'?'提出完整方案':m.type==='accept'?'接受对方完整方案':'结束协商'));if(m.candidate)box.append(node('div',money(m.candidate.amountMinor),'quote'),node('p',`最晚 ${new Date(pack.dueAt).toLocaleString()} · ${s.service.includes}`));chat.append(box);}if(s.question||s.error)chat.append(node('div',s.question||s.error,'hint'));if(s.service.fulfillmentKind===null&&s.state==='needs_owner')chat.append(button('开始双方协商',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/resume`,{})),'primary'));if(['needs_owner','needs_clarification','needs_renegotiation','rejected'].includes(s.state)&&role==='buyer')chat.append(button('返回市场修改需求 / 授权',()=>navigate('market')));side.append(node('h3',role==='buyer'?'我的购买授权':'我的服务条件'));if(role==='buyer')facts(side,[['当前单次上限',money(workspace.delegation.capMinor)],['累计剩余',money(Math.max(0,workspace.delegation.totalCapMinor-workspace.budgetUsed))],['是否自动支付',workspace.delegation.autoPay?'已委托':'需点击付款']]);else{const own=services.find(d=>d.id===s.service.id);facts(side,[['服务公开起价',money(s.service.askMinor)],['本单私有成本',own?.version===s.service.version?money(own.draft.costMinor):'历史版本，按已保存授权执行']]);}side.append(node('hr',undefined,'divider'),node('h3','当前方案'),node('p',s.state==='rejected'?'当前条件未达成':statuses[s.state]||s.state));if(s.candidate)side.append(node('p',money(s.candidate.amountMinor),'amount'));publicFacts(s.service,side);if(role==='buyer'&&(s.state==='agreed'||s.payment?.state==='unknown'))side.append(button(s.payment?'核查原付款':'按协议付款',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/pay`,{})),'primary'));if(s.payment){facts(side,[['付款状态',s.payment.state],['原交易引用',s.payment.transactionId||s.payment.id]]);if(s.payment.state==='verified'&&!s.delivery)side.append(button('生成并核验交付',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/deliver`,{})),'primary'));}if(s.delivery){const details=node('details');details.append(node('summary','查看交付与验收'),node('p',s.delivery.review.accepted?'字幕验收通过':'交付需修复'),node('pre',s.delivery.srt||'暂无字幕文件'));chat.append(details);if(s.delivery.srt&&s.delivery.review.accepted)side.append(button('下载 SRT 字幕',()=>{const url=URL.createObjectURL(new Blob([s.delivery.srt],{type:'application/x-subrip;charset=utf-8'})),a=node('a');a.href=url;a.download=(s.service.fulfillmentKind??s.service.kind)==='french'?'scopepay.fr.srt':'scopepay.wrapped.srt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));}room.append(threads,chat,side);$('view').append(room);}
function conversationRoom(s,sessions){
  if(s.workflow==='dual_mode'){dualRoom(s,sessions);return;}
  const layout=node('div',undefined,'room'),threads=node('aside',undefined,'threads'),chat=node('section',undefined,'conversation'),side=node('aside',undefined,'room-side');
  for(const t of sessions){const b=button(t.service.title,()=>{selected=t.id;render();},'thread'+(t.id===s.id?' active':''));b.append(node('span',(statuses[t.state]||t.state)+' · '+t.id.slice(0,8)));threads.append(b);}
  chat.append(node('h2',s.service.title),node('p','服务 v'+s.service.version+' · 交易 '+s.id.slice(0,8)),node('div',s.state==='agreed'?'双方已同意方案':s.state==='negotiating'?'双方正在沟通需求与报价':statuses[s.state]||s.state,'stages'));
  const unverified=s.earlierUnverifiedCount??(s.conversationPolicyVersion===2?0:s.discussion?.length??0);if(unverified)chat.append(node('div','早期消息含未经本人确认的推测，仅保留作记录。后续以原始需求和双方明确补充为准。','hint'));
  chat.append(button('启用双模式协商',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/interaction`,{role,mode:workspace.interactionMode??'auto'}))));
  for(const event of conversationTimeline(s)){
    if(event.kind!=='message'){chat.append(ownerEntry(event));continue;}
    const m=event.message.payload,box=agentEntry(m);
    if(m.sequence<=unverified)box.append(node('small','早期消息 · 条件未经本人确认','muted'));
    chat.append(box);
  }
  if(['ready','negotiating'].includes(s.state))chat.append(node('p',(s.discussion??[]).length?'正在等待对方回复…':'正在联系卖方代表…','dialogue-progress'));
  if(s.question||s.error)chat.append(node('div',s.question||s.error,'hint'));
  if(s.result)chat.append(node('div',s.state==='agreed'?'双方已同意本次报价、范围和验收条款。方案已记录，尚未付款或交付。':s.result,'hint'));
  if(s.state==='needs_clarification'&&s.conversationPolicyVersion!==2)chat.append(button('按已确认信息重新核对',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/resume`,{}))));
  if(s.state==='negotiation_stalled')chat.append(button('继续由双方协商',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/resume`,{})),'primary'));
  if(s.state==='needs_clarification'&&s.awaitingRole&&s.awaitingRole!==role)chat.append(node('div',s.awaitingRole==='seller'?'等待卖家在卖家端处理自己的授权问题；你无需重复填写已委托的常规细节。':'等待买家处理自己的授权问题。','hint'));
  if(['needs_clarification','failed','interrupted'].includes(s.state)&&(!s.awaitingRole||s.awaitingRole===role)){
    const form=node('form',undefined,'clarification-form');form.id='conversation-clarification';const label=node('label',role==='buyer'?'补充你的需求或回复问题':'补充可交付范围或回复问题'),input=node('textarea');input.required=true;input.maxLength=2000;input.placeholder=role==='buyer'?'例如：画幅、剧本与素材、交付格式、修改次数和验收要求':'填写已经确认可提供的服务范围、交期与验收条件';label.append(input);const submit=node('button','发送并继续协商','primary');submit.type='submit';submit.disabled=busy;const privateRevision=privateToggle(form);form.append(label,submit);form.onsubmit=e=>{e.preventDefault();mutate(()=>api(`/api/v2/sessions/${s.id}/clarify`,{role,text:input.value,visibility:privateRevision.checked?'private':'shared'}));};chat.append(form);
  }
  side.append(node('h3',role==='buyer'?'我的购买授权':'我的服务条件'));
  if(role==='buyer')facts(side,[['单次上限',money(workspace.delegation.capMinor)],['累计可用',money(Math.max(0,workspace.delegation.totalCapMinor-workspace.budgetUsed))]]);
  else{const own=services.find(d=>d.id===s.service.id);facts(side,[['公开起价',money(s.service.askMinor)],['我的成本',own?.version===s.service.version?money(own.draft.costMinor):'按本单已保存条件']]);}
  facts(side,[['常规细节',s.routineDecisions?.[role]?'由代表自行协商':'按已明确的条件协商']]);
  side.append(node('hr',undefined,'divider'),node('h3',s.agreement?'已同意的方案':'当前协商结果'));
  if(s.agreement){const t=s.agreement;side.append(node('p',money(t.amountMinor),'amount'));facts(side,[['范围',t.scope],['交付内容',t.deliverable],['交期',t.deliveryHours+'小时'],['验收',t.acceptance.join('；')]]);}else side.append(node('p',s.state==='rejected'?'双方未达成协议':s.state==='needs_clarification'?(s.awaitingRole==='seller'?'等待卖家处理授权':s.awaitingRole==='buyer'?'等待买家处理核心条件':'等待补充具体条件'):'尚未达成完整方案'));
  side.append(node('p','尚未付款；协商不代表服务已交付。','muted'),node('small',`已记录 ${(s.discussion??[]).length} 条双方消息`,'muted'));
  layout.append(threads,chat,side);$('view').append(layout);
}
document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>switchRole(b.dataset.role));$('refresh').onclick=()=>{if(!busy)refresh().catch(e=>notice(e.message));};
(async()=>{bootstrap=await api('/api/market/bootstrap');await refresh();setInterval(async()=>{if(busy||view!=='talk'||(document.activeElement?.closest('#conversation-clarification, #result-revision-form')||document.activeElement?.matches('select')))return;try{const next=await api('/api/market/workspace?role='+role),sig=JSON.stringify(next);if(sig!==signature){workspace=next;signature=sig;render();}}catch(e){notice(e.message);}},1800);})().catch(e=>notice('无法连接：'+e.message));

$('service-dialog-close').onclick=()=>{if(!busy)$('service-dialog').close();};$('service-dialog-cancel').onclick=()=>{if(!busy)$('service-dialog').close();};$('service-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});

function openPublishDialog(service){
  const dialog=$('publish-dialog');$('publish-service-name').textContent=service.draft.title;$('publish-review-reason').textContent=service.reviews.at(-1)?.reason??service.error??'尚无审核意见';$('publish-reason').value='';$('publish-error').textContent='';
  $('publish-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const submit=$('publish-confirm');submit.disabled=true;busy=true;
    try{await api(`/api/market/platform/services/${service.id}/publish`,{version:service.version,reason:$('publish-reason').value});dialog.close();notice('服务已上架');await refresh();}catch(error){$('publish-error').textContent=error.message;}finally{busy=false;submit.disabled=false;await refresh().catch(error=>notice(error.message));}
  };dialog.showModal();
}
$('publish-cancel').onclick=()=>{if(!busy)$('publish-dialog').close();};$('publish-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});

function modeSelect(mode,change,inheritLabel=null){const select=node('select');select.setAttribute('aria-label',inheritLabel?'本次协商模式':'全局协商模式');if(inheritLabel){const inherit=node('option',inheritLabel);inherit.value='global';select.append(inherit);}for(const [value,label]of [['manual','人工参与：细节由我回复'],['auto','全权代理：我只处理结果']]){const o=node('option',label);o.value=value;select.append(o);}select.value=mode;select.disabled=busy;select.onchange=()=>change(select.value);return select;}
function renderInteractionSettings(){let box=$('interaction-settings');if(!box){box=node('details');box.id='interaction-settings';$('refresh').before(box);}box.replaceChildren();box.hidden=role==='platform';if(box.hidden||!workspace)return;box.append(node('summary','全局 · '+(workspace.interactionMode==='manual'?'人工参与':'全权代理')));const body=node('div',undefined,'global-preferences');body.append(node('strong','全局协商模式'),node('p','未单独设置的会话使用此模式。'),modeSelect(workspace.interactionMode??'auto',mode=>mutate(()=>api('/api/market/interaction',{role,mode}))));box.append(body);}
function dualRoom(s,sessions){
 const layout=node('div',undefined,'room dual-workspace'),threads=node('aside',undefined,'threads'),chat=node('section',undefined,'conversation'),side=node('aside',undefined,'settings-body');
 threads.append(node('h3','交易记录'),node('p',sessions.length+' 个会话','muted'));
 for(const t of sessions){const b=button(t.service.title,()=>{selected=t.id;render();},'thread'+(t.id===s.id?' active':''));b.append(node('span',(statuses[t.state]||t.state)+' · '+t.id.slice(0,8)));threads.append(b);}
 const mode=s.interactionModes[role],other=role==='buyer'?'seller':'buyer';
 const picker=node('label','切换会话','mobile-session-picker'),sessionSelect=node('select');sessionSelect.setAttribute('aria-label','切换交易会话');for(const t of sessions){const option=node('option',t.service.title+' · '+(statuses[t.state]??t.state));option.value=t.id;sessionSelect.append(option);}sessionSelect.value=s.id;sessionSelect.onchange=()=>{selected=sessionSelect.value;render();};picker.append(sessionSelect);picker.hidden=sessions.length<2;chat.append(picker);
 const heading=node('div',undefined,'workspace-heading'),headingTitle=node('div');headingTitle.append(node('span','交易 '+s.id.slice(0,8),'session-reference'),node('h2',s.service.title));heading.append(headingTitle,node('span',statuses[s.state]??s.state,'status-pill'));chat.append(heading);
 const modes=node('div',undefined,'mode-strip');modes.append(node('span',`我方 · ${mode==='auto'?'全权代理':'人工参与'}`),node('span',`对方 · ${s.interactionModes[other]==='auto'?'全权代理':'人工参与'}`));chat.append(modes);
 renderChangeEvidence(chat,s);
 const settings=node('details',undefined,'session-settings');const settingKey=role+':'+s.id;settings.open=settingsOpen.has(settingKey);settings.ontoggle=()=>{if(settings.open)settingsOpen.add(settingKey);else settingsOpen.delete(settingKey);};settings.append(node('summary','会话设置 · '+(s.interactionSources?.[role]==='snapshot'?'已结束记录':s.interactionSources?.[role]==='session'?'单独设置':'跟随全局')),side);chat.append(settings);
 const summary=node('section',undefined,'outcome-panel'),r=s.discussionResult;
 if(s.state==='cancelled')summary.append(node('h3','本次协商已结束'),node('p','未进入后续交易。沟通记录已保留。'));
 else if(r){
  summary.append(node('h3',s.state==='confirmed'?'双方已认可同一版本':`第 ${r.revision} 轮讨论结果`),node('p',s.state==='confirmed'?'买卖双方已认可同一版本，可进入后续交易。':r.status==='agreed'?'双方代表已谈妥方案，等待买卖双方本人处理结果。':r.summary));
  if(r.terms){const price=node('div',undefined,'result-price');price.append(node('strong',money(r.terms.amountMinor)),node('span',r.terms.deliveryHours+' 小时交付'));summary.append(price,node('h4','交付范围'),node('p',r.terms.scope,'result-scope'));const terms=node('details',undefined,'result-terms');terms.append(node('summary','完整条款与验收标准'));facts(terms,[['交付内容',r.terms.deliverable]]);const ul=node('ul');for(const item of r.terms.acceptance)ul.append(node('li',item));terms.append(node('h4','验收标准'),ul);summary.append(terms);}
  const approval=node('div',undefined,'approval-strip');approval.append(node('span','买家 · '+(r.approvals.buyer?'已认可':'待认可')),node('span','卖家 · '+(r.approvals.seller?'已认可':'待认可')));summary.append(approval);
  if(s.state==='awaiting_review'){
   const row=node('div',undefined,'subrow result-actions');
   if(r.status==='agreed'){const approve=button(r.approvals[role]?'你已认可，等待对方':'认可最终结果',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/decision`,{role,revision:r.revision,hash:r.hash,action:'approve'})),'primary');if(r.approvals[role])approve.disabled=true;row.append(approve);}
   row.append(button('不认可，补充后重谈',()=>{if(s.contractChange){const c=contracts.find(c=>c.id===s.contractChange.contractRef.id);if(c)changeDialog(contractContext(),c,s.text);return;}$('result-revision-form').hidden=false;$('result-revision-form').querySelector('textarea').focus();}),button('不要了',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/decision`,{role,revision:r.revision,hash:r.hash,action:'cancel'}))));summary.append(row);
   const form=node('form',undefined,'clarification-form');form.id='result-revision-form';form.hidden=true;const label=node('label','需要调整或补充的条件'),input=node('textarea');input.required=true;input.maxLength=2000;label.append(input);const submit=node('button','开始新一轮讨论','primary');submit.type='submit';const privateRevision=privateToggle(form);form.append(label,submit);form.onsubmit=e=>{e.preventDefault();mutate(()=>api(`/api/v2/sessions/${s.id}/decision`,{role,revision:r.revision,hash:r.hash,action:'revise',text:input.value,visibility:privateRevision.checked?'private':'shared'}));};summary.append(form);
  }else if(!s.contractChange)summary.append(node('p','方案已确认，待后续交易。尚未付款或交付。','hint'));
 }else if(s.contractChange?.issues.length){summary.append(node('h3','需要补充合同依据或授权'),node('p',s.question));
 }else if(s.contractChange&&s.state==='needs_clarification'){summary.append(node('h3',s.awaitingRole===role?'需要本方选择完整方案':'等待对方处理方案'),node('p',s.question));
 }else if(s.state==='needs_clarification'&&s.awaitingRole===role&&mode==='manual'){
   summary.append(node('h3','需要你回复的细节'),node('p',s.question));const proposal=s.discussion.at(-1)?.payload.terms;if(proposal){facts(summary,[['对方报价',money(proposal.amountMinor)],['服务范围',proposal.scope],['交付内容',proposal.deliverable],['交期',proposal.deliveryHours+'小时'],['验收',proposal.acceptance.join('；')]]);}const form=node('form',undefined,'clarification-form');form.id='conversation-clarification';const input=node('textarea');input.setAttribute('aria-label','回复本方细节');input.required=true;input.maxLength=2000;const submit=node('button','回复并继续协商','primary');submit.type='submit';const privateReply=privateToggle(form);form.append(input,submit);form.onsubmit=e=>{e.preventDefault();mutate(()=>api(`/api/v2/sessions/${s.id}/clarify`,{role,text:input.value,visibility:privateReply.checked?'private':'shared'}));};summary.append(form);
 }else if(s.state==='needs_clarification')summary.append(node('h3','等待对方处理细节'),node('p',mode==='auto'?'你选择了全权代理，可等待本轮讨论结果，也可展开查看过程。':s.question));
 else if(s.state==='failed'||s.state==='interrupted')summary.append(node('h3','本轮运行未完成'),node('p',s.error??'运行已中断，请恢复后继续。'),button('恢复本轮协商',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/resume`,{}))));
 else summary.append(node('h3',mode==='auto'?'双方代表正在协商':'协商进行中'),node('p',mode==='auto'?'中间细节由代表处理。讨论结束后，你可以认可、补充信息重谈或结束。':'需要本方提供细节时，会在这里显示。'));
 renderChangeControls(summary,s,contractContext());
 chat.append(summary);
 if(s.ledger?.issues?.length){const issues=node('details',undefined,'agreed-terms');issues.append(node('summary','本次需求与来源'));const names={durationMinutes:'时长（分钟）',resolution:'分辨率',aspect:'画幅',materials:'素材提供方',scriptFile:'交付脚本',revisions:'修改轮次',audio:'配音配乐',deliveryHours:'交期（小时）'};for(const i of s.ledger.issues)issues.append(node('p',`${names[i.id]??i.id}：${i.value==='seller'?'卖家':i.value==='buyer'?'买家':i.value===true?'包含':i.value} · ${i.source==='request'?'初始需求':i.source.startsWith('agreement:')?'前轮方案':'本人补充'}`));chat.append(issues);}
 const process=node('details',undefined,'negotiation-process');process.open=processOpen.has(s.id);process.ontoggle=()=>{if(process.open)processOpen.add(s.id);else processOpen.delete(s.id);};
 const timeline=conversationTimeline(s),processHeading=node('summary','沟通过程');processHeading.append(node('span',`第 ${s.resultRevision??1} 轮 · 全部 ${timeline.length} 条记录`));process.append(processHeading);
 for(const event of timeline){
   const entry=event.kind==='message'?agentEntry(event.message.payload):ownerEntry(event);
   process.append(entry);
 }
 chat.append(process);
 side.append(node('h3','本次协商模式'));const source=s.interactionSources?.[role]??'global';const select=modeSelect(source==='global'?'global':mode,m=>mutate(()=>api(`/api/v2/sessions/${s.id}/interaction`,{role,mode:m==='global'?null:m})),`跟随全局（${workspace.interactionMode==='manual'?'人工参与':'全权代理'}）`);if(['confirmed','cancelled'].includes(s.state))select.disabled=true;side.append(select,node('p',source==='snapshot'?'已结束会话保留当时的模式记录。':source==='session'?'本会话单独设置，不受全局模式变化影响。':'本会话跟随本方全局模式。买卖双方各自独立。','muted'));
 if(role==='buyer')facts(side,[['单次上限',money(workspace.delegation.capMinor)],['累计可用',money(Math.max(0,workspace.delegation.totalCapMinor-workspace.budgetUsed))]]);else facts(side,[['服务起价',money(s.service.askMinor)]]);
 if(!['confirmed','cancelled'].includes(s.state)&&!r)side.append(button('结束本次协商',()=>mutate(()=>api(`/api/v2/sessions/${s.id}/cancel`,{role}))));
 side.append(node('p','模式与方案认可不会自动付款。','muted'));layout.append(threads,chat);$('view').append(layout);
}

function ownerEntry(event){
 const initial=event.kind==='request',c=initial?event.request:event.clarification,box=node('div',undefined,'message owner-note'+(c.role===role?' mine':''));
 box.append(node('strong',c.role==='buyer'?'买家本人':'卖家本人'),node('small',initial?(c.visibility==='own'?'初始需求 · 含本方私有委托':'初始需求'):(c.visibility==='own'||c.visibility==='private')?'给本方代表的委托 · 仅本方可见':'公开补充 / 回复','muted'),node('p',c.text));
 return box;
}
function agentEntry(m){
 const box=node('div',undefined,'message'+(m.actor===role?' mine':''));
 box.append(node('strong',m.actor==='buyer'?'买方代表':'卖方代表'),node('small',{offer:'提出报价',accept:'接受方案',clarify:'澄清条件',reject:'结束协商'}[m.action]??'','muted'),node('p',m.text));
 if(m.terms){const quote=node('details',undefined,'message-terms');quote.append(node('summary',money(m.terms.amountMinor)+' · 查看报价条款'));facts(quote,[['交付内容',m.terms.deliverable],['范围',m.terms.scope],['交期',m.terms.deliveryHours+'小时'],['验收',m.terms.acceptance.join('；')]]);box.append(quote);}
 return box;
}

function privateToggle(form){const label=node('label',undefined,'check'),input=node('input');input.type='checkbox';input.setAttribute('aria-label','仅告知我的代表');label.append(input,node('span','仅告知我的代表'));form.append(label);return input;}
