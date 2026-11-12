import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {requestId} from '../scopepay/public/request-id.mjs';

test('uses native UUID generation when available',()=>{
  const crypto={randomUUID(){assert.equal(this,crypto);return 'native-id';}};
  assert.equal(requestId(crypto),'native-id');
});

test('LAN HTTP fallback generates unique RFC 4122 version 4 UUIDs without randomUUID',()=>{
  const crypto={getRandomValues:array=>webcrypto.getRandomValues(array)};
  const ids=Array.from({length:1000},()=>requestId(crypto));
  assert.equal(new Set(ids).size,1000);
  for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('does not use weak randomness when cryptographic generation is unavailable',()=>{
  assert.throws(()=>requestId({}),/浏览器不支持安全随机数/);
  assert.throws(()=>requestId(null),/浏览器不支持安全随机数/);
});
