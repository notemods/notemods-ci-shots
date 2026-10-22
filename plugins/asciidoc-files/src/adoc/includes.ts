// include:: directive expansion over vault files (pure; the vault reads are passed in).
// Supports: targets relative to the including file, "/" for the vault root, a vault-root fallback, {attribute}
// references in targets, lines=, tag= / tags= (names, !name, * and **), leveloffset=, indent=, opts=optional,
// escaped \include::, include cycles and a depth limit. Directives inside comment blocks are skipped, as Asciidoctor does.
import { NO_BLOCK, stepBlock, type BlockState } from './blocks';
import { dirOf, isUrl, joinPath } from './paths';

export type IncludeStatus = 'ok' | 'missing' | 'cycle' | 'depth' | 'url' | 'off';

export interface IncludeRecord {
	/** File that holds the directive. */
	from: string;
	/** 1-based line of the directive in that file. */
	line: number;
	target: string;
	/** Vault path that was read, or null. */
	path: string | null;
	status: IncludeStatus;
	depth: number;
}

export interface ExpandOptions {
	/** false = free mode: each directive becomes a short note instead of the file. */
	resolve: boolean;
	/** Nesting limit, 1 to MAX_DEPTH. */
	maxDepth: number;
	/** Try the target from the vault root when it is not found next to the including file. */
	rootFallback: boolean;
}

export interface ExpandResult {
	text: string;
	includes: IncludeRecord[];
	/** Paths the expander tried that are not in `files` yet (the loader reads them and runs again). */
	wanted: string[];
}

export const MAX_DEPTH = 8;
/** Upper bound of directives handled in one expansion (stops include bombs). */
export const MAX_INCLUDES = 500;
export const DEFAULT_EXPAND: ExpandOptions = { resolve: true, maxDepth: MAX_DEPTH, rootFallback: true };

