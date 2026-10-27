export type FocusScope = 'paragraph' | 'section' | 'off';
export interface FocusRule { folder: string; scope: FocusScope }
export interface FocusSettings { enabled: boolean; highlight: boolean; scope: 'paragraph' | 'section'; rules: FocusRule[] }
export const DEFAULT_SETTINGS: FocusSettings = { enabled: true, highlight: true, scope: 'paragraph', rules: [] };
const scopes = new Set(['paragraph', 'section', 'off']);

export function normalizeSettings(raw: unknown): FocusSettings {
 const s = raw && typeof raw === 'object' ? raw as Partial<FocusSettings> : {};
 const rules: FocusRule[] = [];
 if (Array.isArray(s.rules)) for (const row of s.rules.slice(0, 100)) {
  if (!row || typeof row.folder !== 'string' || !scopes.has(row.scope)) continue;
  const folder = row.folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!folder || folder.split('/').some(p => p === '.' || p === '..') || rules.some(r => r.folder === folder)) continue;
  rules.push({ folder, scope: row.scope });
 }
 return { enabled: typeof s.enabled === 'boolean' ? s.enabled : true, highlight: typeof s.highlight === 'boolean' ? s.highlight : true, scope: s.scope === 'section' ? 'section' : 'paragraph', rules };
}

/** Pro settings remain saved after sign out, but cannot change the free paragraph scope. */
export function focusPolicy(settings: FocusSettings, path: string, pro: boolean): FocusScope {
 if (!settings.enabled) return 'off';
 if (!pro) return 'paragraph';
 let scope: FocusScope = settings.scope;
 let longest = -1;
 for (const r of settings.rules) if (path.startsWith(r.folder + '/') && r.folder.length > longest) { scope = r.scope; longest = r.folder.length; }
 return scope;
}

export function parseRules(text: string): FocusRule[] {
 return normalizeSettings({ rules: text.split('\n').map(line => {
  const split = line.lastIndexOf('=');
  return split < 0 ? null : { folder: line.slice(0, split), scope: line.slice(split + 1).trim() };
 }) }).rules;
}
