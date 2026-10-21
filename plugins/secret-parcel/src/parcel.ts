export interface Entry { id: string; value: string }
export interface Payload { entries: Entry[] }
export interface Parcel { v: 1; kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: 310000 }; salt: string; iv: string; ct: string }
export interface Storage { listSecrets(): string[]; getSecret(id: string): string | null; setSecret(id: string, value: string): void }
export const PASSPHRASE_ERROR = 'Passphrase must have 8 or more characters.';
export const DECRYPT_ERROR = 'Wrong passphrase or damaged file.';
export const MAX_FILE = 48 * 1024 * 1024;
const encoder = new TextEncoder();
export function checkPassphrase(pass: string): void { if ([...pass].length < 8) throw new Error(PASSPHRASE_ERROR); }
export function validatePayload(input: unknown): Payload {
 if (!input || typeof input !== 'object' || !('entries' in input) || !Array.isArray(input.entries)) throw new Error('Invalid payload: entries must be a list.');
 const seen = new Set<string>();
 const entries: Entry[] = [];
 for (let i = 0; i < input.entries.length; i++) {
  if (i === 500) throw new Error('Invalid entry 501: more than 500 entries.');
  const e: unknown = input.entries[i];
  const label = `Invalid entry ${i + 1}`;
  if (!e || typeof e !== 'object' || !('id' in e) || typeof e.id !== 'string' || !/^[a-z0-9-]{1,128}$/.test(e.id)) throw new Error(`${label}: ID must use lowercase letters, digits or dashes (1 to 128 characters).`);
  if (seen.has(e.id)) throw new Error(`${label} (${e.id}): duplicate ID.`);
  if (!('value' in e) || typeof e.value !== 'string') throw new Error(`${label} (${e.id}): value must be text.`);
  if (encoder.encode(e.value).byteLength > 65536) throw new Error(`${label} (${e.id}): value exceeds 64 KB.`);
  seen.add(e.id); entries.push({ id: e.id, value: e.value });
 }
 return { entries };
}
function base64(bytes: Uint8Array): string {
 let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
function unbase64(s: unknown, size?: number): Uint8Array<ArrayBuffer> {
 if (typeof s !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new Error(DECRYPT_ERROR);
 const data = Uint8Array.from(atob(s), c => c.charCodeAt(0));
 if ((size !== undefined && data.length !== size) || (size === undefined && data.length < 16)) throw new Error(DECRYPT_ERROR);
 return data;
}
async function key(pass: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
 const material = await crypto.subtle.importKey('raw', encoder.encode(pass), 'PBKDF2', false, ['deriveKey']);
 return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encrypt(input: unknown, pass: string): Promise<Parcel> {
 checkPassphrase(pass); const payload = validatePayload(input);
 const plain = encoder.encode(JSON.stringify(payload));
 if (plain.byteLength > 35 * 1024 * 1024) throw new Error('Encrypted parcel would exceed 48 MB. Select fewer IDs.');
 const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
 const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt), plain);
 return { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000 }, salt: base64(salt), iv: base64(iv), ct: base64(new Uint8Array(ct)) };
}
export async function decrypt(text: string, pass: string): Promise<Payload> {
 let plain: unknown;
 try {
  checkPassphrase(pass);
  if (text.length > MAX_FILE) throw new Error(DECRYPT_ERROR);
  const p = JSON.parse(text) as Partial<Parcel>;
  if (!p || p.v !== 1 || p.kdf?.name !== 'PBKDF2' || p.kdf.hash !== 'SHA-256' || p.kdf.iterations !== 310000) throw new Error(DECRYPT_ERROR);
  const salt = unbase64(p.salt, 16); const iv = unbase64(p.iv, 12); const ct = unbase64(p.ct);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(pass, salt), ct);
  plain = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown;
 } catch { throw new Error(DECRYPT_ERROR); }
 return validatePayload(plain);
}
export function preview(payload: Payload, storage: Storage): { newIds: string[]; conflicts: string[] } {
 const entries = validatePayload(payload).entries;
 const current = new Set(storage.listSecrets());
 return { newIds: entries.filter(e => !current.has(e.id)).map(e => e.id), conflicts: entries.filter(e => current.has(e.id)).map(e => e.id) };
}
export interface Report { written: string[]; skipped: string[]; failed: string[] }
export function writePayload(payload: Payload, storage: Storage, overwrites: ReadonlySet<string>): Report {
 const entries = validatePayload(payload).entries;
 const report: Report = { written: [], skipped: [], failed: [] };
 for (const e of entries) {
  try {
   // Check again immediately before each write, including a secret added after the preview.
   if (storage.listSecrets().includes(e.id) && !overwrites.has(e.id)) { report.skipped.push(e.id); continue; }
   storage.setSecret(e.id, e.value);
   if (storage.getSecret(e.id) !== e.value) throw new Error('Read back failed.');
   report.written.push(e.id);
  } catch { report.failed.push(e.id); }
 }
 return report;
}
export async function compare(payload: Payload, storage: Storage): Promise<{ newIds: string[]; missing: string[]; changed: string[]; unchanged: string[] }> {
 const { entries } = validatePayload(payload); const current = new Set(storage.listSecrets());
 const result = { newIds: [] as string[], missing: [...current].filter(id => !entries.some(e => e.id === id)), changed: [] as string[], unchanged: [] as string[] };
 const hash = async (v: string) => base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(v))));
 for (const e of entries) {
  if (!current.has(e.id)) { result.newIds.push(e.id); continue; }
  const value = storage.getSecret(e.id);
  (value !== null && await hash(value) === await hash(e.value) ? result.unchanged : result.changed).push(e.id);
 }
 return result;
}
export function filterIds(ids: string[], prefix: string): string[] { return ids.filter(id => id.startsWith(prefix)); }
export function folderPath(input: string): string {
 const path = input.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
 if (!path || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[:*?"<>|]/.test(part))) throw new Error('Choose a normal vault folder. Hidden folders and relative paths are not allowed.');
 return path;
}
export function fileStamp(d: Date): string {
 const pad = (n: number) => String(n).padStart(2, '0');
 return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
