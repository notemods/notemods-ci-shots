// Base filters -> properties for a new note. Pure: no Obsidian imports, so vitest runs it directly.
// The rules follow what the app itself pre-fills when you press New in a base (checked in app.js of
// Obsidian 1.13.4 and 1.14.4, function that builds the new item frontmatter):
//   prop == v, prop >= v, prop <= v      -> prop: v
//   !prop.isEmpty()                      -> prop: "" (only if not set yet); other rules that start with ! are skipped
//   prop.contains(v), containsAll(...)   -> prop: [v...] for list properties, else v
//   prop.startsWith(v), endsWith(v)      -> same as contains
//   prop.containsAny(a, b)               -> the first value (as a list for list properties)
//   file.hasTag("t")                     -> tags: [..., t]
//   file.inFolder("F"), file.folder == F -> the note goes in folder F
//   file.hasProperty("p")                -> p: null
//   file.tags.contains(t)                -> tags: [t]
// Rules under "and" and "or" are used in order (a later rule for the same property wins); rules under "not" are
// skipped, the same as the app.

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export type LinkText = (target: string) => string;

export type PropValue = string | number | boolean | null | PropValue[] | { [key: string]: PropValue };

export interface FilterResult {
	properties: Record<string, PropValue>;
	folder: string;
}

export interface FilterOptions {
	/** Property types from .obsidian/types.json (name -> text, multitext, tags, ...). Unknown names: contains = list. */
	types?: Readonly<Record<string, string>>;
	/** Clock for today() and now(). */
	now?: Date;
	/** Link text for a link("path") target, as the app writes it (shortest unique path). Default: the path as written. */
	linkText?: LinkText;
}

const COMPARE = /^(.+?)\s*(==|>=|<=|!=|>|<)\s*(.+)$/s;
const CALL = /^(.+)\.([A-Za-z]+)\((.*)\)$/s;
const LIST_METHODS = new Set(['contains', 'containsAll', 'startsWith', 'endsWith']);
const LIST_TYPES = new Set(['multitext', 'tags', 'aliases']);

/**
 * Rules the app uses for a new note, from one filter node: a string, or {and}, {or}, {not}. Like the app, rules
 * under "and" and "or" count, rules under "not" do not (a "not" inside a "not" counts again).
 */
export function positiveRules(node: unknown, negated = false, depth = 0): string[] {
	if (depth > 16) return [];
	if (typeof node === 'string') return !negated && node.trim() ? [node.trim()] : [];
	if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
	const group = node as { and?: unknown; or?: unknown; not?: unknown };
	const out: string[] = [];
	for (const [key, flip] of [['and', false], ['or', false], ['not', true]] as const) {
		const children = group[key];
		if (Array.isArray(children)) for (const child of children) out.push(...positiveRules(child, negated !== flip, depth + 1));
	}
	return out;
}

