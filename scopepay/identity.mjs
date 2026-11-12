import { generateKeyPairSync, createHash, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw new Error('Unsupported signed document value');
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function createIdentity(id) {
  const pair = generateKeyPairSync('ed25519');
  return { id, privateKey: pair.privateKey.export({type:'pkcs8',format:'pem'}),
    publicKey: pair.publicKey.export({type:'spki',format:'pem'}) };
}
export function loadIdentity(directory,id) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const file = `${directory}/${id}.json`;
  try { return JSON.parse(readFileSync(file,'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const identity = createIdentity(id);
    writeFileSync(file,JSON.stringify(identity),{mode:0o600,flag:'wx'}); return identity;
  }
}
export function signDocument(payload,privateKey) {
  return {payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
}
export function verifyDocument(envelope,publicKey) {
  if (!envelope?.payload || typeof envelope.signature !== 'string' ||
      !verify(null,Buffer.from(canonical(envelope.payload)),publicKey,Buffer.from(envelope.signature,'base64')))
    throw new Error('Invalid document signature');
  return envelope.payload;
}
