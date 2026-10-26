import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv, pbkdf2Sync, webcrypto } from 'node:crypto';
import { encrypt, decrypt } from '../src/parcel';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
function independentParcel(payload: unknown): string {
 const salt = Buffer.alloc(16, 7); const iv = Buffer.alloc(12, 9);
 const key = pbkdf2Sync('correct horse', salt, 310000, 32, 'sha256');
 const cipher = createCipheriv('aes-256-gcm', key, iv);
 const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
 return JSON.stringify({ v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000 }, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') });
}
describe('independent Node protocol checks', () => {
 it('decrypts a parcel made by a separate AES-GCM implementation', async () => { const payload = { entries: [{ id: 'key', value: 'sample é secret' }] }; expect(await decrypt(independentParcel(payload), 'correct horse')).toEqual(payload); });
 it('exports AES-256-GCM with the specified derivation and tag', async () => {
  const payload = { entries: [{ id: 'key', value: 'sample é secret' }] }; const p = await encrypt(payload, 'correct horse');
  const raw = Buffer.from(p.ct, 'base64'); const key = pbkdf2Sync('correct horse', Buffer.from(p.salt, 'base64'), 310000, 32, 'sha256');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(p.iv, 'base64')); cipher.setAuthTag(raw.subarray(-16));
  expect(JSON.parse(Buffer.concat([cipher.update(raw.subarray(0, -16)), cipher.final()]).toString('utf8'))).toEqual(payload);
 });
 it('rejects invalid decrypted schema after successful authentication', async () => { await expect(decrypt(independentParcel({ entries: [{ id: 'good', value: 'sample' }, { id: 'Bad ID!', value: 'sample' }] }), 'correct horse')).rejects.toThrow('Invalid entry 2'); });
 it('rejects duplicate decrypted IDs before the preview', async () => { await expect(decrypt(independentParcel({ entries: [{ id: 'key', value: 'one' }, { id: 'key', value: 'two' }] }), 'correct horse')).rejects.toThrow('duplicate ID'); });
 it('rejects modified KDF parameters', async () => { const p = JSON.parse(independentParcel({ entries: [] })); p.kdf.iterations = 1; await expect(decrypt(JSON.stringify(p), 'correct horse')).rejects.toThrow('Wrong passphrase or damaged file.'); });
});