const DIRECTIVE = /^(\\?)include::([^\s[](?:[^[]*[^\s[])?)\[(.*)\]\s*$/;
const ATTR_ENTRY = /^:(!?)(\w[\w-]*)(!?):(?:[ \t]+(.*))?$/;
const TAG_LINE = /\b(tag|end)::(\S*?)\[\](?=$|[ \r])/;

const REASON: Record<Exclude<IncludeStatus, 'ok'>, string> = {
	missing: 'file not found',
	cycle: 'the file includes itself',
	depth: 'more than {n} levels of includes',
	url: 'URL includes are off, the plugin makes no network request for a document',
	off: 'includes are resolved with Pro',
};

interface Ctx {
	files: Readonly<Record<string, string | null>>;
	opts: ExpandOptions;
	includes: IncludeRecord[];
	wanted: Set<string>;
	attrs: Map<string, string>;
}

/** Splits an attribute list on commas outside double or single quotes; returns key=value pairs (keys lower case). */
export function parseIncludeAttrs(list: string): Record<string, string> {
	const out: Record<string, string> = {};
	const parts = list.match(/(?:[^,"']+|"[^"]*"|'[^']*')+/g) ?? [];
	for (const raw of parts) {
		const eq = raw.indexOf('=');
		if (eq < 0) continue;
		const key = raw.slice(0, eq).trim().toLowerCase();
		const value = raw.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
		if (key) out[key] = value;
	}
	return out;
}

/** lines= spec ("1..3;7", "5..-1", "10..") as 1-based inclusive ranges; Infinity = to the end. */
export function parseLineRanges(spec: string): [number, number][] {
	const ranges: [number, number][] = [];
	for (const part of spec.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
		const m = /^(\d+)(?:\.\.(-1|\d*))?$/.exec(part);
		if (!m) continue;
		const start = Number(m[1]);
		const endText = m[2];
		const end = endText === undefined ? start : endText === '' || endText === '-1' ? Infinity : Number(endText);
		if (start >= 1 && end >= start) ranges.push([start, end]);
	}
	return ranges;
}

function pickLines(lines: string[], ranges: [number, number][]): string[] {
	if (!ranges.length) return lines;
	return lines.filter((_, i) => ranges.some(([a, b]) => i + 1 >= a && i + 1 <= b));
}

/** Keeps the lines of the selected tagged regions; tag:: and end:: lines are always dropped. */
export function pickTags(lines: string[], spec: string): string[] {
	const names = spec.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
	const yes = new Set(names.filter((n) => !n.startsWith('!')));
	const no = new Set(names.filter((n) => n.startsWith('!')).map((n) => n.slice(1)));
	const all = yes.has('**') || (yes.size === 0 && no.size > 0);
	const anyTagged = yes.has('*');
	const active: string[] = [];
	const out: string[] = [];
	for (const line of lines) {
		const m = TAG_LINE.exec(line);
		if (m) {
			if (m[1] === 'tag') active.push(m[2] ?? '');
			else if (active.length && active[active.length - 1] === m[2]) active.pop();
			continue;
		}
		if (active.some((t) => no.has(t))) continue;
		const keep = all || (anyTagged && active.length > 0) || active.some((t) => yes.has(t));
		if (keep) out.push(line);
	}
	return out;
}

function reindent(lines: string[], indent: number): string[] {
	const widths = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0);
	const cut = widths.length ? Math.min(...widths) : 0;
	const pad = ' '.repeat(Math.max(0, Math.min(indent, 16)));
	return lines.map((l) => (l.trim() ? pad + l.slice(cut) : ''));
}

/** Substitutes {name} references with document attributes seen so far; unknown references stay as written. */
function substitute(target: string, attrs: Map<string, string>): string {
	return target.replace(/\{([\w-]+)\}/g, (all, name: string) => attrs.get(name.toLowerCase()) ?? all);
}

function note(target: string, from: string, status: Exclude<IncludeStatus, 'ok'>, verbatim: boolean, depth = MAX_DEPTH): string[] {
	const reason = REASON[status].replace('{n}', String(depth));
	if (verbatim) return [`[include::${target}[]: ${reason}]`];
	const text = status === 'off' ? `Include \`+${target}+\`: ${reason}.` : `Unresolved include in \`+${from}+\`: \`+${target}+\` (${reason}).`;
	return ['', `[.adoc-include-note.adoc-include-${status}]`, '****', text, '****', ''];
}

function candidates(from: string, target: string, rootFallback: boolean): string[] {
	const out: string[] = [];
	const near = joinPath(dirOf(from), target);
	if (near) out.push(near);
	if (rootFallback && !target.startsWith('.') && !target.startsWith('/')) {
		const root = joinPath('', target);
		if (root && !out.includes(root)) out.push(root);
	}
	return out;
}

function trackAttribute(ctx: Ctx, line: string): void {
	const m = ATTR_ENTRY.exec(line);
	if (!m) return;
	const name = (m[2] ?? '').toLowerCase();
	if (m[1] === '!' || m[3] === '!') ctx.attrs.delete(name);
	else ctx.attrs.set(name, (m[4] ?? '').trim());
}

/**
 * Filters, indents and level-shifts the included lines per the directive attributes.
 * The leveloffset entries get a blank line before them, so they never join the paragraph above as text.
 */
function shape(body: string, attrs: Record<string, string>, levelNow: number): { lines: string[]; after: string[] } {
	let lines = body.replace(/\r\n?/g, '\n').split('\n');
	if (lines.length && lines[lines.length - 1] === '') lines.pop();
	if (attrs.lines !== undefined) lines = pickLines(lines, parseLineRanges(attrs.lines));
	else if (attrs.tags !== undefined || attrs.tag !== undefined) lines = pickTags(lines, attrs.tags ?? attrs.tag ?? '');
	if (attrs.indent !== undefined && /^\d+$/.test(attrs.indent)) lines = reindent(lines, Number(attrs.indent));
	const lo = attrs.leveloffset;
	if (lo === undefined || !/^[+-]?\d+$/.test(lo)) return { lines, after: [] };
	if (/^[+-]/.test(lo)) {
		const back = lo.startsWith('+') ? `-${lo.slice(1)}` : `+${lo.slice(1)}`;
		return { lines: ['', `:leveloffset: ${lo}`, ...lines], after: ['', `:leveloffset: ${back}`] };
	}
	return { lines: ['', `:leveloffset: ${lo}`, ...lines], after: ['', `:leveloffset: ${levelNow}`] };
}

interface Frame {
	path: string;
	depth: number;
	stack: string[];
}

/** Handles one directive line; returns the replacement lines. */
function directive(ctx: Ctx, m: RegExpExecArray, frame: Frame, lineNo: number, block: BlockState): string[] {
	const target = substitute(m[2] ?? '', ctx.attrs);
	const attrs = parseIncludeAttrs(m[3] ?? '');
	const verbatim = block.kind === 'verbatim';
	const record: IncludeRecord = { from: frame.path, line: lineNo, target, path: null, status: 'off', depth: frame.depth + 1 };
	if (ctx.includes.length > MAX_INCLUDES) return note(target, frame.path, 'depth', verbatim, ctx.opts.maxDepth);
	ctx.includes.push(record);
	if (!ctx.opts.resolve) return note(target, frame.path, 'off', verbatim);
	if (isUrl(target)) return (record.status = 'url'), note(target, frame.path, 'url', verbatim);
	if (frame.depth >= ctx.opts.maxDepth || ctx.includes.length > MAX_INCLUDES) return (record.status = 'depth'), note(target, frame.path, 'depth', verbatim, ctx.opts.maxDepth);
	const tried = candidates(frame.path, target, ctx.opts.rootFallback);
	const found = tried.find((p) => frame.stack.includes(p) || typeof ctx.files[p] === 'string');
	if (found === undefined) {
		for (const p of tried) if (!(p in ctx.files)) ctx.wanted.add(p);
		record.status = 'missing';
		return /(^|,)\s*optional\s*(,|$)/.test(attrs.opts ?? '') ? [] : note(target, frame.path, 'missing', verbatim);
	}
	record.path = found;
	if (frame.stack.includes(found)) return (record.status = 'cycle'), note(target, frame.path, 'cycle', verbatim);
	record.status = 'ok';
	const levelNow = Number(ctx.attrs.get('leveloffset') ?? 0) || 0;
	const shaped = shape(ctx.files[found] ?? '', attrs, levelNow);
	const inner = expandLines(ctx, shaped.lines, { path: found, depth: frame.depth + 1, stack: [...frame.stack, found] });
	return [...inner, ...shaped.after];
}

function expandLines(ctx: Ctx, lines: string[], frame: Frame): string[] {
	const out: string[] = [];
	let block: BlockState = NO_BLOCK;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const step = stepBlock(block, line);
		const m = block.kind === 'comment' || step.delimiter ? null : DIRECTIVE.exec(line);
		block = step.state;
		if (!m) {
			if (!block.kind) trackAttribute(ctx, line);
			out.push(line);
		} else if (m[1] === '\\') out.push(line.slice(1));
		else out.push(...directive(ctx, m, frame, i + 1, block));
	}
	return out;
}

/**
 * Expands include directives of `source` (the text of `path`) from `files` (vault path -> text, null = known missing).
 * Pure and synchronous; `wanted` lists the paths to read before running again.
 */
export function expandIncludes(source: string, path: string, files: Readonly<Record<string, string | null>>, options: Partial<ExpandOptions> = {}): ExpandResult {
	const opts = { ...DEFAULT_EXPAND, ...options };
	opts.maxDepth = Math.max(1, Math.min(MAX_DEPTH, Math.floor(opts.maxDepth) || MAX_DEPTH));
	const ctx: Ctx = { files, opts, includes: [], wanted: new Set(), attrs: new Map() };
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const text = expandLines(ctx, lines, { path, depth: 0, stack: [path] }).join('\n');
	return { text, includes: ctx.includes, wanted: [...ctx.wanted] };
}

/** Reads every reachable include through `read` (bounded rounds and files), then expands. */
export async function expandWithReader(source: string, path: string, read: (path: string) => Promise<string | null>, options: Partial<ExpandOptions> = {}): Promise<ExpandResult> {
	const files: Record<string, string | null> = {};
	let result = expandIncludes(source, path, files, options);
	for (let round = 0; round <= MAX_DEPTH + 1 && result.wanted.length > 0; round++) {
		for (const p of result.wanted.slice(0, MAX_INCLUDES)) files[p] = await read(p);
		result = expandIncludes(source, path, files, options);
	}
	return result;
}
