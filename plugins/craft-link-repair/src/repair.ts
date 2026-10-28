import { normalizePath } from 'obsidian';

export const FREE_LIMIT = 10;
export interface SourceFile { path: string; text: string }
export interface RepairOptions {
	folder: string;
	pro?: boolean;
	outputFolder?: string;
	dateFolder?: string;
	dateFormat?: string;
	occupied?: string[];
	receipts?: Record<string, string>;
}
export interface Issue { source: string; url: string; reason: string }
export interface LinkChange { source: string; label: string; url: string; target: string }
export interface Copy { source: string; path: string; text: string }
export interface RepairPlan {
	folder: string;
	copies: Copy[];
	changes: LinkChange[];
	issues: Issue[];
	blocked: string[];
	skipped: string[];
}

/** Accept vault paths. Reject traversal before normalization. */
export function safePath(value: string, allowEmpty = false): string {
	if (!value.trim() && allowEmpty) return '';
	const raw = value.trim().replace(/\\/g, '/');
	if (!raw || raw.startsWith('/') || (raw.includes(':') || [...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) || raw.split('/').some((s) => s === '..' || s === '.' || s.startsWith('.'))) throw new Error('Use a vault folder path without hidden folders or traversal.');
	return normalizePath(raw);
}
export function inside(path: string, folder: string): boolean { return path.startsWith(`${folder}/`); }
function parent(path: string): string { return path.slice(0, path.lastIndexOf('/')); }
function linkPath(path: string): boolean { return !/[[\]#|^\r\n]/.test(path); }
function issue(source: string, reason: string, url = ''): Issue { return { source, url, reason }; }

function dateTarget(value: string, folder: string, format: string): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
	if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
	const name = format === 'YYYY/MM/DD' ? `${match[1]}/${match[2]}/${match[3]}` : format === 'YYYY.MM.DD' ? value.replace(/-/g, '.') : value;
	return folder ? `${folder}/${name}` : name;
}

/** Rebase a simple relative Markdown resource without moving the resource file. */
function rebase(url: string, source: string, destination: string): string {
	if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url) || parent(source) === parent(destination)) return url;
	const bits = parent(source).split('/');
	for (const part of url.split('/')) {
		if (part === '..') { if (!bits.length) return url; bits.pop(); }
		else if (part !== '.') bits.push(part);
	}
	const from = parent(destination).split('/');
	while (from.length && bits.length && from[0] === bits[0]) { from.shift(); bits.shift(); }
	return [...from.map(() => '..'), ...bits].join('/');
}

