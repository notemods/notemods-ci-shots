// Saved settings and which templates apply to one base view. Pure: no Obsidian imports.

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export interface BaseConfig {
	/** Template note paths. The first one is the default; more than one needs Pro. */
	templates: string[];
	/** Folder for new notes. Empty = the folder from the filters, else the app's default location. */
	folder: string;
	/** File name pattern. Empty = "Untitled", like the app. */
	pattern: string;
	/** Apply the template when New is pressed in this base. */
	onNew: boolean;
	/** Extra properties (name -> value) each new note gets. Filter values and template values still come first. */
	extraProps: Record<string, string>;
	/** Pro: view name -> template path used for that view first. */
	views: Record<string, string>;
}

export interface Settings {
	bases: Record<string, BaseConfig>;
	/** Main switch for the New button. Off = only the command and the header button create notes. */
	hookNew: boolean;
	dateFormat: string;
	timeFormat: string;
	/** Pro: run Templater on the new note when the text still holds <% %> tags. */
	templater: boolean;
}

export const DEFAULT_BASE: BaseConfig = { templates: [], folder: '', pattern: '', onNew: true, extraProps: {}, views: {} };
export const DEFAULT_SETTINGS: Settings = { bases: {}, hookNew: true, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', templater: true };
export const MAX_TEMPLATES = 10;

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One base entry from saved data, repaired. */
export function normalizeBase(raw: unknown): BaseConfig {
	const r = isRecord(raw) ? raw : {};
	const templates = Array.isArray(r.templates) ? r.templates.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : [];
	const views: Record<string, string> = {};
	if (isRecord(r.views)) for (const [k, v] of Object.entries(r.views)) if (typeof v === 'string' && v.trim()) views[k] = v.trim();
	const extraProps: Record<string, string> = {};
	if (isRecord(r.extraProps)) for (const [k, v] of Object.entries(r.extraProps)) if (typeof v === 'string' && k.trim()) extraProps[k.trim()] = v;
	return {
		templates: [...new Set(templates)].slice(0, MAX_TEMPLATES),
		folder: str(r.folder, '').trim().replace(/^\/+|\/+$/g, ''),
		pattern: str(r.pattern, '').trim(),
		onNew: bool(r.onNew, true),
		extraProps,
		views,
	};
}

/** Saved data -> settings with every field present and valid. */
export function normalizeSettings(raw: unknown): Settings {
	const r = isRecord(raw) ? raw : {};
	const bases: Record<string, BaseConfig> = {};
	if (isRecord(r.bases)) for (const [path, cfg] of Object.entries(r.bases)) if (path.endsWith('.base')) bases[path] = normalizeBase(cfg);
	return {
		bases,
		hookNew: bool(r.hookNew, DEFAULT_SETTINGS.hookNew),
		dateFormat: str(r.dateFormat, '').trim() || DEFAULT_SETTINGS.dateFormat,
		timeFormat: str(r.timeFormat, '').trim() || DEFAULT_SETTINGS.timeFormat,
		templater: bool(r.templater, DEFAULT_SETTINGS.templater),
	};
}

export interface Effective {
	/** Templates to offer, default first. Free: at most one. */
	templates: string[];
	folder: string;
	pattern: string;
	onNew: boolean;
	/** Extra properties (name -> value) each new note gets. */
	extraProps: Record<string, string>;
	/** Pro-only parts of the saved setup that are off because Pro is off. */
	locked: string[];
}

/** What applies to one view of one base. Free uses the first base template; Pro adds the view template and the rest. */
export function effectiveFor(settings: Settings, basePath: string, view: string, pro: boolean): Effective | null {
	const cfg = settings.bases[basePath];
	if (!cfg) return null;
	const viewTemplate = view && hasOwn(cfg.views, view) ? cfg.views[view] : undefined;
	const locked: string[] = [];
	let templates: string[];
	if (pro) templates = [...new Set([...(viewTemplate ? [viewTemplate] : []), ...cfg.templates])];
	else {
		templates = cfg.templates.slice(0, 1);
		if (viewTemplate) locked.push('view template');
		if (cfg.templates.length > 1) locked.push('more than one template');
	}
	return { templates, folder: cfg.folder, pattern: cfg.pattern, onNew: settings.hookNew && cfg.onNew, extraProps: cfg.extraProps, locked };
}

/** True when the New button of the base has work to do: a template, a name pattern or extra properties. */
export function usesNew(eff: Effective): boolean {
	return eff.onNew && (eff.templates.length > 0 || eff.pattern !== '' || Object.keys(eff.extraProps).length > 0);
}

/** Extra properties from the rows of the setup dialog: names are trimmed, empty names are skipped, the last equal name wins. */
export function extraFromRows(rows: { name: string; value: string }[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const { name, value } of rows) if (name.trim()) out[name.trim()] = value;
	return out;
}

/** True when p is oldPath or a path inside the folder oldPath. */
const under = (p: string, oldPath: string) => p === oldPath || p.startsWith(`${oldPath}/`);

/** True when a rename of oldPath (a file or a folder) changes a base key, a template path or a folder setting. */
export function renameTouches(settings: Settings, oldPath: string): boolean {
	return Object.entries(settings.bases).some(([path, cfg]) => [path, cfg.folder, ...cfg.templates, ...Object.values(cfg.views)].some((p) => p !== '' && under(p, oldPath)));
}

/** Settings after a file or folder rename: base keys, template paths and folder settings follow the file. */
export function renamePath(settings: Settings, oldPath: string, newPath: string): Settings {
	const swap = (p: string) => (p !== '' && under(p, oldPath) ? newPath + p.slice(oldPath.length) : p);
	const bases: Record<string, BaseConfig> = {};
	for (const [path, cfg] of Object.entries(settings.bases)) {
		const views: Record<string, string> = {};
		for (const [k, v] of Object.entries(cfg.views)) views[k] = swap(v);
		const key = swap(path);
		if (key.endsWith('.base')) bases[key] = { ...cfg, templates: cfg.templates.map(swap), folder: swap(cfg.folder), views };
	}
	return { ...settings, bases };
}

/** One line about a base setup for the settings list. */
export function describeBase(cfg: BaseConfig): string {
	const parts: string[] = [];
	parts.push(cfg.templates.length ? `Template: ${cfg.templates.join(', ')}.` : 'No template, filter values only.');
	if (Object.keys(cfg.views).length) parts.push(`View templates: ${Object.entries(cfg.views).map(([v, t]) => `${v} -> ${t}`).join(', ')}.`);
	if (Object.keys(cfg.extraProps).length) parts.push(`Extra properties: ${Object.keys(cfg.extraProps).join(', ')}.`);
	if (cfg.folder) parts.push(`Folder: ${cfg.folder}.`);
	if (cfg.pattern) parts.push(`Name: ${cfg.pattern}.`);
	if (!cfg.onNew) parts.push('New button not used.');
	return parts.join(' ');
}
