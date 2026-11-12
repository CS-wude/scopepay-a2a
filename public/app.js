const el = id => document.getElementById(id);
let config, busy = false, approvalUrl;
function output(value, bad = false) {
  el('output').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (bad) el('badge').textContent = '操作未完成';
}
function paint() {
  const order = config?.order;
  el('config').textContent = config?.configured ? '沙盒凭据已配置；创建订单后才会验证有效性。' : '等待配置：请先登录 PayPal，创建 Sandbox 应用，再把凭据写入后端 .env 并重启服务。';
  el('credential-step').textContent = config?.configured ? '凭据已配置（不代表接口认证已通过）' : '尚未配置；账号登录仍需本人完成';
  el('order-step').textContent = order?.id ?? '尚未创建测试订单';
  el('result-step').textContent = order?.result?.verified ? 'COMPLETED · 金额、币种和收款商户均已核对' : order?.canceled ? '买家取消，未执行收款' : order?.approved ? '已返回本机，等待后端确认并收款' : '尚未完成真实沙盒测试';
  el('badge').textContent = order?.result?.verified ? '沙盒付款已核验' : order?.canceled ? '已取消' : '尚未付款';
  el('create').disabled = busy || !config?.configured || Boolean(order && !order.canceled && !order.result?.verified);
  el('capture').disabled = busy || !order?.approved || order.canceled || Boolean(order.result?.verified);
  el('query').disabled = busy || !order;
  el('refresh').disabled = busy;
  el('resume').hidden = !approvalUrl || Boolean(order?.approved || order?.canceled || order?.result?.verified);
  el('resume').disabled = busy;
}
async function refresh() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('无法读取本地服务配置。');
  config = await response.json(); approvalUrl = config.order?.approvalUrl; paint();
}
async function act(path) {
  busy = true; paint();
  try {
    const response = await fetch(path, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-CSRF-Token': config.csrf }, body: '{}' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求未完成。');
    output(data);
    if (data.approvalUrl) { approvalUrl = data.approvalUrl; window.location.assign(approvalUrl); }
    await refresh();
  } catch (error) { output(error.message, true); }
  finally { busy = false; paint(); }
}
el('create').addEventListener('click', () => act('/api/orders'));
el('capture').addEventListener('click', () => act('/api/orders/capture'));
el('query').addEventListener('click', () => act('/api/orders/query'));
el('resume').addEventListener('click', () => { if (approvalUrl) window.location.assign(approvalUrl); });
el('refresh').addEventListener('click', () => refresh().catch(e => output(e.message, true)));
refresh().catch(e => output(e.message, true));
