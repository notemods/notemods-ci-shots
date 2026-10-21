export interface Embed { link: string; start: number; end: number }
export interface Document { text: string; body: string; embeds: Embed[] }
export interface Region { start: number; end: number }
export interface SearchStore {
	paths(): string[];
	read(path: string): Promise<Document>;
	resolve(link: string, from: string): { path: string; subpath: string } | null;
	region(path: string, subpath: string, text: string): Promise<Region | null>;
}
export interface Match { container: string; source: string; subpath: string; depth: number; excerpt: string }
export interface Diagnostic { container: string; source: string; target: string; reason: string }
export interface SearchResult { matches: Match[]; diagnostics: Diagnostic[]; scanned: number; cancelled: boolean }
export interface SearchOptions { folder: string; query: string; note?: string; cancelled?: () => boolean; progress?: (count: number) => void; yield?: () => Promise<void> }

/** Mask examples and front matter with spaces. Keep offsets for source ranges. */
export function searchable(text: string): string {
	let fence = '';
	let frontmatter = text.startsWith('---\n') || text.startsWith('---\r\n');
	let lineNumber = 0;
	const lines = (text.match(/[^\n]*\n|[^\n]+$/g) ?? []);
	const blocks = lines.map((line) => {
		const index = lineNumber++;
		if (frontmatter) {
			if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
			return line.replace(/[^\r\n]/g, ' ');
		}
		const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence) {
			if (mark && mark[0] === fence[0] && mark.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = '';
			return line.replace(/[^\r\n]/g, ' ');
		}
		if (mark) { fence = mark; return line.replace(/[^\r\n]/g, ' '); }
		return line;
	}).join('');
	// A code span ends at a run of the same length, including across lines, but not across a blank line.
	const ticks = [...blocks.matchAll(/`+/g)];
	const nextTick = new Map<number, number>();
	const byLength = new Map<number, number>();
	let right = blocks.length;
	for (const tick of ticks.reverse()) {
		if (/\n[\t ]*\r?\n/.test(blocks.slice(tick.index, right))) byLength.clear();
		right = tick.index;
		const next = byLength.get(tick[0].length);
		if (next !== undefined) nextTick.set(tick.index, next + tick[0].length);
		byLength.set(tick[0].length, tick.index);
	}
	const parts: string[] = [];
	const tokens = /`+|%%|<!--/g;
	let copied = 0;
	let token: RegExpExecArray | null;
	while ((token = tokens.exec(blocks))) {
		let slashes = 0;
		for (let i = token.index - 1; i >= 0 && blocks[i] === '\\'; i--) slashes++;
		if (slashes % 2) continue;
		let end = nextTick.get(token.index);
		if (token[0][0] !== '`') {
			const close = token[0] === '%%' ? '%%' : '-->';
			const at = blocks.indexOf(close, tokens.lastIndex);
			end = at < 0 ? blocks.length : at + close.length;
		}
		if (end === undefined) continue;
		parts.push(blocks.slice(copied, token.index), blocks.slice(token.index, end).replace(/[^\r\n]/g, ' '));
		copied = end; tokens.lastIndex = end;
	}
	parts.push(blocks.slice(copied));
	return parts.join('');
}

export function parseDocument(text: string): Document {
	const masked = searchable(text);
	const embeds: Embed[] = [];
	const re = /!\[\[([^\]\n]+)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(masked))) {
		const start = match.index;
		let slashes = 0;
		for (let i = start - 1; i >= 0 && masked[i] === '\\'; i--) slashes++;
		if (slashes % 2) continue;
		embeds.push({ link: match[1]!.split('|')[0]!.trim(), start, end: re.lastIndex });
	}
	const parts: string[] = [];
	let offset = 0;
	for (const embed of embeds) {
		parts.push(masked.slice(offset, embed.start), ' '.repeat(embed.end - embed.start));
		offset = embed.end;
	}
	parts.push(masked.slice(offset));
	return { text, body: parts.join(''), embeds };
}

export function inFolder(path: string, folder: string): boolean {
	const clean = folder.replace(/^\/+|\/+$/g, '');
	return !clean || path.startsWith(`${clean}/`);
}

/** Literal, case-sensitive search. Each source range has one result per container. A note path replaces the folder. */
export async function search(store: SearchStore, options: SearchOptions): Promise<SearchResult> {
	const result: SearchResult = { matches: [], diagnostics: [], scanned: 0, cancelled: false };
	if (!options.query.trim()) return result;
	const documents = new Map<string, Promise<Document>>();
	const regions = new Map<string, Promise<Region | null>>();
	const read = (path: string) => {
		let doc = documents.get(path);
		if (!doc) { doc = store.read(path); documents.set(path, doc); }
		return doc;
	};
	let steps = 0;
	const pause = options.yield ?? (() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
	for (const container of store.paths().filter((p) => options.note === undefined ? inFolder(p, options.folder) : p === options.note).sort()) {
		const found = new Set<string>();
		const seenDiagnostics = new Set<string>();
		const report = (source: string, target: string, reason: string) => {
			const key = JSON.stringify([source, target, reason]);
			if (seenDiagnostics.has(key)) return;
			seenDiagnostics.add(key);
			result.diagnostics.push({ container, source, target, reason });
		};
		const visit = async (path: string, subpath: string, depth: number, ancestors: Set<string>): Promise<void> => {
			if (++steps % 20 === 0) await pause();
			if (options.cancelled?.()) { result.cancelled = true; return; }
			const key = JSON.stringify([path, subpath]);
			if (ancestors.has(key)) { report(path, path + subpath, 'Cycle'); return; }
			let doc: Document;
			try { doc = await read(path); } catch { report(path, path, 'Read failed'); return; }
			if (options.cancelled?.()) { result.cancelled = true; return; }
			if (subpath && !regions.has(key)) regions.set(key, store.region(path, subpath, doc.text));
			const region = subpath ? await regions.get(key) : { start: 0, end: doc.text.length };
			if (options.cancelled?.()) { result.cancelled = true; return; }
			if (!region) { report(path, path + subpath, 'Missing or stale section'); return; }
			const start = Math.max(0, region.start);
			const end = Math.min(doc.text.length, region.end);
			const body = doc.body;
			const section = body.slice(start, end);
			let hit = section.indexOf(options.query);
			// Masked markup must not become literal spaces in a query.
			while (hit >= 0 && doc.text.slice(start + hit, start + hit + options.query.length) !== options.query) hit = section.indexOf(options.query, hit + 1);
			if (hit >= 0 && !found.has(key)) {
				found.add(key);
				const offset = start + hit;
				const excerpt = body.slice(Math.max(start, offset - 45), Math.min(end, offset + options.query.length + 90)).replace(/\s+/g, ' ').trim();
				result.matches.push({ container, source: path, subpath, depth, excerpt });
			}
			const next = new Set(ancestors).add(key);
			for (const embed of doc.embeds.filter((e) => e.start >= start && e.end <= end)) {
				if (result.cancelled || options.cancelled?.()) { result.cancelled = true; return; }
				const target = store.resolve(embed.link, path);
				if (!target) { report(path, embed.link, /\.[a-z0-9]+(?:#|$)/i.test(embed.link) && !/\.md(?:#|$)/i.test(embed.link) ? 'Skipped non-Markdown source' : 'Missing Markdown target'); continue; }
				if (!target.path.endsWith('.md')) { report(path, embed.link, 'Skipped non-Markdown source'); continue; }
				if (depth >= 2) { report(path, embed.link, 'Depth limit'); continue; }
				await visit(target.path, target.subpath, depth + 1, next);
			}
		};
		await visit(container, '', 0, new Set());
		if (result.cancelled) break;
		result.scanned++;
		options.progress?.(result.scanned);
	}
	return result;
}

/** Incremental document index. Events invalidate changed files; searches refill them on demand. */
export class DocumentIndex {
	private entries = new Map<string, { revision: string; document: Document }>();
	private epochs = new Map<string, number>();
	private generation = 0;
	invalidate(path: string): void { this.entries.delete(path); this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1); }
	clear(): void { this.entries.clear(); this.epochs.clear(); this.generation++; }
	get size(): number { return this.entries.size; }
	async read(path: string, revision: string, loader: () => Promise<string>): Promise<Document> {
		const entry = this.entries.get(path);
		if (entry?.revision === revision) return entry.document;
		const epoch = this.epochs.get(path) ?? 0;
		const generation = this.generation;
		const document = parseDocument(await loader());
		if (this.generation === generation && (this.epochs.get(path) ?? 0) === epoch) this.entries.set(path, { revision, document });
		return document;
	}
}

function link(path: string): string { return `[[${path.replace(/\|/g, '\\|')}]]`; }
function plainMarkdown(text: string): string { return text.replace(/\r?\n/g, ' ').replace(/[\\`*_{}[\]<>()#+.!|~^$=%&-]/g, '\\$&'); }
export function exportResults(result: SearchResult, query: string): string {
	return ['# Embedded text results', '', `Query: ${plainMarkdown(query)}`, '', ...result.matches.map((m) => `- Container ${link(m.container)} — Source ${link(m.source + m.subpath)}\n  ${plainMarkdown(m.excerpt)}`), '', result.cancelled ? 'Search cancelled. This list is partial.' : `Searched ${result.scanned} containing notes.`, `${result.diagnostics.length} source reports.`].join('\n');
}
