import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { sandboxConfig, createBraintreeSandbox, SandboxError } from './braintree.mjs';

let lock, lockPath;
try {
  try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = sandboxConfig(process.env);
  if (process.argv.includes('--status')) {
    console.log(JSON.stringify({ provider: 'Braintree', environment: 'Sandbox',
      configured: config.configured, missing: config.missing, amount: '1.00', currency: 'USD' }, null, 2));
  } else {
    if (!config.configured) throw new SandboxError(`等待本地沙盒配置：${config.missing.join(', ')}`);
    const { default: sdk } = await import('braintree');
    const sandbox = createBraintreeSandbox(sdk, process.env);
    const root = new URL('./.evidence/', import.meta.url);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const accountTag = createHash('sha256').update(`${config.merchantId}:${config.merchantAccountId}`).digest('hex').slice(0, 16);
    const journal = new URL(`braintree-${accountTag}.json`, root);
    lockPath = new URL(`braintree-${accountTag}.lock`, root);
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch { throw new SandboxError('已有测试运行，或保留了未处理的运行锁，请先检查后台交易与本地 .evidence 记录。'); }
    let record;
    try { record = JSON.parse(await readFile(journal, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const save = value => writeFile(journal, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    if (record && !record.id) throw new SandboxError('上次创建请求的结果待人工核实。请按 .evidence 里的 orderId 在沙盒后台查询；程序不会自动再创建。');
    if (!record) {
      await sandbox.preflight();
      record = { phase: 'creating', orderId: `local-demo-${randomUUID()}`,
        createdAt: new Date().toISOString(), environment: 'Sandbox' };
      await save(record); // 请求发出前记录引用；超时或崩溃后不会盲目重试。
      const created = await sandbox.create(record.orderId);
      record = { ...record, ...created, phase: 'created' };
      await save(record);
    }
    const queried = await sandbox.query(record);
    const verified = { ...record, ...queried, phase: 'queried', queriedAt: new Date().toISOString() };
    await save(verified);
    console.log(JSON.stringify(verified, null, 2));
    console.log(queried.settled ? '沙盒交易已查询并核验为 settled。' : '沙盒交易已查询并核验；当前尚非 settled，不能表述为已完成结算。');
  }
} catch (error) {
  console.error(error instanceof SandboxError ? error.message : '本地沙盒检查未完成，请检查配置与运行记录。');
  process.exitCode = 1;
} finally {
  if (lock) { await lock.close(); await unlink(lockPath); }
}
