import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { AMOUNT, checkOrder, createPayPal, newRecord, DemoError } from '../paypal.mjs';

const orderId = 'TESTORDER12345';
const response = (record, status = 'CREATED') => ({ id: orderId, status, purchase_units: [{
  custom_id: record.reference, amount: { ...AMOUNT }, payee: { merchant_id: 'MERCHANT123' },
  ...(status === 'COMPLETED' ? { payments: { captures: [{ id: 'CAPTURE123', status: 'COMPLETED', amount: { ...AMOUNT } }] } } : {})
}], links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` }] });

async function setup(t, configured = true) {
  let record, status = 'CREATED', captures = 0, failCapture = false, tamper = false;
  const paypal = { configured,
    async create(r) { record = r; return { id: orderId, merchant: 'MERCHANT123', approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` }; },
    async query() { const data = response(record, status); if (tamper) data.purchase_units[0].amount.value = '100.00'; return data; },
    async capture() { captures++; status = 'COMPLETED'; if (failCapture) throw new DemoError('模拟超时'); }
  };
  // 分配临时端口后动态绑定明确 Origin；监听前无异步窗口。
  let origin;
  const proxy = { ...paypal };
  const server = createApp({ paypal: proxy, origin: 'http://127.0.0.1:1' });
  // createApp 需固定可信 Origin；先取得可用端口，再建立服务。
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const app = createApp({ paypal, origin });
  app.listen(port, '127.0.0.1'); await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  let cookie, csrf;
  async function request(path, { method = 'GET', body = '{}', originHeader = origin, token, useCookie = true } = {}) {
    const r = await fetch(`${origin}${path}`, { method, redirect: 'manual', headers: {
      ...(useCookie && cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST' ? { Origin: originHeader, 'Content-Type': 'application/json', 'X-CSRF-Token': token ?? csrf } : {})
    }, ...(method === 'POST' ? { body } : {}) });
    return r;
  }
  const initial = await request('/api/config'); cookie = initial.headers.get('set-cookie').split(';')[0];
  csrf = (await initial.json()).csrf;
  return { request, get record() { return record; }, get captures() { return captures; },
    approve() { status = 'APPROVED'; }, fail() { failCapture = true; }, tamper() { tamper = true; } };
}

test('未配置凭据时禁止创建，配置输出不含凭据，私密文件不公开', async t => {
  const app = await setup(t, false);
  const cfg = await (await app.request('/api/config')).json();
  assert.equal(cfg.configured, false);
  assert.equal('secret' in cfg, false); assert.equal('clientId' in cfg, false);
  assert.equal((await app.request('/api/orders', { method: 'POST' })).status, 503);
  for (const path of ['/.env', '/server.mjs', '/tests/demo.test.mjs']) assert.equal((await app.request(path)).status, 404);
});

test('跨站、错误 CSRF、价格篡改均拒绝', async t => {
  const app = await setup(t);
  assert.equal((await app.request('/api/orders', { method: 'POST', originHeader: 'https://evil.example' })).status, 403);
  assert.equal((await app.request('/api/orders', { method: 'POST', token: 'bad' })).status, 403);
  assert.equal((await app.request('/api/orders', { method: 'POST', body: '{"amount":"0.01"}' })).status, 400);
});

test('订单属于当前会话；未批准和伪造回调无法收款；取消不执行 capture', async t => {
  const app = await setup(t);
  assert.equal((await app.request('/api/orders', { method: 'POST' })).status, 201);
  assert.equal((await app.request('/api/orders/query', { method: 'POST', useCookie: false })).status, 403);
  assert.equal((await app.request(`/return?state=forged&token=${orderId}`)).status, 400);
  assert.equal((await app.request('/api/orders/capture', { method: 'POST' })).status, 409);
  assert.equal((await app.request(`/cancel?state=${app.record.state}`)).status, 303);
  assert.equal((await app.request('/api/orders/capture', { method: 'POST' })).status, 409);
  assert.equal(app.captures, 0);
});

test('批准后收款再查单；重复操作不重复 capture', async t => {
  const app = await setup(t);
  await app.request('/api/orders', { method: 'POST' });
  app.approve();
  await app.request(`/return?state=${app.record.state}&token=${orderId}`);
  const done = await app.request('/api/orders/capture', { method: 'POST' });
  assert.equal(done.status, 200); assert.equal((await done.json()).verified, true);
  assert.equal((await app.request('/api/orders/capture', { method: 'POST' })).status, 200);
  assert.equal(app.captures, 1);
});

test('capture 响应丢失时，仅按后续查询的已完成状态恢复', async t => {
  const app = await setup(t);
  await app.request('/api/orders', { method: 'POST' }); app.approve(); app.fail();
  await app.request(`/return?state=${app.record.state}&token=${orderId}`);
  const done = await app.request('/api/orders/capture', { method: 'POST' });
  assert.equal(done.status, 200); assert.equal((await done.json()).verified, true); assert.equal(app.captures, 1);
});

test('金额不一致时不收款且不显示成功', async t => {
  const app = await setup(t);
  await app.request('/api/orders', { method: 'POST' }); app.approve(); app.tamper();
  await app.request(`/return?state=${app.record.state}&token=${orderId}`);
  const r = await app.request('/api/orders/capture', { method: 'POST' });
  assert.equal(r.status, 502); assert.equal(app.captures, 0);
});

test('支付校验拒绝错误币种、商户、订单以及待处理收款', () => {
  const r = { ...newRecord('MERCHANT123'), id: orderId };
  assert.equal(checkOrder(response(r, 'COMPLETED'), r, true).verified, true);
  const mutations = [o => o.id = 'OTHER', o => o.purchase_units[0].amount.currency_code = 'EUR',
    o => o.purchase_units[0].payee.merchant_id = 'OTHER',
    o => o.purchase_units[0].payments.captures[0].status = 'PENDING',
    o => o.purchase_units[0].payments.captures[0].amount.value = '0.01'];
  for (const mutate of mutations) { const data = response(r, 'COMPLETED'); mutate(data); assert.throws(() => checkOrder(data, r, true)); }
});

test('真实适配器固定 Sandbox API、后台 OAuth、金额与幂等键；拒绝恶意批准链接', async () => {
  const calls = [];
  const record = newRecord('MERCHANT123');
  let malicious = false;
  const paypal = createPayPal({ clientId: 'test-client', secret: 'test-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return Response.json({ access_token: 'fake-access-token', expires_in: 3600 });
    const data = response(record);
    if (malicious) data.links[0].href = 'https://www.paypal.com/checkoutnow';
    return Response.json(data);
  } });
  await paypal.create(record, 'http://127.0.0.1:8971');
  assert.ok(calls.every(c => new URL(c.url).hostname === 'api-m.sandbox.paypal.com'));
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fake-access-token');
  assert.deepEqual(JSON.parse(calls[1].options.body).purchase_units[0].amount, AMOUNT);
  assert.equal(calls[1].options.headers['PayPal-Request-Id'], record.createId);
  assert.ok(!calls[1].options.body.includes('test-secret'));
  malicious = true; await assert.rejects(paypal.create(record, 'http://127.0.0.1:8971'), /Sandbox/);
});

test('连接失败不把敏感错误返回用户', async () => {
  const paypal = createPayPal({ clientId: 'test-client', secret: 'DO_NOT_LEAK', fetchImpl: async () => { throw new Error('DO_NOT_LEAK'); } });
  await assert.rejects(paypal.query(orderId), e => !e.message.includes('DO_NOT_LEAK') && e instanceof DemoError);
});
