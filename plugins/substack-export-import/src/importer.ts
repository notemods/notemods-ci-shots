import Papa from 'papaparse';
import { strFromU8, unzipSync } from 'fflate';

export const MAX_ZIP_BYTES = 30 * 1024 * 1024;
export const MAX_TEXT_BYTES = 50 * 1024 * 1024;
export const MAX_MEMBERS = 12000;
export const FIELDS = ['title', 'subtitle', 'post_date', 'published', 'audience', 'type', 'podcast_url'] as const;
export type Field = typeof FIELDS[number];
export type Mapping = Record<Field, string>;
export const DEFAULT_MAPPING: Mapping = {
	title: 'title', subtitle: 'subtitle', post_date: 'post_date', published: 'published', audience: 'audience', type: 'type', podcast_url: 'podcast_url',
};
export interface Post {
	id: string;
	source: string;
	properties: Record<string, string | boolean>;
	body: string;
	timestamp?: number;
}
export interface Preview {
	posts: Post[];
	missing: { id: string; path: string }[];
	unmatched: string[];
	rowCount: number;
}
export interface Snapshot { version: 1; bodies: Record<string, string> }
export interface Change { id: string; status: 'added' | 'changed' | 'removed' | 'same'; before: string; after: string }

export function safeMember(path: string): boolean {
	const name = path.endsWith('/') ? path.slice(0, -1) : path;
	return !!name && !/[\\:]/.test(name) && !Array.from(name).some((c) => c.charCodeAt(0) < 32) && !name.startsWith('/') && name.split('/').every((s) => !!s && s !== '.' && s !== '..');
}
export function safeId(id: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(id) && !id.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id);
}
export function validateMapping(mapping: Mapping): void {
	const names = FIELDS.map((f) => mapping[f]);
	if (names.some((n) => !/^[a-z][a-z0-9_]{0,50}$/.test(n)) || new Set(names).size !== names.length || names.some((n) => ['post_id', 'source_html', '__proto__', 'constructor', 'prototype'].includes(n))) {
		throw new Error('Use different property names with lowercase letters, digits and underscores.');
	}
}
export function validateFolder(folder: string): void {
	if (!safeMember(folder) || folder.endsWith('/') || folder.split('/').some((s) => s.startsWith('.') || /[<>"|?*#^[\]]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) {
		throw new Error('Use a safe new folder path. Hidden folders and parent paths are not permitted.');
	}
}

/** The filter checks paths and declared sizes before selected text is decompressed. */
export function readArchive(bytes: Uint8Array): Record<string, string> {
	if (bytes.length > MAX_ZIP_BYTES) throw new Error('The ZIP is larger than 30 MiB.');
	let total = 0;
	let count = 0;
	const names = new Set<string>();
	const files = unzipSync(bytes, { filter: (file) => {
		if (!safeMember(file.name)) throw new Error(`Unsafe ZIP member path: ${file.name}`);
		if (names.has(file.name)) throw new Error(`Duplicate ZIP member: ${file.name}`);
		names.add(file.name);
		if (++count > MAX_MEMBERS) throw new Error('The ZIP has more than 12000 members.');
		const selected = file.name === 'posts.csv' || /^posts\/[^/]+\.html$/.test(file.name);
		if (selected) {
			total += file.originalSize;
			if (total > MAX_TEXT_BYTES) throw new Error('The selected text is larger than 50 MiB.');
		}
		return selected;
	} });
	const text: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const [path, data] of Object.entries(files)) text[path] = strFromU8(data);
	return text;
}

export function prepareImport(members: Record<string, string>, convert: (html: string) => string, mapping: Mapping = DEFAULT_MAPPING): Preview {
	validateMapping(mapping);
	for (const path of Object.keys(members)) if (!safeMember(path)) throw new Error(`Unsafe ZIP member path: ${path}`);
	const csv = members['posts.csv'];
	if (typeof csv !== 'string') throw new Error('The ZIP must contain posts.csv at its root.');
	const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ''), { delimiter: ',', skipEmptyLines: 'greedy', worker: false });
	if (parsed.errors.length) throw new Error(`CSV error: ${parsed.errors[0]?.message ?? 'Invalid CSV'}`);
	const [header, ...rows] = parsed.data;
	if (!header || !header.includes('post_id')) throw new Error('posts.csv must have a post_id column.');
	if (new Set(header).size !== header.length) throw new Error('posts.csv has duplicate column names.');
	const ids = new Set<string>();
	const filenames = new Set<string>();
	const records = rows.map((row) => {
		if (row.length !== header.length) throw new Error('A CSV row has the wrong field count.');
		const record = Object.fromEntries(header.map((key, i) => [key, row[i] ?? '']));
		const id = record['post_id'] ?? '';
		if (!safeId(id)) throw new Error(`Unsafe or empty post ID: ${id}`);
		if (ids.has(id)) throw new Error(`Duplicate post ID: ${id}. No notes were written.`);
		ids.add(id);
		if (filenames.has(id.toLowerCase())) throw new Error('Post IDs have a filename case conflict.');
		filenames.add(id.toLowerCase());
		return { id, record };
	});
	const posts: Post[] = [];
	const missing: Preview['missing'] = [];
	const matched = new Set<string>();
	for (const { id, record } of records) {
		const source = `posts/${id}.html`;
		const html = members[source];
		if (typeof html !== 'string') { missing.push({ id, path: source }); continue; }
		matched.add(source);
		const properties: Record<string, string | boolean> = { post_id: id, source_html: source };
		for (const field of FIELDS) {
			const value = record[field === 'published' ? 'is_published' : field] ?? '';
			properties[mapping[field]] = field === 'published' && /^(true|false)$/i.test(value) ? value.toLowerCase() === 'true' : value;
		}
		const date = record['post_date'] ?? '';
		const timestamp = /^\d{4}-\d{2}-\d{2}(?:T| |$)/.test(date) ? Date.parse(date) : NaN;
		posts.push({ id, source, properties, body: convert(html).trim(), ...(Number.isFinite(timestamp) ? { timestamp } : {}) });
	}
	const unmatched = Object.keys(members).filter((path) => /^posts\/[^/]+\.html$/.test(path) && !matched.has(path)).sort();
	return { posts, missing, unmatched, rowCount: rows.length };
}

