// Which settings apply to one file. Pure, so the per-file rules are unit tested.
import { clampColumns, MAX_FROZEN } from './layout';

/** The choice for one named table view of a file. */
export interface ViewChoice {
	/** True turns frozen panes off for this view (free). */
	off?: boolean;
	/** Header row for this view, overriding the global switch (free). */
	header?: boolean;
	/** Frozen columns for this view, overriding the file and the default (Pro). */
	columns?: number;
}

export interface FileChoice {
	/** True turns frozen panes off for this file. */
	off?: boolean;
	/** Frozen columns for this file, overriding the default. */
	columns?: number;
	/** View name to the choice for that view. The view name comes from the core view element. */
	views?: Record<string, ViewChoice>;
}

export interface FreezeSettings {
	enabled: boolean;
	freezeHeader: boolean;
	/** Free: freeze rendered Markdown and Dataview tables. */
	freezeNoteTables: boolean;
	columns: number;
	/** Pro: pin the last column to the end edge. */
	freezeLast: boolean;
	/** Pro: pin this visible property next to the leading columns. */
	pinProperty: string;
	embedHeight: number;
	files: Record<string, FileChoice>;
}

export interface Effective {
	header: boolean;
	columns: number;
	last: boolean;
}

export const DEFAULT_SETTINGS: FreezeSettings = {
	enabled: true,
	freezeHeader: true,
	freezeNoteTables: false,
	columns: 1,
	freezeLast: false,
	pinProperty: '',
	embedHeight: 500,
	files: {},
};

export const EMBED_HEIGHT_MIN = 200;
export const EMBED_HEIGHT_MAX = 1200;
const MAX_FILES = 1000;
/** Most view choices for one file. */
export const MAX_VIEWS = 50;

/** Frozen columns without Pro. The header row, one column and the per-file on or off switch are free. */
export const FREE_COLUMNS = 1;

const OFF: Effective = { header: false, columns: 0, last: false };

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

/** The saved choice of one file. Own keys only, so a path never reads an Object prototype key. */
export function fileChoiceOf(settings: FreezeSettings, path: string | null): FileChoice | undefined {
	return path !== null && hasOwn(settings.files, path) ? settings.files[path] : undefined;
}

/** The saved choice of one view of a file. A null or empty view name has no choice. */
export function viewChoiceOf(choice: FileChoice | undefined, view: string | null): ViewChoice | undefined {
	const views = choice?.views;
	return view && views && hasOwn(views, view) ? views[view] : undefined;
}

/**
 * What to freeze for a file, and for one view of it when the view name is known.
 * Order: main switch, view off, file off, view header, global header, view columns, file columns, global columns.
 * Without Pro: at most FREE_COLUMNS columns, no per-file or per-view column count, no pinned last column.
 * The view switch and the view header are free. A null view name gives the file result, as in 1.3.
 * The saved choices stay as they are, so they come back when Pro is on again.
 */
export function effectiveFor(settings: FreezeSettings, path: string | null, pro = false, view: string | null = null): Effective {
	if (!settings.enabled) return { ...OFF };
	const choice = fileChoiceOf(settings, path);
	const viewChoice = viewChoiceOf(choice, view);
	if (viewChoice?.off === true) return { ...OFF };
	if (choice?.off === true) return { ...OFF };
	const header = viewChoice?.header ?? settings.freezeHeader;
	const wanted = pro && viewChoice?.columns !== undefined ? viewChoice.columns : pro && choice?.columns !== undefined ? choice.columns : settings.columns;
	const columns = clampColumns(wanted, settings.columns);
	return { header, columns: pro ? columns : Math.min(columns, FREE_COLUMNS), last: pro && settings.freezeLast };
}

function normalizeView(value: unknown): ViewChoice | null {
	if (typeof value !== 'object' || value === null) return null;
	const v = value as Record<string, unknown>;
	const choice: ViewChoice = {};
	if (v.off === true) choice.off = true;
	if (typeof v.header === 'boolean') choice.header = v.header;
	if (v.columns !== undefined) {
		const c = clampColumns(v.columns, -1);
		if (c >= 0 && c <= MAX_FROZEN) choice.columns = c;
	}
	return choice.off || choice.header !== undefined || choice.columns !== undefined ? choice : null;
}

