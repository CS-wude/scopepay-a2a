import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxConfig, createBraintreeSandbox, verifyTransaction } from '../braintree.mjs';

const env = { BRAINTREE_MERCHANT_ID: 'merchant', BRAINTREE_PUBLIC_KEY: 'public',
  BRAINTREE_PRIVATE_KEY: 'private-do-not-print', BRAINTREE_MERCHANT_ACCOUNT_ID: 'usd-account' };
const orderId = 'local-demo-12345678-1234-1234-1234-123456789012';
const transaction = { id: 'tx123', type: 'sale', amount: '1.00', currencyIsoCode: 'USD',
  merchantAccountId: 'usd-account', orderId, status: 'submitted_for_settlement' };

test('Braintree 拒绝生产配置，缺凭据时不创建客户端', () => {
  assert.throws(() => sandboxConfig({ ...env, BRAINTREE_ENVIRONMENT: 'production' }), /Sandbox/);
  assert.equal(sandboxConfig({}).configured, false);
  assert.throws(() => createBraintreeSandbox({}, {}), /缺少/);
});

test('Braintree 核对交易引用、商户、金额、币种及结算状态', () => {
  const expected = { orderId, merchantAccountId: 'usd-account' };
  assert.equal(verifyTransaction(transaction, expected).verified, true);
  assert.equal(verifyTransaction(transaction, expected).settled, false);
  assert.equal(verifyTransaction({ ...transaction, status: 'settled' }, expected).settled, true);
  for (const patch of [{ amount: '0.01' }, { currencyIsoCode: 'EUR' }, { merchantAccountId: 'other' },
    { orderId: 'other' }, { type: 'credit' }, { status: 'processor_declined' }, { status: 'authorized' }]) {
    assert.throws(() => verifyTransaction({ ...transaction, ...patch }, expected));
  }
});

test('Braintree 请求固定沙盒、测试nonce及1美元；查单再次校验', async () => {
  let options, payload;
  const sdk = { Environment: { Sandbox: Symbol('Sandbox') }, BraintreeGateway: class {
    constructor(config) { options = config; }
    merchantAccount = { find: async () => ({ id: 'usd-account', currencyIsoCode: 'USD', status: 'active' }) };
    transaction = { sale: async body => { payload = body; return { success: true, transaction }; }, find: async () => transaction };
  } };
  const adapter = createBraintreeSandbox(sdk, env);
  await adapter.preflight();
  const created = await adapter.create(orderId);
  assert.equal(options.environment, sdk.Environment.Sandbox);
  assert.equal(payload.amount, '1.00'); assert.equal(payload.paymentMethodNonce, 'fake-valid-nonce');
  assert.equal(payload.options.submitForSettlement, true);
  assert.equal((await adapter.query(created)).verified, true);
  await assert.rejects(adapter.query({ ...created, orderId: 'wrong' }));
});

test('Braintree 原始SDK错误不泄露给终端', async () => {
  const sdk = { Environment: { Sandbox: 'sandbox' }, BraintreeGateway: class {
    merchantAccount = { find: async () => { throw new Error('private-do-not-print'); } };
  } };
  await assert.rejects(createBraintreeSandbox(sdk, env).preflight(), e => !e.message.includes('private-do-not-print'));
});