/** Supported inline links only. Protected text is retained byte for byte. */
export function convertMarkdown(text: string, source: string, destination: string, map: Map<string, string>, dateFolder = '', dateFormat = 'YYYY-MM-DD'): { text: string; changes: LinkChange[]; issues: Issue[] } {
	const changes: LinkChange[] = [], issues: Issue[] = [];
	const protectedText = /((?<![\s\S])---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\n]*(?:\n|$))|(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\3[ \t\r]*(?:\n|$)|(?![\s\S])))|(`+)[^`]*?\4|<!--[\s\S]*?-->|%%[\s\S]*?%%/gm;
	const replace = (part: string): string => part.replace(/(!?)\[((?:\\.|[^\]\\])*)\]\(\s*(<?)([^\s<>)]*)(>?)\s*\)/g, (whole: string, embed: string, label: string, left: string, url: string, right: string, offset: number) => {
		let escapeCount = 0;
		for (let at = offset - 1; at >= 0 && part[at] === '\\'; at--) escapeCount++;
		if (escapeCount % 2 || !url) return whole;
		if (left !== (right ? '<' : '')) return whole;
		if (!/^(craftdocs|day):\/\//i.test(url)) { const at = whole.lastIndexOf(url); return whole.slice(0, at) + rebase(url, source, destination) + whole.slice(at + url.length); }
		if (embed) { issues.push(issue(source, 'Craft image link is not supported', url)); return whole; }
		let target: string | null = null;
		let reason = 'Unsupported Craft URL';
		try {
			// Chromium 120 treats this custom scheme as opaque. Parse the Craft route before its query.
			const route = /^craftdocs:\/\/open(?:\?([^#]*))?(#.*)?$/i.exec(url);
			if (/^day:\/\//i.test(url)) {
				target = dateTarget(decodeURIComponent(url.slice(6)), dateFolder, dateFormat);
				reason = 'Invalid day date';
			} else if (route) {
				const params = new URLSearchParams(route[1] ?? '');
				const page = params.get('documentId') ?? params.get('id') ?? params.get('identifier');
				const block = params.get('blockId');
				if (route[2] || (block && (page ? block.toLowerCase() !== page.toLowerCase() : !map.has(block.toLowerCase())))) reason = 'Block link needs manual repair';
				else {
					const id = page ?? block;
					target = id ? map.get(id.toLowerCase()) ?? null : null;
					reason = id ? 'Missing or ambiguous page identifier' : 'No page identifier';
				}
			}
		} catch { reason = 'Invalid Craft URL'; }
		if (!target) { issues.push(issue(source, reason, url)); return whole; }
		if (!linkPath(target) || /[|[\]\r\n]/.test(label)) { issues.push(issue(source, 'Label or path cannot form a wikilink', url)); return whole; }
		changes.push({ source, label, url, target });
		return `[[${target}|${label}]]`;
	});
	let output = '', end = 0;
	for (const match of text.matchAll(protectedText)) {
		const index = match.index;
		output += replace(text.slice(end, index)) + match[0];
		end = index + match[0].length;
	}
	output += replace(text.slice(end));
	return { text: output, changes, issues };
}

export function planRepair(files: SourceFile[], options: RepairOptions): RepairPlan {
	const folder = safePath(options.folder);
	const outputFolder = options.pro ? safePath(options.outputFolder ?? '', true) : '';
	const dateFolder = options.pro ? safePath(options.dateFolder ?? '', true) : '';
	const dateFormat = options.pro && ['YYYY-MM-DD', 'YYYY.MM.DD', 'YYYY/MM/DD'].includes(options.dateFormat ?? '') ? options.dateFormat ?? 'YYYY-MM-DD' : 'YYYY-MM-DD';
	if (outputFolder && (outputFolder === folder || inside(outputFolder, folder) || inside(folder, outputFolder))) throw new Error('The output folder must be separate from the export folder.');
	const plan: RepairPlan = { folder, copies: [], changes: [], issues: [], blocked: [], skipped: [] };
	const sources = files.filter((f) => inside(f.path, folder) && !f.path.split('/').some((s) => s.startsWith('.')) && !/\.repaired\.md$/i.test(f.path) && !/\/Craft repair report(?: \d+)?\.md$/i.test(f.path));
	const notes = sources.filter((f) => /\.md$/i.test(f.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	const outputs = new Map<string, string>();
	const occupied = new Set((options.occupied ?? []).map((p) => p.toLowerCase()));
	const used = new Set<string>();
	for (const note of notes) {
		const path = normalizePath(outputFolder ? `${outputFolder}/${note.path.slice(folder.length + 1)}` : note.path.replace(/\.md$/i, '.repaired.md'));
		if (!linkPath(path)) { plan.blocked.push(`Unsupported output path: ${path}`); continue; }
		if (used.has(path.toLowerCase())) plan.blocked.push(`Duplicate output path: ${path}`);
		used.add(path.toLowerCase());
		outputs.set(note.path, path);
		if (occupied.has(path.toLowerCase())) {
			if (options.receipts?.[note.path] === path && (options.occupied ?? []).includes(path)) plan.skipped.push(note.path);
			else plan.blocked.push(`Output already exists: ${path}`);
		}
	}
	const map = new Map<string, string>();
	const duplicateIds = new Set<string>();
	for (const info of sources.filter((f) => /\/info\.json$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path))) {
		let data: unknown;
		try { data = JSON.parse(info.text) as unknown; } catch { plan.issues.push(issue(info.path, 'Invalid info.json')); continue; }
		const identifier = data && typeof data === 'object' && 'identifier' in data ? data.identifier : null;
		if (typeof identifier !== 'string' || !identifier.trim()) { plan.issues.push(issue(info.path, 'Missing identifier in info.json')); continue; }
		const siblings = notes.filter((n) => parent(n.path) === parent(info.path));
		const standard = siblings.find((n) => /\/text\.md$/i.test(n.path));
		const target = standard ?? (siblings.length === 1 ? siblings[0] : undefined);
		if (!target) { plan.issues.push(issue(info.path, 'No single Markdown note for identifier')); continue; }
		const path = outputs.get(target.path);
		if (!path) continue;
		const id = identifier.trim().toLowerCase();
		if (map.has(id) || duplicateIds.has(id)) { map.delete(id); duplicateIds.add(id); plan.issues.push(issue(info.path, 'Duplicate page identifier')); }
		else map.set(id, path.replace(/\.md$/i, ''));
	}
	for (const note of notes) {
		if (plan.skipped.includes(note.path)) continue;
		const path = outputs.get(note.path);
		if (!path) continue;
		const converted = convertMarkdown(note.text, note.path, path, map, dateFolder, dateFormat);
		plan.copies.push({ source: note.path, path, text: converted.text });
		plan.changes.push(...converted.changes);
		plan.issues.push(...converted.issues);
	}
	if (!options.pro && plan.copies.length > FREE_LIMIT) plan.blocked.push(`Free limit: ${plan.copies.length} notes exceeds ${FREE_LIMIT}. Select a smaller export folder or use Pro.`);
	return plan;
}

export function reportText(plan: RepairPlan, written: string[], failures: string[] = []): string {
	const line = (s: string) => JSON.stringify(s);
	return ['# Craft repair report', '', `Export folder: ${line(plan.folder)}`, `Copies written: ${written.length}`, `Links in plan: ${plan.changes.length}`, `Unresolved links and metadata issues: ${plan.issues.length}`, '', '## Written copies', ...written.map((p) => `- ${line(p)}`), '', '## Unresolved links and metadata issues', ...plan.issues.map((i) => `- ${line(i.source)}; ${i.reason} ${line(i.url)}`), '', '## Skipped copies', ...plan.skipped.map((s) => `- ${line(s)}`), '', '## Blocked steps and write failures', ...[...plan.blocked, ...failures].map((s) => `- ${line(s)}`), ''].join('\n');
}
