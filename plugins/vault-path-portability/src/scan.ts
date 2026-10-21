import { CASE_FOLD } from './unicode';

export type Rule = 'case-collision' | 'reserved-name' | 'trailing-character' | 'illegal-character' | 'long-path' | 'long-name' | 'link-character';
export interface Finding { rule: Rule; paths: string[] }
export const RULES: Record<Rule, string> = {
	'case-collision': 'Case-fold collisions',
	'reserved-name': 'Windows reserved names',
	'trailing-character': 'Trailing dots or spaces',
	'illegal-character': 'Characters unsafe across devices',
	'long-path': 'Windows path length risk',
	'long-name': 'Names over 255 UTF-8 bytes',
	'link-character': 'Characters that can break Obsidian links',
};
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
// Includes C0 controls, DEL and the Windows forbidden character set. Slashes separate segments.
// eslint-disable-next-line no-control-regex -- Path auditing must detect forbidden C0 control characters.
const ILLEGAL = /[<>:"\\|?*\x00-\x1f\x7f]/u;
export function fold(path: string): string {
	return Array.from(path.normalize('NFC'), c => CASE_FOLD[c] ?? c.toLowerCase()).join('').normalize('NFC');
}
export function lengthScope(basePath?: string): string {
	return basePath === undefined
		? 'Absolute vault root unavailable. Length checks use relative paths plus the NUL terminator; shorter paths may also exceed Windows limits.'
		: 'Length checks include the current absolute vault root, separators and NUL terminator. A destination root can have a different length.';
}
const bytes = (value: string): number => new TextEncoder().encode(value).length;
const rootPrefix = (basePath?: string): string => basePath === undefined ? '' : basePath.replace(/[\\/]+$/u, '') + '/';
const LINK = /[#^[\]|]/u;
export function scanPaths(input: readonly string[], basePath?: string): Finding[] {
	const paths = [...new Set(input.filter(p => p !== '' && p !== '/'))].sort();
	const out: Finding[] = [];
	const folded = new Map<string, string[]>();
	for (const path of paths) {
		const key = fold(path);
		const group = folded.get(key) ?? [];
		group.push(path);
		folded.set(key, group);
		const segments = path.split('/');
		if (segments.some(s => RESERVED.test(s.replace(/[ .]+$/u, '')))) out.push({ rule: 'reserved-name', paths: [path] });
		if (segments.some(s => /[ .]$/u.test(s))) out.push({ rule: 'trailing-character', paths: [path] });
		if (segments.some(s => ILLEGAL.test(s))) out.push({ rule: 'illegal-character', paths: [path] });
		if (rootPrefix(basePath).length + path.length + 1 > 260) out.push({ rule: 'long-path', paths: [path] });
		if (segments.some(s => bytes(s) > 255)) out.push({ rule: 'long-name', paths: [path] });
		if (segments.some(s => LINK.test(s))) out.push({ rule: 'link-character', paths: [path] });
	}
	for (const group of folded.values()) {
		if (group.length > 1 && new Set(group.map(p => p.normalize('NFC'))).size > 1) out.push({ rule: 'case-collision', paths: group });
	}
	return out.sort((a, b) => a.rule.localeCompare(b.rule) || a.paths[0]!.localeCompare(b.paths[0]!));
}

/** Fix only the selected leaf. A problematic parent needs its own explicit rename. */
export function suggestPath(path: string, occupied: readonly string[], folder = false, basePath?: string): string | null {
	const slash = path.lastIndexOf('/');
	const parent = path.slice(0, slash + 1);
	if (parent && scanPaths([parent.slice(0, -1)], basePath).length) return null;
	const ancestors = parent.split('/').filter(Boolean).map((_, i, parts) => parts.slice(0, i + 1).join('/'));
	if (ancestors.some(a => occupied.some(p => p !== a && fold(p) === fold(a)))) return null;
	const original = path.slice(slash + 1);
	let leaf = Array.from(original.normalize('NFC').replace(/\u00a0/g, ' '), c => ILLEGAL.test(c) || LINK.test(c) ? '-' : c).join('').replace(/[ .]+$/u, '');
	if (!leaf || leaf === '.' || leaf === '..') leaf = 'Untitled';
	if (RESERVED.test(leaf)) leaf = `_${leaf}`;
	const dot = folder ? -1 : leaf.lastIndexOf('.');
	const ext = dot > 0 ? leaf.slice(dot) : '';
	const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
	const used = new Set(occupied.filter(p => p !== path).map(fold));
	for (let i = 0; i < 10000; i++) {
		const suffix = i === 0 ? '' : `-${i + 1}`;
		const budget = Math.min(180, 259 - rootPrefix(basePath).length - parent.length) - ext.length - suffix.length;
		if (budget < 1) return null;
		// Array.from avoids cutting a surrogate pair. The budget counts UTF-16 units.
		let short = '';
		for (const c of stem) { if (short.length + c.length > budget || bytes(short + c + suffix + ext) > 255) break; short += c; }
		short = short.replace(/[ .]+$/u, '') || 'N';
		const candidate = `${parent}${short}${suffix}${ext}`;
		if (candidate !== path && !used.has(fold(candidate)) && scanPaths([candidate], basePath).length === 0) return candidate;
	}
	return null;
}
const code = (path: string): string => {
	const visible = path.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
	const runs = visible.match(/`+/g) ?? [];
	const fence = '`'.repeat(Math.max(0, ...runs.map(run => run.length)) + 1);
	return `${fence} ${visible} ${fence}`;
};
export function markdownReport(findings: readonly Finding[], basePath?: string): string {
	const lines = ['# Vault path portability report', '', `${findings.length} findings. Indexed vault paths only. ${lengthScope(basePath)} NFC/NFD collisions are not detected because Obsidian normalizes its index.`, ''];
	for (const rule of Object.keys(RULES) as Rule[]) {
		const group = findings.filter(f => f.rule === rule);
		if (!group.length) continue;
		lines.push(`## ${RULES[rule]}`, '');
		for (const finding of group) lines.push(`- ${finding.paths.map(code).join(' ↔ ')}`);
		lines.push('');
	}
	if (!findings.length) lines.push('No indexed path issues found. This is not a guarantee for every file system or sync service.');
	return lines.join('\n');
}
