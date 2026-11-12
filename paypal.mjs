import { randomUUID } from 'node:crypto';

export const AMOUNT = Object.freeze({ currency_code: 'USD', value: '1.00' });
const BASE = 'https://api-m.sandbox.paypal.com';
export class DemoError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function checkOrder(order, record, completed = false) {
  const units = order?.purchase_units;
  const unit = units?.[0];
  const amountMatches = a => a?.currency_code === AMOUNT.currency_code && a?.value === AMOUNT.value;
  if (order?.id !== record.id || units?.length !== 1 ||
      unit?.custom_id !== record.reference || !amountMatches(unit?.amount) ||
      !unit?.payee?.merchant_id || (record.merchant && unit.payee.merchant_id !== record.merchant)) {
    throw new DemoError('订单校验失败：订单、金额、币种或收款商户不一致。');
  }
  if (completed) {
    const captures = unit.payments?.captures;
    if (order.status !== 'COMPLETED' || captures?.length !== 1 ||
        captures[0].status !== 'COMPLETED' || !amountMatches(captures[0].amount)) {
      throw new DemoError('付款尚未完成：后台未取得金额一致的 COMPLETED 收款记录。', 409);
    }
  }
  return { id: order.id, status: order.status, amount: AMOUNT.value,
    currency: AMOUNT.currency_code, verified: completed,
    captureId: completed ? unit.payments.captures[0].id : null };
}

export function createPayPal({ clientId, secret, fetchImpl = fetch }) {
  let token, expires = 0;
  const configured = Boolean(clientId?.trim() && secret?.trim());
  async function request(path, { method = 'GET', body, requestId } = {}) {
    if (!configured) throw new DemoError('尚未配置 Sandbox Client ID / Secret。', 503);
    try {
      if (!token || Date.now() >= expires) {
        const response = await fetchImpl(`${BASE}/v1/oauth2/token`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials'
        });
        const data = await response.json();
        if (!response.ok || !data.access_token || !Number.isFinite(data.expires_in))
          throw new DemoError('PayPal 沙盒认证失败，请核对 Sandbox 应用凭据。');
        token = data.access_token;
        expires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
      }
      const response = await fetchImpl(`${BASE}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { token = null; expires = 0; }
        throw new DemoError(`PayPal 沙盒接口未成功（HTTP ${response.status}）。可查询订单确认状态。`);
      }
      return data;
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError('无法连接 PayPal 沙盒，或请求超时。请检查网络后查询订单。');
    }
  }
  return {
    configured,
    async create(record, origin) {
      const data = await request('/v2/checkout/orders', {
        method: 'POST', requestId: record.createId,
        body: { intent: 'CAPTURE', purchase_units: [{ custom_id: record.reference,
          description: 'Local Sandbox Demo — test item', amount: AMOUNT,
          ...(record.merchant ? { payee: { merchant_id: record.merchant } } : {}) }],
        payment_source: { paypal: { experience_context: {
          shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
          return_url: `${origin}/return?state=${record.state}`,
          cancel_url: `${origin}/cancel?state=${record.state}`
        } } } }
      });
      if (!/^[A-Z0-9]{8,32}$/.test(data.id ?? '')) throw new DemoError('PayPal 返回了无效订单编号。');
      checkOrder(data, { ...record, id: data.id });
      const link = data.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve');
      let url;
      try { url = new URL(link?.href); } catch { throw new DemoError('PayPal 未返回批准链接。'); }
      if (url.protocol !== 'https:' || !['www.sandbox.paypal.com', 'sandbox.paypal.com'].includes(url.hostname) ||
          url.port || url.username || url.password) throw new DemoError('批准链接不是 PayPal Sandbox 地址。');
      return { id: data.id, merchant: data.purchase_units[0].payee.merchant_id, approvalUrl: url.href };
    },
    query: id => request(`/v2/checkout/orders/${encodeURIComponent(id)}`),
    capture: record => request(`/v2/checkout/orders/${encodeURIComponent(record.id)}/capture`, {
      method: 'POST', body: {}, requestId: record.captureId
    })
  };
}

export function newRecord(merchant) {
  return { reference: randomUUID(), state: randomUUID(), createId: randomUUID(),
    captureId: randomUUID(), merchant, approved: false, canceled: false };
}