export function makeReport(preview: Preview): string {
	const lines = ['# Substack import report', '', `Matched rows: ${preview.posts.length}`, `Unmatched rows: ${preview.missing.length}`, `HTML files with no CSV row: ${preview.unmatched.length}`, '', '## Missing HTML', ''];
	lines.push(...(preview.missing.length ? preview.missing.map((r) => `- ID \`${r.id}\`: \`${r.path}\``) : ['None.']));
	lines.push('', '## HTML files with no CSV row', '');
	lines.push(...(preview.unmatched.length ? preview.unmatched.map((p) => `- ${JSON.stringify(p)}`) : ['None.']));
	lines.push('', 'Duplicate IDs stop preview. No notes are written for that export.', '', 'Subscriber data and delivery statistics were not imported.', '');
	return lines.join('\n');
}
export function makeSnapshot(preview: Preview): Snapshot {
	return { version: 1, bodies: Object.fromEntries(preview.posts.map((p) => [p.id, p.body])) };
}
export function parseSnapshot(text: string): Snapshot {
	if (text.length > MAX_TEXT_BYTES) throw new Error('The snapshot is larger than 50 MiB.');
	const saved: unknown = JSON.parse(text);
	if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 || !('bodies' in saved) || !saved.bodies || typeof saved.bodies !== 'object' || Array.isArray(saved.bodies)) throw new Error('This is not an import snapshot.');
	const entries = Object.entries(saved.bodies as Record<string, unknown>);
	if (entries.length > MAX_MEMBERS || entries.some(([id, body]) => !safeId(id) || typeof body !== 'string')) throw new Error('The snapshot has invalid post data.');
	return { version: 1, bodies: Object.fromEntries(entries) as Record<string, string> };
}
export function compareBodies(before: Snapshot, preview: Preview): Change[] {
	const after = makeSnapshot(preview).bodies;
	const result: Change[] = [];
	for (const id of [...new Set([...Object.keys(before.bodies), ...Object.keys(after)])].sort()) {
		const had = Object.prototype.hasOwnProperty.call(before.bodies, id);
		const has = Object.prototype.hasOwnProperty.call(after, id);
		const a = before.bodies[id] ?? '';
		const b = after[id] ?? '';
		result.push({ id, status: !had ? 'added' : !has ? 'removed' : a === b ? 'same' : 'changed', before: a, after: b });
	}
	return result;
}
