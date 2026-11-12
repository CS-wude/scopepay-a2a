import {requestId} from './request-id.mjs';
let csrf,state,lastSignature='';
const $=id=>document.getElementById(id);
const money=n=>`$${(n/100).toFixed(2)}`;
const terms={standard:'次日交付',today:'今日交付',standard_revision:'次日交付并增加一次修改',french:'法语字幕',included_color:'包含的调色修改',paid_color:'额外调色',subtitle_wrap:'字幕行长调整'};
const labels={ready:'待开始',negotiating:'双方正在协商',agreed:'已达成协议',rejected:'当前条件未达成',needs_owner:'需要补充授权',needs_clarification:'需要澄清原约定',needs_renegotiation:'条件已变，需要重新协商',failed:'运行中断',paid:'付款已核验',paid_delivery_failed:'已付款，交付待修复',delivered:'交付已记录',interrupted:'待检查恢复',payment_unknown:'原付款待核验'};
function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{Origin:location.origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw new Error(v.error??'操作失败');return v;}
async function action(path){try{$('notice').textContent='处理中';await api(path,{});$('notice').textContent='操作完成';await refresh();}catch(e){$('notice').textContent=e.message;}}
function render(){
  $('stat-cap').textContent=money(state.owners.capMinor);$('stat-used').textContent=money(state.budgetUsed);$('stat-total').textContent=`累计预算 ${money(state.owners.totalCapMinor)}`;$('stat-delivered').textContent=state.sessions.filter(s=>s.state==='delivered').length;$('stat-sessions').textContent=`共 ${state.sessions.length} 次协商记录`;$('payment-note').textContent=state.paymentMode==='fixture'?'模拟支付 · 不扣真实资金':'Braintree Sandbox · 沙箱测试付款';
  $('mode').textContent=`协商：${state.modelMode==='live_assisted'?'真实模型建议 + 授权校验':'确定性策略'} · 通信：真实 A2A · 支付：${state.paymentMode} · 字幕：${state.modelMode==='live_assisted'?'模型翻译与复核':'预制样例'}`;
  $('budget').textContent=`本次上限 ${money(state.owners.capMinor)} · 累计已付或预留 ${money(state.budgetUsed)} / ${money(state.owners.totalCapMinor)}`;
  $('contract').textContent=`当前项目：免费调色剩余 ${state.contract.colorRemaining} 次；${state.contract.frenchIncluded?'已包含法语字幕':'尚未添加法语字幕'}。新建项目会保留历史记录和累计预算。`;
  const selected=new URLSearchParams(location.search).get('session');
  const signature=JSON.stringify([selected,state.sessions]);if(signature===lastSignature)return;lastSignature=signature;
  $('sessions').replaceChildren();
  if(!state.sessions.length||selected&&!state.sessions.some(s=>s.id===selected))$('sessions').append(Object.assign(node('div',selected?'未找到这次协商，请返回最近记录。':'还没有协商记录。写下第一条变更需求，让双方开始沟通。'),{className:'empty'}));
  for(const s of selected?state.sessions.filter(s=>s.id===selected):state.sessions.slice(0,6)){
    const a=node('article','');a.append(node('h3',labels[s.state]??s.state),node('p',s.text));const link=node('a','查看这次协商');link.href=`/negotiate?session=${s.id}`;a.append(link);
    if(s.question)a.append(node('p',s.question));if(s.error)a.append(node('p',s.error));
    if(['needs_owner','needs_clarification'].includes(s.state)){const b=node('button','更新委托后继续检查');b.onclick=()=>action(`/api/v2/sessions/${s.id}/resume`);a.append(b);}
    if(s.state==='needs_renegotiation'){const b=node('button','按当前条件重新协商');b.onclick=async()=>{try{await api('/api/v2/sessions',{requestId:requestId(),text:s.text});await refresh();}catch(e){$('notice').textContent=e.message;}};a.append(b);}
    const list=node('ol','');for(const e of s.messages){const m=e.payload;const row=node('li',`${m.actor==='buyer'?'买方':'创作者'} ${m.type==='offer'?'提案':m.type==='accept'?'接受':'退出'}${m.candidate?`：${terms[m.candidate.packageId]??m.candidate.packageId}，${money(m.candidate.amountMinor)}`:''}`);row.className=m.actor==='buyer'?'buyer-offer':'seller-offer';list.append(row);}const timeline=node('details','');timeline.append(node('summary',`查看双方协商过程 · ${s.messages.length} 条记录`),list);a.append(timeline);
    if(s.candidate){const pack=s.domain.packages.find(p=>p.id===s.candidate.packageId);a.append(node('p',`最终条款：${money(s.candidate.amountMinor)}；${pack.scope.map(x=>terms[x]??x).join('、')}；最晚 ${new Date(pack.dueAt).toLocaleString()}；额外修改 ${pack.extraRevisions} 次。`));a.append(node('p','成交依据：双方针对同一份完整条款签名，价格、范围和交期通过各自授权检查。'));}
    if(s.state==='agreed'||s.payment?.state==='unknown'){const b=node('button',s.payment?'核查原付款':'按当前协议补款');b.onclick=()=>action(`/api/v2/sessions/${s.id}/pay`);a.append(b);}
    if(s.payment){a.append(node('p',`付款：${s.payment.state} · ${s.payment.transactionId??s.payment.id} · ${s.payment.status??'尚无已核验结果'}`));if(s.payment.state==='verified'&&!s.delivery){const b=node('button','生成并核对样例交付');b.onclick=()=>action(`/api/v2/sessions/${s.id}/deliver`);a.append(b);}}
    if(s.delivery){a.append(node('p',s.delivery.note));if(s.delivery.srt){a.append(node('pre',s.delivery.srt));const b=node('button','下载 SRT');b.onclick=()=>{const url=URL.createObjectURL(new Blob([s.delivery.srt],{type:'application/x-subrip'})),link=document.createElement('a');link.href=url;link.download='scopepay.fr.srt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};a.append(b);}}
    $('sessions').append(a);
  }
}
async function refresh(){state=await api('/api/v2/state');if(document.activeElement!==$('owners')&&!$('owners').dataset.dirty)$('owners').value=JSON.stringify(state.owners,null,2);render();}
$('owners').oninput=()=>{$('owners').dataset.dirty='true';};
document.querySelectorAll('[data-request]').forEach(b=>b.onclick=()=>{$('request').value=b.dataset.request;$('request').focus();});
$('project').onclick=()=>action('/api/v2/project');
$('save').onclick=async()=>{try{await api('/api/v2/owners',JSON.parse($('owners').value));delete $('owners').dataset.dirty;$('notice').textContent='委托已更新；待处理请求请重新发起';await refresh();}catch(e){$('notice').textContent=e.message;}};
$('start').onclick=async()=>{const b=$('start');b.disabled=true;try{const created=await api('/api/v2/sessions',{requestId:requestId(),text:$('request').value});history.replaceState({},'',`/negotiate?session=${created.id}`);$('notice').textContent='请求已保存';await refresh();}catch(e){$('notice').textContent=e.message;}finally{b.disabled=false;}};
(async()=>{csrf=(await api('/api/state')).csrf;await refresh();setInterval(()=>refresh().catch(e=>{$('notice').textContent=e.message;}),1600);})().catch(e=>{$('notice').textContent=e.message;});
