// The link to the Tasks plugin, read the way the Kanban plugin (2.0.51) reads it: the plugin is "on" when it is in
// app.plugins.enabledPlugins, its API is plugin.apiV1, and its settings (status symbols, recurrence order) come
// from its editor suggest, which is the one with a taskFormat setting. Every step checks the type; when
// something is missing, the card gets a plain check mark, as in Kanban.
import type { App } from 'obsidian';
import type { TasksBridge } from './done';
import { PLAIN_DONE } from './done';

export const TASKS_ID = 'obsidian-tasks-plugin';

interface TasksStatus {
	symbol?: unknown;
	type?: unknown;
	nextStatusSymbol?: unknown;
}

interface TasksApi {
	executeToggleTaskDoneCommand?: (line: string, path: string) => unknown;
}

interface TasksSettings {
	statusSettings?: { coreStatuses?: TasksStatus[]; customStatuses?: TasksStatus[] };
	recurrenceOnNextLine?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Reads a property that Obsidian does not document. A host that has no such property, or throws for it, gives undefined. */
function peek(obj: unknown, key: string): unknown {
	try {
		return isRecord(obj) ? obj[key] : undefined;
	} catch {
		return undefined;
	}
}

/** The Tasks plugin object when it is switched on, else null. */
function tasksPlugin(app: App): { apiV1?: TasksApi } | null {
	const plugins = peek(app, 'plugins');
	const enabled = peek(plugins, 'enabledPlugins');
	if (!(enabled instanceof Set) || !enabled.has(TASKS_ID)) return null;
	const p = peek(peek(plugins, 'plugins'), TASKS_ID);
	return isRecord(p) ? p : null;
}

/** The Tasks settings: the first editor suggest that has a task format. */
function tasksSettings(app: App): TasksSettings | null {
	const suggests = peek(peek(peek(app, 'workspace'), 'editorSuggest'), 'suggests');
	for (const s of Array.isArray(suggests) ? (suggests as unknown[]) : []) {
		if (isRecord(s) && isRecord(s.settings) && s.settings.taskFormat) return s.settings;
	}
	return null;
}

/** All statuses of the Tasks settings, core first. */
function statuses(settings: TasksSettings | null): TasksStatus[] {
	const st = settings?.statusSettings;
	return [...(st?.coreStatuses ?? []), ...(st?.customStatuses ?? [])];
}

/** Symbol of the DONE status. Kanban looks in the core statuses first, then in the custom ones. */
export function doneSymbol(settings: TasksSettings | null): string {
	const hit = statuses(settings).find((s) => s.type === 'DONE');
	return typeof hit?.symbol === 'string' ? hit.symbol : PLAIN_DONE;
}

/** Symbol of the status that comes before DONE, " " when there is none. */
export function preDoneSymbol(settings: TasksSettings | null): string {
	const done = doneSymbol(settings);
	const hit = statuses(settings).find((s) => s.nextStatusSymbol === done);
	return typeof hit?.symbol === 'string' ? hit.symbol : ' ';
}

/** The bridge for one board file, or null when the Tasks plugin is off or has no usable API. */
export function tasksBridge(app: App, path: string): TasksBridge | null {
	const plugin = tasksPlugin(app);
	const api = plugin?.apiV1;
	const run = api?.executeToggleTaskDoneCommand;
	if (!api || typeof run !== 'function') return null;
	const settings = tasksSettings(app);
	return {
		doneChar: doneSymbol(settings),
		preDoneChar: preDoneSymbol(settings),
		recurrenceOnNextLine: settings?.recurrenceOnNextLine === true,
		toggle: (line) => {
			// A throw inside Tasks must not stop the write: the card then gets a plain check mark, as when Tasks is off.
			try {
				const out: unknown = run.call(api, line, path);
				return typeof out === 'string' && out !== '' ? out : null;
			} catch {
				return null;
			}
		},
	};
}
