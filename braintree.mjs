export class SandboxError extends Error {}
export function sandboxConfig(env) {
  if (env.BRAINTREE_ENVIRONMENT && env.BRAINTREE_ENVIRONMENT.toLowerCase() !== 'sandbox')
    throw new SandboxError('此测试仅允许 Braintree Sandbox。');
  const keys = ['BRAINTREE_MERCHANT_ID', 'BRAINTREE_PUBLIC_KEY', 'BRAINTREE_PRIVATE_KEY', 'BRAINTREE_MERCHANT_ACCOUNT_ID'];
  const missing = keys.filter(k => !env[k]?.trim());
  return { configured: !missing.length, missing, merchantId: env.BRAINTREE_MERCHANT_ID?.trim(),
    publicKey: env.BRAINTREE_PUBLIC_KEY?.trim(), privateKey: env.BRAINTREE_PRIVATE_KEY?.trim(),
    merchantAccountId: env.BRAINTREE_MERCHANT_ACCOUNT_ID?.trim() };
}

export function verifyTransaction(transaction, expected) {
  if (!transaction?.id || transaction.type !== 'sale' || transaction.amount !== '1.00' ||
      transaction.currencyIsoCode !== 'USD' || transaction.orderId !== expected.orderId ||
      transaction.merchantAccountId !== expected.merchantAccountId ||
      (expected.id && transaction.id !== expected.id)) throw new SandboxError('沙盒交易核验失败：编号、类型、引用、金额、币种或商户账户不匹配。');
  const state = transaction.status;
  if (!['submitted_for_settlement', 'settling', 'settled', 'settlement_pending', 'settlement_confirmed'].includes(state))
    throw new SandboxError('沙盒交易未处于已提交结算或已结算状态，请在后台检查。');
  return { provider: 'Braintree', environment: 'Sandbox', id: transaction.id,
    orderId: transaction.orderId, merchantAccountId: transaction.merchantAccountId,
    amount: '1.00', currency: 'USD', status: state, verified: true, settled: state === 'settled' };
}

// SDK对象由入口加载；测试注入的替身只作用于本地单元测试。
export function createBraintreeSandbox(sdk, env) {
  const config = sandboxConfig(env);
  if (!config.configured) throw new SandboxError(`缺少本地配置：${config.missing.join(', ')}`);
  const gateway = new sdk.BraintreeGateway({ environment: sdk.Environment.Sandbox,
    merchantId: config.merchantId, publicKey: config.publicKey, privateKey: config.privateKey });
  async function safe(action) {
    try { return await action(); }
    catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError('Braintree 沙盒请求未完成。请核对网络、沙盒凭据和后台交易记录；不要自动重复创建交易。');
    }
  }
  return {
    merchantAccountId: config.merchantAccountId,
    async preflight() {
      return safe(async () => {
        const account = await gateway.merchantAccount.find(config.merchantAccountId);
        if (account?.id !== config.merchantAccountId || account.currencyIsoCode !== 'USD' || account.status !== 'active')
          throw new SandboxError('测试需要当前沙盒下处于 active 状态的 USD 商户账户。请检查 Merchant Account ID。');
      });
    },
    async create(orderId) {
      if (!/^local-demo-[a-f0-9-]{36}$/.test(orderId)) throw new SandboxError('无效的本地测试引用。');
      return safe(async () => {
        const result = await gateway.transaction.sale({ amount: '1.00',
          merchantAccountId: config.merchantAccountId, orderId,
          paymentMethodNonce: 'fake-valid-nonce', options: { submitForSettlement: true } });
        if (!result.success || !result.transaction?.id) throw new SandboxError('Braintree 未接受测试交易，请查看沙盒后台；不得将此结果视为付款成功。');
        return verifyTransaction(result.transaction, { orderId, merchantAccountId: config.merchantAccountId });
      });
    },
    query(record) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(record.id ?? '')) throw new SandboxError('无效的沙盒交易编号。');
      return safe(async () => verifyTransaction(await gateway.transaction.find(record.id), {
        ...record, merchantAccountId: config.merchantAccountId
      }));
    }
  };
}
