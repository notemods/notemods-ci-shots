/** Pure property formatting. Values remain text, never HTML or executable Markdown. */
export type Layout = 'table' | 'compact';
export interface HeaderOptions {
	enabled: boolean;
	layout: Layout;
	hidden: string;
	order: string;
	skipEmpty: boolean;
	folderLayouts: string;
	preview: boolean;
}
export const DEFAULT_SETTINGS: HeaderOptions = {
	enabled: true, layout: 'table', hidden: 'cssclasses, aliases', order: '', skipEmpty: true, folderLayouts: '', preview: false,
};
export function normalizeSettings(value: unknown): HeaderOptions {
	const s = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
		layout: s.layout === 'compact' ? 'compact' : 'table',
		hidden: typeof s.hidden === 'string' ? s.hidden : 'cssclasses, aliases',
		order: typeof s.order === 'string' ? s.order : '',
		skipEmpty: typeof s.skipEmpty === 'boolean' ? s.skipEmpty : true,
		folderLayouts: typeof s.folderLayouts === 'string' ? s.folderLayouts : '',
		preview: s.preview === true,
	};
}
export function names(text: string): string[] {
	return [...new Set(text.split(/[\n,]/).map(x => x.trim()).filter(Boolean))];
}
export function formatValue(value: unknown, seen = new Set<object>(), depth = 0): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all: string, target: string, alias: string | undefined) => alias ?? target);
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'number') return String(value);
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
	if (typeof value !== 'object') return '';
	if (seen.has(value) || depth >= 10) return '[nested value]';
	const next = new Set(seen).add(value);
	if (Array.isArray(value)) return value.map(v => formatValue(v, next, depth + 1)).filter(Boolean).join(', ');
	return Object.entries(value).map(([k, v]) => `${k}: ${formatValue(v, next, depth + 1)}`).join('; ');
}
function isPositionMetadata(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const position = value as Record<string, unknown>;
	return ['start', 'end'].every(key => {
		const point = position[key];
		return !!point && typeof point === 'object' && typeof (point as Record<string, unknown>).offset === 'number';
	});
}
export interface PropertyRow { key: string; value: string }
export function propertyRows(frontmatter: unknown, options: HeaderOptions = DEFAULT_SETTINGS): PropertyRow[] {
	if (!options.enabled || !frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return [];
	const hidden = new Set(names(options.hidden));
	const preferred = names(options.order);
	const rows = Object.entries(frontmatter).filter(([key, value]) => !hidden.has(key) && !(key === 'position' && isPositionMetadata(value))).map(([key, value]) => ({ key, value: formatValue(value) })).filter(row => !options.skipEmpty || row.value.trim() !== '');
	return rows.sort((a, b) => {
		const ai = preferred.indexOf(a.key), bi = preferred.indexOf(b.key);
		return (ai < 0 ? preferred.length : ai) - (bi < 0 ? preferred.length : bi);
	});
}
/** Folder rules use exact path segments. The most specific matching folder wins. */
export function layoutFor(path: string, options: HeaderOptions, pro: boolean): Layout {
	if (!pro) return options.layout;
	const rules = options.folderLayouts.split('\n').flatMap<{ folder: string; layout: Layout }>(line => {
		const split = line.lastIndexOf('=');
		if (split < 0) return [];
		const folder = line.slice(0, split).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
		const layout = line.slice(split + 1).trim();
		return folder && (layout === 'table' || layout === 'compact') ? [{ folder, layout }] : [];
	}).filter(r => path.startsWith(`${r.folder}/`)).sort((a, b) => b.folder.length - a.folder.length);
	return rules[0]?.layout ?? options.layout;
}

/** A complete document starts at line zero; partial sections do not own a header. */
export function sectionRows(frontmatter: unknown, options: HeaderOptions, lineStart: number | null): PropertyRow[] {
	return lineStart === 0 ? propertyRows(frontmatter, options) : [];
}