/** At most MAX_VIEWS views with a usable choice. Object.fromEntries keeps a name such as "__proto__" as a plain key. */
function normalizeViews(value: unknown): Record<string, ViewChoice> | null {
	if (typeof value !== 'object' || value === null) return null;
	const entries: [string, ViewChoice][] = [];
	for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
		if (entries.length >= MAX_VIEWS) break;
		const choice = normalizeView(raw);
		if (name.length > 0 && choice) entries.push([name, choice]);
	}
	return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeChoice(value: unknown): FileChoice | null {
	if (typeof value !== 'object' || value === null) return null;
	const v = value as Record<string, unknown>;
	const choice: FileChoice = {};
	if (v.off === true) choice.off = true;
	if (v.columns !== undefined) {
		const c = clampColumns(v.columns, -1);
		if (c >= 0 && c <= MAX_FROZEN) choice.columns = c;
	}
	const views = normalizeViews(v.views);
	if (views) choice.views = views;
	return choice.off || choice.columns !== undefined || choice.views ? choice : null;
}

/** Fills gaps and drops bad values, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: unknown): FreezeSettings {
	const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
	const files: Record<string, FileChoice> = {};
	if (typeof s.files === 'object' && s.files !== null) {
		for (const [path, value] of Object.entries(s.files as Record<string, unknown>).slice(0, MAX_FILES)) {
			const choice = normalizeChoice(value);
			if (path.length > 0 && choice) files[path] = choice;
		}
	}
	const height = typeof s.embedHeight === 'number' && Number.isFinite(s.embedHeight) ? Math.round(s.embedHeight) : DEFAULT_SETTINGS.embedHeight;
	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
		freezeNoteTables: typeof s.freezeNoteTables === 'boolean' ? s.freezeNoteTables : DEFAULT_SETTINGS.freezeNoteTables,
		freezeHeader: typeof s.freezeHeader === 'boolean' ? s.freezeHeader : DEFAULT_SETTINGS.freezeHeader,
		columns: clampColumns(s.columns, DEFAULT_SETTINGS.columns),
		freezeLast: typeof s.freezeLast === 'boolean' ? s.freezeLast : DEFAULT_SETTINGS.freezeLast,
		pinProperty: typeof s.pinProperty === 'string' ? s.pinProperty.trim() : '',
		embedHeight: Math.min(EMBED_HEIGHT_MAX, Math.max(EMBED_HEIGHT_MIN, height)),
		files,
	};
}

/** Returns new settings with the file's choice set; an empty choice removes the entry. */
export function withFileChoice(settings: FreezeSettings, path: string, choice: FileChoice): FreezeSettings {
	const files = { ...settings.files };
	const clean = normalizeChoice(choice);
	if (clean) files[path] = clean;
	else delete files[path];
	return { ...settings, files };
}

/**
 * Returns new settings with one view choice set; null or an empty choice removes it.
 * A new view past MAX_VIEWS for the file returns the same settings object, so the caller can tell the user.
 */
export function withViewChoice(settings: FreezeSettings, path: string, view: string, choice: ViewChoice | null): FreezeSettings {
	if (view.length === 0) return settings;
	const current = fileChoiceOf(settings, path) ?? {};
	const entries = Object.entries(current.views ?? {}).filter(([name]) => name !== view);
	const clean = choice ? normalizeView(choice) : null;
	if (clean) {
		if (entries.length >= MAX_VIEWS) return settings;
		entries.push([view, clean]);
	}
	const next: FileChoice = { off: current.off, columns: current.columns };
	if (entries.length > 0) next.views = Object.fromEntries(entries);
	return withFileChoice(settings, path, next);
}

/** Removes the off switch and the column count of a file, and keeps its view choices. */
export function withoutFileLevel(settings: FreezeSettings, path: string): FreezeSettings {
	const views = fileChoiceOf(settings, path)?.views;
	return withFileChoice(settings, path, views ? { views } : {});
}

/** True when key is path, or the path of a file in the folder at path. */
function isAtOrUnder(key: string, path: string): boolean {
	return key === path || key.startsWith(`${path}/`);
}

/** Moves the choices of a renamed or moved file, or of the files in a renamed or moved folder. */
export function renameFile(settings: FreezeSettings, oldPath: string, newPath: string): FreezeSettings {
	// Own keys only, so a folder named "constructor" never matches an Object prototype key.
	const keys = Object.keys(settings.files).filter((key) => isAtOrUnder(key, oldPath));
	if (keys.length === 0) return settings;
	const files = { ...settings.files };
	for (const key of keys) {
		const choice = files[key];
		delete files[key];
		if (choice) files[newPath + key.slice(oldPath.length)] = choice;
	}
	return { ...settings, files };
}

/** Removes the choices of a deleted file, or of the files in a deleted folder. */
export function removeFile(settings: FreezeSettings, path: string): FreezeSettings {
	const keys = Object.keys(settings.files).filter((key) => isAtOrUnder(key, path));
	if (keys.length === 0) return settings;
	const files = { ...settings.files };
	for (const key of keys) delete files[key];
	return { ...settings, files };
}
