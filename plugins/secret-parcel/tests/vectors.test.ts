import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import vectors from './vectors/secret-parcel.json';
import { encrypt, decrypt, validatePayload, checkPassphrase, writePayload, preview, compare, filterIds, folderPath, type Payload, type Storage } from '../src/parcel';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
function memory(values: Record<string, string> = {}): Storage {
 const data = { ...values };
 return { listSecrets: () => Object.keys(data), getSecret: id => data[id] ?? null, setSecret: (id, value) => { data[id] = value; } };
}
async function run(args: unknown[]): Promise<unknown> {
 const [op, a, b, c] = args;
 try {
  switch (op) {
   case 'pass': checkPassphrase(a as string); return 'ok';
   case 'selection': return (a as string[]).length > 0;
   case 'validate': validatePayload(a); return 'ok';
   case 'count': validatePayload({ entries: Array.from({ length: a as number }, (_, i) => ({ id: `key-${i}`, value: 'x' })) }); return 'ok';
   case 'size': validatePayload({ entries: [{ id: 'key', value: 'x'.repeat(a as number) }] }); return 'ok';
   case 'unicode': validatePayload({ entries: [{ id: 'key', value: 'é'.repeat(a as number) }] }); return 'ok';
   case 'folder': return folderPath(a as string);
   case 'filter': return filterIds(a as string[], b as string);
   case 'write': return writePayload(a as Payload, memory(b as Record<string, string>), new Set(c as string[]));
   case 'preview': return preview(a as Payload, memory(b as Record<string, string>));
   case 'compare': return compare(a as Payload, memory(b as Record<string, string>));
   case 'random': { const x = await encrypt(a, 'correct horse'); const y = await encrypt(a, 'correct horse'); return { saltDiffers: x.salt !== y.salt, ivDiffers: x.iv !== y.iv }; }
   case 'roundtrip': { const p = await encrypt(a, 'correct horse'); const text = JSON.stringify(p); return { identical: JSON.stringify(await decrypt(text, 'correct horse')) === JSON.stringify(a), hidden: !text.includes('sk-') && !text.includes('ghp_'), v: p.v, iterations: p.kdf.iterations, saltBytes: atob(p.salt).length, ivBytes: atob(p.iv).length }; }
   case 'wrong-short': return await decrypt(JSON.stringify(await encrypt(a, 'correct horse')), 'wrong');
   case 'wrong': return await decrypt(JSON.stringify(await encrypt(a, 'correct horse')), 'incorrect horse');
   case 'tamper': { const p = await encrypt(a, 'correct horse'); const bytes = Uint8Array.from(atob(p.ct), c => c.charCodeAt(0)); bytes[0] = bytes[0]! ^ 1; p.ct = btoa(String.fromCharCode(...bytes)); return await decrypt(JSON.stringify(p), 'correct horse'); }
   default: throw new Error('Unknown operation');
  }
 } catch (e) { return (e as Error).message; }
}
describe('golden vectors', () => { for (const c of vectors.cases) it(c.name, async () => { expect(await run(c.args)).toEqual(c.expected); }); });
