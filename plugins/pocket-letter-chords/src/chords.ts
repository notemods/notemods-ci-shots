export interface Binding { keys: string; text: string }
export interface Dictionary { name: string; folder: string; bindings: Binding[] }
export interface ChordSettings { paused: boolean; dictionaries: Dictionary[] }
export const WINDOW_MS = 80;
export function chordKey(value: string): string {
 const key = value.replace(/\+/g, '').trim();
 if (!/^[a-z]{2,3}$/.test(key) || new Set(key).size !== key.length) throw new Error('Use two or three different lowercase ASCII letters.');
 return [...key].sort().join('');
}
function addBinding(result: Binding[], row: unknown): void {
 if (!row || typeof row !== 'object') throw new Error('Invalid chord row.');
 const r = row as Partial<Binding>;
 if (typeof r.keys !== 'string' || typeof r.text !== 'string' || !r.text.length || r.text.length > 10000) throw new Error('Each chord needs letters and text, up to 10000 characters.');
 const keys = chordKey(r.keys);
 if (result.some(b => b.keys === keys || [...b.keys].every(k => keys.includes(k)) || [...keys].every(k => b.keys.includes(k)))) throw new Error('Conflict: duplicate chord or two-letter chord inside a three-letter chord.');
 result.push({ keys, text: r.text });
}
export function validateBindings(value: unknown): Binding[] {
 if (!Array.isArray(value) || value.length > 500) throw new Error('Use a list with up to 500 chords.');
 const result: Binding[] = [];
 for (const row of value as unknown[]) addBinding(result, row);
 return result;
}
/** Keeps each valid saved row, so one bad row in data.json does not remove the other rows on the next save. */
function savedBindings(value: unknown): Binding[] {
 const result: Binding[] = [];
 if (Array.isArray(value)) for (const row of value.slice(0, 500) as unknown[]) {
  try { addBinding(result, row); } catch { /* Invalid rows are omitted. */ }
 }
 return result;
}
export function checkFolder(name: string, path: string): void {
 if (!name.trim() || !path || path === '/' || path === '.' || path.split('/').includes('..')) throw new Error('Enter a name and a vault folder path.');
}
export function normalizeSettings(value: unknown): ChordSettings {
 const s = value && typeof value === 'object' ? value as Partial<ChordSettings> : {};
 const dictionaries: Dictionary[] = [];
 if (Array.isArray(s.dictionaries)) for (const d of s.dictionaries.slice(0, 50)) {
  try {
   if (typeof d.name !== 'string' || typeof d.folder !== 'string') continue;
   dictionaries.push({ name: d.name.slice(0, 100), folder: d.folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), bindings: savedBindings(d.bindings) });
  } catch { /* Invalid dictionaries are omitted. */ }
 }
 if (!dictionaries.length || dictionaries[0]?.folder !== '') dictionaries.unshift({ name: 'Default', folder: '', bindings: [] });
 return { paused: s.paused === true, dictionaries };
}
export function chooseDictionary(settings: ChordSettings, path: string, pro: boolean): Dictionary {
 const fallback = settings.dictionaries[0]!;
 if (!pro) return fallback;
 return settings.dictionaries.slice(1).filter(d => d.folder && path.startsWith(d.folder + '/')).sort((a,b) => b.folder.length - a.folder.length)[0] ?? fallback;
}
export function parseDictionary(text: string): Binding[] {
 if (text.length > 1000000) throw new Error('Dictionary file exceeds 1 MB of text.');
 const data: unknown = JSON.parse(text);
 if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1) throw new Error('Use a version 1 dictionary file.');
 return validateBindings((data as { bindings?: unknown }).bindings);
}
export function exportDictionary(bindings: Binding[]): string { return JSON.stringify({ version: 1, bindings: validateBindings(bindings) }, null, 2) + '\n'; }
/** Buffers presses until a match, a release or the deadline. No editor or clock dependency. */
export class ChordEngine {
 readonly held = new Set<string>();
 private pending: string[] = [];
 private used = new Set<string>();
 private deadline = 0;
 constructor(readonly bindings: Binding[], private readonly insert: (text: string) => void) {}
 get waiting(): boolean { return this.pending.length > 0; }
 timeLeft(now: number): number { return this.waiting ? Math.max(0, this.deadline - now) : 0; }
 tick(now: number): void { if (this.waiting && now >= this.deadline) this.flush(); }
 down(key: string, now: number, repeat = false): boolean {
  this.tick(now);
  if (this.used.has(key)) return true;
  if (repeat || this.held.has(key)) { this.flush(); return false; }
  if (this.held.size && !this.waiting) return false;
  if (!this.waiting && !this.bindings.some(b => b.keys.includes(key))) return false;
  this.held.add(key);
  if (!this.waiting) this.deadline = now + WINDOW_MS;
  this.pending.push(key);
  const keys = [...this.held].sort().join('');
  const match = this.bindings.find(b => b.keys === keys);
  if (match) {
   this.pending = [];
   this.used = new Set(this.held);
   this.insert(match.text);
  } else if (!this.bindings.some(b => [...this.held].every(k => b.keys.includes(k)))) this.flush();
  return true;
 }
 up(key: string): void { if (this.pending.includes(key)) this.flush(); this.held.delete(key); this.used.delete(key); }
 flush(): void { const text = this.pending.join(''); this.pending = []; if (text) this.insert(text); }
 reset(): void { this.flush(); this.held.clear(); this.used.clear(); this.deadline = 0; }
}
