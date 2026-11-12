import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPayPal, newRecord, checkOrder, DemoError } from './paypal.mjs';

export function createApp({ paypal, merchant = '', origin }) {
  const sessions = new Map();
  const files = { '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  const prune = setInterval(() => {
    for (const [id, s] of sessions) if (Date.now() > s.expires) sessions.delete(id);
  }, 60000);
  prune.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(origin).host) throw new DemoError('无效的本机访问地址。', 403);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && files[url.pathname]) {
        const [name, type] = files[url.pathname];
        res.writeHead(200, { 'Content-Type': type });
        return res.end(await readFile(new URL(`./public/${name}`, import.meta.url)));
      }
      if (!url.pathname.startsWith('/api/') && !['/return', '/cancel'].includes(url.pathname)) return json(404, { error: '未找到。' });
      const cookie = req.headers.cookie?.match(/(?:^|;\s*)demo_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      let session = sessions.get(cookie);
      if (!session || Date.now() > session.expires) {
        const id = randomBytes(32).toString('hex');
        if (sessions.size > 1000) throw new DemoError('本机会话数量过多，请稍后再试。', 429);
        session = { csrf: randomBytes(32).toString('hex'), expires: Date.now() + 3600000, hits: [], record: null, busy: false };
        sessions.set(id, session);
        res.setHeader('Set-Cookie', `demo_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`);
      }
      const record = session.record;
      if (['/return', '/cancel'].includes(url.pathname) && req.method === 'GET') {
        if (!record?.id || url.searchParams.get('state') !== record.state ||
            (url.pathname === '/return' && url.searchParams.get('token') !== record.id)) {
          throw new DemoError('返回链接与当前浏览器订单不匹配，请重新创建测试订单。', 400);
        }
        if (url.pathname === '/cancel') { record.canceled = true; record.approved = false; }
        else if (!record.canceled) record.approved = true;
        res.writeHead(303, { Location: '/' }); return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/api/config') return json(200, {
        configured: paypal.configured, environment: 'Sandbox', amount: '1.00', currency: 'USD',
        csrf: session.csrf, order: record?.id ? { id: record.id, approved: record.approved,
          canceled: record.canceled, approvalUrl: record.approvalUrl, result: record.result ?? null } : null
      });
      if (req.method !== 'POST') return json(405, { error: '请使用页面按钮操作。' });
      if (req.headers.origin !== origin || req.headers['x-csrf-token'] !== session.csrf) throw new DemoError('请求校验失败，请刷新本机页面。', 403);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new DemoError('需要 JSON 请求。', 415);
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1024) throw new DemoError('请求过大。', 413); }
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { throw new DemoError('无效 JSON。', 400); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) throw new DemoError('金额和订单由后端管理，不接受前端修改。', 400);
      session.hits = session.hits.filter(t => Date.now() - t < 60000);
      if (session.hits.length >= 15) throw new DemoError('操作过于频繁，请一分钟后再试。', 429);
      session.hits.push(Date.now());
      if (!paypal.configured) throw new DemoError('尚未配置 Sandbox Client ID / Secret。请先完成账号登录和应用配置。', 503);
      if (session.busy) throw new DemoError('当前订单正在处理，请稍后查询。', 409);
      session.busy = true;
      try {
        if (url.pathname === '/api/orders') {
          if (record?.id && !record.canceled && !record.result?.verified) throw new DemoError('已有未结束订单，请完成付款或在 PayPal 取消后返回。', 409);
          // 保留相同创建请求的幂等键，避免网络超时后重复创建。
          const next = record && !record.id ? record : newRecord(merchant);
          session.record = next;
          Object.assign(next, await paypal.create(next, origin));
          return json(201, { id: next.id, approvalUrl: next.approvalUrl });
        }
        if (!record?.id) throw new DemoError('当前会话没有测试订单。', 404);
        if (url.pathname === '/api/orders/query') {
          const order = await paypal.query(record.id);
          const result = checkOrder(order, record, order.status === 'COMPLETED');
          record.result = result;
          return json(200, result);
        }
        if (url.pathname === '/api/orders/capture') {
          if (record.canceled || !record.approved) throw new DemoError('请先由虚拟买家在 PayPal 批准此订单。', 409);
          let order = await paypal.query(record.id);
          checkOrder(order, record);
          if (order.status !== 'COMPLETED') {
            if (order.status !== 'APPROVED') throw new DemoError('PayPal 尚未确认买家批准，请稍后查询。', 409);
            try { await paypal.capture(record); }
            catch (error) {
              // 捕获超时可能已成功；只按随后查询的状态判定，不盲目再次扣款。
              const recovered = await paypal.query(record.id);
              if (recovered.status !== 'COMPLETED') throw error;
            }
            order = await paypal.query(record.id);
          }
          record.result = checkOrder(order, record, true);
          return json(200, record.result);
        }
        return json(404, { error: '未找到。' });
      } finally { session.busy = false; }
    } catch (error) {
      json(error instanceof DemoError ? error.status : 500, { error: error instanceof DemoError ? error.message : '本地服务处理失败，请重试。' });
    }
  });
  server.on('close', () => clearInterval(prune));
  server.requestTimeout = 65000;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (process.env.PAYPAL_ENVIRONMENT && process.env.PAYPAL_ENVIRONMENT.toLowerCase() !== 'sandbox') throw new Error('本 demo 仅允许 Sandbox。');
  const port = Number(process.env.PORT || 8971);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 无效。');
  const origin = `http://127.0.0.1:${port}`;
  const paypal = createPayPal({ clientId: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET });
  createApp({ paypal, merchant: process.env.PAYPAL_MERCHANT_ID, origin }).listen(port, '127.0.0.1', () => {
    console.log(`PayPal Sandbox demo: ${origin} — ${paypal.configured ? '凭据已配置（尚未验证）' : '等待配置沙盒凭据'}`);
  });
}
