// Template text, variables, property merge and file names. Pure: no Obsidian imports.

import { filtersToProperties, type FilterOptions, type LinkText, type PropValue } from './filters';

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export type Props = Record<string, PropValue>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TOKENS = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a|X/g;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function dayOfYear(d: Date): number {
	const start = new Date(d.getFullYear(), 0, 1);
	return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86_400_000) + 1;
}

function token(d: Date, t: string): string {
	const h12 = d.getHours() % 12 || 12;
	const map: Record<string, () => string> = {
		YYYY: () => String(d.getFullYear()),
		YY: () => pad(d.getFullYear() % 100),
		MMMM: () => MONTHS[d.getMonth()] ?? '',
		MMM: () => (MONTHS[d.getMonth()] ?? '').slice(0, 3),
		MM: () => pad(d.getMonth() + 1),
		M: () => String(d.getMonth() + 1),
		DDDD: () => pad(dayOfYear(d), 3),
		DD: () => pad(d.getDate()),
		D: () => String(d.getDate()),
		dddd: () => DAYS[d.getDay()] ?? '',
		ddd: () => (DAYS[d.getDay()] ?? '').slice(0, 3),
		HH: () => pad(d.getHours()),
		H: () => String(d.getHours()),
		hh: () => pad(h12),
		h: () => String(h12),
		mm: () => pad(d.getMinutes()),
		m: () => String(d.getMinutes()),
		ss: () => pad(d.getSeconds()),
		s: () => String(d.getSeconds()),
		A: () => (d.getHours() < 12 ? 'AM' : 'PM'),
		a: () => (d.getHours() < 12 ? 'am' : 'pm'),
		X: () => String(Math.floor(d.getTime() / 1000)),
	};
	return map[t]?.() ?? t;
}

/** Formats a date with the common moment.js tokens (YYYY MM DD HH mm ss, names in English, [literal] text). */
export function formatDate(d: Date, format: string): string {
	return format.replace(TOKENS, (m: string, lit: string | undefined) => (lit !== undefined ? lit : token(d, m)));
}

export interface VarContext {
	title: string;
	now: Date;
	dateFormat: string;
	timeFormat: string;
	base: string;
	view: string;
	template: string;
	props: Props;
}

/** Plain text of a property value for names and text: links lose their brackets, lists are joined with ", ". */
export function plainValue(v: PropValue | undefined): string {
	if (v === null || v === undefined) return '';
	if (Array.isArray(v)) return v.map(plainValue).filter(Boolean).join(', ');
	if (typeof v === 'object') return '';
	const s = String(v);
	const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(s);
	if (!link) return s;
	const target = link[1] ?? '';
	return link[2] ?? target.slice(target.lastIndexOf('/') + 1);
}

/**
 * Replaces {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}} (the core Templates variables) and
 * {{base}}, {{view}}, {{template}} and {{<property>}} for pre-filled properties. Unknown variables stay as they are.
 */
export function renderVariables(text: string, ctx: VarContext): string {
	return text.replace(/\{\{\s*([^{}:]+?)\s*(?::([^{}]*))?\}\}/g, (whole: string, rawName: string, fmt: string | undefined) => {
		const name = rawName.toLowerCase();
		if (name === 'date') return formatDate(ctx.now, fmt?.trim() || ctx.dateFormat);
		if (name === 'time') return formatDate(ctx.now, fmt?.trim() || ctx.timeFormat);
		if (fmt !== undefined) return whole;
		if (name === 'title') return ctx.title;
		if (name === 'base') return ctx.base;
		if (name === 'view') return ctx.view;
		if (name === 'template') return ctx.template;
		if (hasOwn(ctx.props, rawName)) return plainValue(ctx.props[rawName]);
		return whole;
	});
}

/** Splits note text into the YAML between the first two --- lines and the body after them. */
export function splitFrontmatter(text: string): { yaml: string | null; body: string } {
	// The closing --- must start a line, so a value that ends in --- does not end the block.
	const m = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return { yaml: null, body: text };
	return { yaml: m[1] ?? '', body: text.slice(m[0].length) };
}

const isBlank = (v: PropValue | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Template properties first, then the note's own values on top. A blank value in the note (the app adds an
 * empty property for each column of the view) does not hide a template value. tags lists are joined.
 */
export function mergeProperties(template: Props, current: Props): Props {
	const out: Props = { ...template };
	for (const [key, value] of Object.entries(current)) {
		const base = out[key];
		if (key === 'tags' && Array.isArray(base) && Array.isArray(value)) out[key] = [...new Set([...base, ...value])];
		else if (!isBlank(value) || !hasOwn(out, key)) out[key] = value;
	}
	return out;
}