/** Splits a list of arguments at top-level commas, keeping commas inside quotes, brackets and parentheses. */
export function splitArgs(text: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote = '';
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? '';
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = '';
			continue;
		}
		if (ch === '"' || ch === "'") quote = ch;
		else if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (ch === ',' && depth === 0) {
			out.push(text.slice(start, i).trim());
			start = i + 1;
		}
	}
	const last = text.slice(start).trim();
	if (last || out.length > 0) out.push(last);
	return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function unquote(text: string): string | undefined {
	const q = text[0];
	if ((q !== '"' && q !== "'") || text.length < 2 || text[text.length - 1] !== q) return undefined;
	return text.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** A literal from a filter, as the value a property gets. undefined = not a literal (formula, this.*, ...). */
export function parseValue(raw: string, now: Date = new Date(), depth = 0, linkText: LinkText = (t) => t): PropValue | undefined {
	const text = raw.trim();
	if (!text || depth > 8) return undefined;
	const str = unquote(text);
	if (str !== undefined) return str;
	if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
	if (text === 'true' || text === 'false') return text === 'true';
	if (text === 'null') return null;
	if (text.startsWith('[') && text.endsWith(']')) {
		const items = splitArgs(text.slice(1, -1)).map((a) => parseValue(a, now, depth + 1, linkText));
		const values = items.filter((v): v is PropValue => v !== undefined);
		return values.length === items.length ? values : undefined;
	}
	const call = /^(link|date|today|now)\((.*)\)$/s.exec(text);
	if (!call) return undefined;
	const args = splitArgs(call[2] ?? '').map((a) => parseValue(a, now, depth + 1, linkText));
	if (call[1] === 'today') return isoDate(now);
	if (call[1] === 'now') return `${isoDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
	if (call[1] === 'date') return typeof args[0] === 'string' ? args[0] : undefined;
	if (typeof args[0] !== 'string') return undefined;
	const target = linkText(args[0].replace(/^\[\[|\]\]$/g, ''));
	return typeof args[1] === 'string' ? `[[${target}|${args[1]}]]` : `[[${target}]]`;
}

export interface Subject {
	type: 'note' | 'file' | 'formula';
	name: string;
}

/** The left side of a rule: note.x, note["x"], file.x, formula.x, x, file, list(x). null = not supported. */
export function parseSubject(raw: string): Subject | null {
	const text = raw.trim();
	const list = /^list\((.+)\)$/s.exec(text);
	if (list) return parseSubject(list[1] ?? '');
	const index = /^(note|file|formula)\[(.+)\]$/s.exec(text);
	if (index) {
		const name = unquote((index[2] ?? '').trim());
		return name ? { type: index[1] as Subject['type'], name } : null;
	}
	const member = /^([\p{L}_][\p{L}\p{N}\p{M}_-]*)\.([\p{L}_][\p{L}\p{N}\p{M}_-]*)$/u.exec(text);
	if (member) {
		const [, obj = '', key = ''] = member;
		if (obj === 'note' || obj === 'file' || obj === 'formula') return { type: obj, name: key };
		if (obj === 'this') return null;
		return { type: 'note', name: `${obj}.${key}` };
	}
	if (/^[\p{L}_][\p{L}\p{N}\p{M}_-]*$/u.test(text)) {
		if (['true', 'false', 'null', 'this'].includes(text)) return null;
		return text === 'file' ? { type: 'file', name: 'file' } : { type: 'note', name: text };
	}
	return null;
}

interface State {
	props: Record<string, PropValue>;
	folder: string;
	types: Readonly<Record<string, string>>;
	now: Date;
	linkText: LinkText;
}

function args(text: string, state: State): PropValue | undefined {
	const values = splitArgs(text).map((a) => parseValue(a, state.now, 0, state.linkText));
	if (values.length === 0 || values.some((v) => v === undefined)) return undefined;
	return values.length > 1 ? (values as PropValue[]) : values[0];
}

function applyCompare(state: State, m: RegExpExecArray): void {
	const [, left = '', op = '', right = ''] = m;
	if (!['==', '>=', '<='].includes(op)) return;
	const subject = parseSubject(left);
	const value = parseValue(right, state.now, 0, state.linkText);
	if (!subject || value === undefined) return;
	if (subject.type === 'note') state.props[subject.name] = value;
	else if (subject.type === 'file' && subject.name === 'folder' && op === '==' && typeof value === 'string') state.folder = value;
}

function applyNoteCall(state: State, name: string, method: string, value: PropValue): void {
	const type = hasOwn(state.types, name) ? state.types[name] : undefined;
	const isList = type === undefined ? method !== 'startsWith' && method !== 'endsWith' : LIST_TYPES.has(type);
	if (LIST_METHODS.has(method)) {
		state.props[name] = isList && !Array.isArray(value) ? [value] : value;
	} else if (method === 'containsAny') {
		const first = Array.isArray(value) ? (value[0] ?? null) : value;
		state.props[name] = isList ? [first] : first;
	}
}

function applyFileCall(state: State, subject: Subject, method: string, value: PropValue): void {
	if (subject.name === 'file') {
		if (method === 'hasTag' && typeof value === 'string') {
			const tags = state.props.tags;
			if (tags === undefined || Array.isArray(tags)) state.props.tags = [...(tags ?? []), value];
		} else if (method === 'inFolder' && typeof value === 'string') state.folder = value;
		else if (method === 'hasProperty' && typeof value === 'string') state.props[value] = null;
		return;
	}
	if (subject.name !== 'tags') return;
	if (method === 'containsAny') state.props.tags = [Array.isArray(value) ? (value[0] ?? null) : value];
	else if (method === 'contains' || method === 'containsAll') state.props.tags = Array.isArray(value) ? value : [value];
}

function applyCall(state: State, m: RegExpExecArray): void {
	const [, left = '', method = '', inner = ''] = m;
	const subject = parseSubject(left);
	if (!subject) return;
	const value = args(inner, state);
	if (value === undefined) return;
	if (subject.type === 'note') applyNoteCall(state, subject.name, method, value);
	else if (subject.type === 'file') applyFileCall(state, subject, method, value);
}

/** Applies one rule (a filter string) to the state. Unknown shapes are ignored. */
function applyRule(state: State, rule: string): void {
	if (rule.startsWith('!')) {
		const subject = /^!\s*(.+)\.isEmpty\(\s*\)$/s.exec(rule);
		const s = subject ? parseSubject(subject[1] ?? '') : null;
		if (s?.type === 'note' && !hasOwn(state.props, s.name)) state.props[s.name] = '';
		return;
	}
	const call = CALL.exec(rule);
	if (call && !COMPARE.test(rule.replace(/\(.*\)/s, '()'))) {
		applyCall(state, call);
		return;
	}
	const cmp = COMPARE.exec(rule);
	if (cmp) applyCompare(state, cmp);
}

/**
 * Properties and folder for a new note from the base filters and the current view's filters.
 * order (the view's columns): note properties that are not set yet get an empty value, like the app.
 */
export function filtersToProperties(baseFilters: unknown, viewFilters: unknown, order: readonly string[] = [], opts: FilterOptions = {}): FilterResult {
	const state: State = { props: {}, folder: '', types: opts.types ?? {}, now: opts.now ?? new Date(), linkText: opts.linkText ?? ((t) => t) };
	for (const rule of [...positiveRules(baseFilters), ...positiveRules(viewFilters)]) applyRule(state, rule);
	for (const col of order) {
		const subject = parseSubject(col);
		if (subject?.type === 'note' && !hasOwn(state.props, subject.name)) state.props[subject.name] = null;
	}
	return { properties: state.props, folder: state.folder };
}
