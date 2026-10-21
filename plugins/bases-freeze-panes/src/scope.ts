// Which settings apply to one file. Pure, so the per-file rules are unit tested.
import { clampColumns, MAX_FROZEN } from './layout';

export interface FileChoice {
	/** True turns frozen panes off for this file. */
	off?: boolean;
	/** Frozen columns for this file, overriding the default. */
	columns?: number;
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

/** Frozen columns without Pro. The header row, one column and the per-file on or off switch are free. */
export const FREE_COLUMNS = 1;

/**
 * What to freeze for a file: the global switch first, then the file's own choice, then the defaults.
 * Without Pro: at most FREE_COLUMNS columns, no per-file column count, no pinned last column.
 * The saved choices stay as they are, so they come back when Pro is on again.
 */
export function effectiveFor(settings: FreezeSettings, path: string | null, pro = false): Effective {
	if (!settings.enabled) return { header: false, columns: 0, last: false };
	const choice = path === null ? undefined : settings.files[path];
	if (choice?.off === true) return { header: false, columns: 0, last: false };
	const wanted = pro && choice?.columns !== undefined ? choice.columns : settings.columns;
	const columns = clampColumns(wanted, settings.columns);
	return { header: settings.freezeHeader, columns: pro ? columns : Math.min(columns, FREE_COLUMNS), last: pro && settings.freezeLast };
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
	return choice.off || choice.columns !== undefined ? choice : null;
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