/** Characters a file name cannot hold on every platform, plus the ones that break links. */
const BAD_NAME = /[\\/:*?"<>|#^[\]]/g;

/** A file name (no extension) from a pattern. Empty result = "Untitled". */
export function makeFileName(pattern: string, ctx: VarContext): string {
	const raw = renderVariables(pattern || 'Untitled', { ...ctx, title: ctx.title || 'Untitled' });
	const clean = raw
		.replace(/\{\{[^{}]*\}\}/g, '')
		.replace(BAD_NAME, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, 200)
		.trim();
	return clean || 'Untitled';
}

/** First free path: "folder/name.md", then "folder/name 1.md", "name 2.md", ... (like the app). */
export function uniquePath(folder: string, name: string, exists: (path: string) => boolean): string {
	const dir = folder.replace(/^\/+|\/+$/g, '');
	const prefix = dir ? `${dir}/` : '';
	let path = `${prefix}${name}.md`;
	for (let n = 1; exists(path) && n < 10_000; n++) path = `${prefix}${name} ${n}.md`;
	return path;
}

export interface PlanInput {
	baseFilters?: unknown;
	viewFilters?: unknown;
	order?: string[];
	template?: string;
	templateName?: string;
	pattern?: string;
	folder?: string;
	base?: string;
	view?: string;
	now: string;
	dateFormat?: string;
	timeFormat?: string;
	types?: Record<string, string>;
	/** Extra properties the user set for this base. Filter values and template values win over them. */
	extraProps?: Record<string, string>;
}

export interface Plan {
	folder: string;
	name: string;
	properties: Props;
	body: string;
}

/**
 * Everything a new note needs, from the base filters, the template text and the name pattern:
 * folder (setting, else the filter folder), file name, merged properties (filter values win) and body.
 * templateProps: properties already parsed from the template's frontmatter (the plugin uses parseYaml).
 * linkText: how link("path") targets are written; the plugin passes the app's shortest link text.
 */
export function planNewNote(input: PlanInput, templateProps: Props = {}, linkText?: LinkText): Plan {
	const now = new Date(input.now);
	const opts: FilterOptions = { now, types: input.types, linkText };
	const filters = filtersToProperties(input.baseFilters, input.viewFilters, input.order ?? [], opts);
	const ctx: VarContext = {
		title: '',
		now,
		dateFormat: input.dateFormat || 'YYYY-MM-DD',
		timeFormat: input.timeFormat || 'HH:mm',
		base: input.base ?? '',
		view: input.view ?? '',
		template: input.templateName ?? '',
		props: filters.properties,
	};
	const name = makeFileName(input.pattern ?? '', ctx);
	const withTitle = { ...ctx, title: name };
	const rendered = renderProperties(templateProps, withTitle);
	const body = renderVariables(splitFrontmatter(input.template ?? '').body, withTitle);
	// Extra user properties sit under the template values and the filter values. A filter rule for a
	// property the user set as extra keeps the filter value, because filters.properties wins on top.
	const withExtra = mergeProperties(renderExtra(input.extraProps, withTitle), rendered);
	return { folder: input.folder?.trim() || filters.folder, name, properties: mergeProperties(withExtra, filters.properties), body };
}

/** Extra property values are text, with the variables rendered. */
export function renderExtra(extra: Record<string, string> | undefined, ctx: VarContext): Props {
	const out: Props = {};
	if (!extra) return out;
	for (const [k, v] of Object.entries(extra)) out[k] = renderVariables(v, ctx);
	return out;
}

/** New button: extras under the template values, and the values the app wrote on top (a blank value hides nothing). */
export function newButtonProps(current: Props, templateProps: Props, extra: Record<string, string> | undefined, ctx: VarContext): Props {
	const rendered = renderProperties(templateProps, ctx);
	return mergeProperties(mergeProperties(renderExtra(extra, ctx), rendered), current);
}

/** Renders string values in YAML lists and mappings. Shared YAML anchors keep their identity. */
export function renderProperties(props: Props, ctx: VarContext): Props {
	const seen = new WeakMap<object, PropValue>();
	const render = (value: PropValue): PropValue => {
		if (typeof value === 'string') return renderVariables(value, ctx);
		if (value === null || typeof value !== 'object') return value;
		const previous = seen.get(value);
		if (previous) return previous;
		if (Array.isArray(value)) {
			const out: PropValue[] = [];
			seen.set(value, out);
			for (const item of value) out.push(render(item));
			return out;
		}
		const out: Props = {};
		seen.set(value, out);
		for (const [key, item] of Object.entries(value)) Object.defineProperty(out, key, { value: render(item), enumerable: true, configurable: true, writable: true });
		return out;
	};
	return render(props) as Props;
}
