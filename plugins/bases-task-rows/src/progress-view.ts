// The "Task progress" Bases view: one row per note in the base, with its open, done and total task counts.
// This view only reads notes. It never writes to a note.
import { BasesView, Keymap, TFile, type BasesAllOptions, type QueryController } from 'obsidian';
import { isPro } from './pro';
import { FREE_LIMIT, collectTasks } from './rows';
import { arrangeProgress, progressOf, progressText, type ProgressRow, type ProgressSort } from './progress';
import type { TaskInfo } from './task';
import { DEBOUNCE_MS, localToday } from './view';
import type BasesTaskRowsPlugin from './main';

export const PROGRESS_VIEW_TYPE = 'task-progress';
export const PROGRESS_VIEW_NAME = 'Task progress';

const SORT_OPTIONS: Record<ProgressSort, string> = { progress: 'Progress', open: 'Open tasks', due: 'Next due', note: 'Note name' };
export const PROGRESS_COLUMNS = ['Note', 'Open', 'Done', 'Total', 'Progress', 'Next due', 'Overdue'] as const;

/** View options in the Bases view menu. They are saved in the base file, one set per view. */
export function progressViewOptions(): BasesAllOptions[] {
	return [
		{ type: 'dropdown', key: 'sort', displayName: 'Sort by', default: 'progress', options: SORT_OPTIONS },
		{ type: 'toggle', key: 'descending', displayName: 'Sort highest first', default: false },
		{ type: 'toggle', key: 'showEmpty', displayName: 'Show notes without tasks', default: false },
	];
}

interface Cached {
	mtime: number;
	size: number;
	meta: unknown;
	tasks: TaskInfo[];
}

export class TaskProgressView extends BasesView {
	type = PROGRESS_VIEW_TYPE;
	readonly rootEl: HTMLElement;
	/** Every note of the current result with its tasks, in result order. */
	notes: { file: TFile; tasks: TaskInfo[] }[] = [];
	private timer: number | null = null;
	private generation = 0;
	private paths = new Set<string>();
	private readonly cache = new Map<string, Cached>();
	private readonly plugin: BasesTaskRowsPlugin;
	/** Note rows on screen, in order. */
	private shown: ProgressRow[] = [];

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: BasesTaskRowsPlugin) {
		super(controller);
		this.plugin = plugin;
		this.rootEl = containerEl.createDiv({ cls: 'btr-view btp-view' });
		this.rootEl.addEventListener('click', (evt) => this.onClick(evt));
		this.rootEl.addEventListener('auxclick', (evt) => {
			if (evt.button === 1) this.onClick(evt);
		});
	}

	onload(): void {
		this.plugin.progressViews.add(this);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (this.paths.has(file.path)) this.schedule();
			}),
		);
		if (this.paths.size > 0) this.schedule(0);
	}

	onunload(): void {
		this.plugin.progressViews.delete(this);
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.rootEl.empty();
	}

	onDataUpdated(): void {
		this.schedule();
	}

	/** Reads the notes again after a short pause (the same pause as the Task rows view). */
	schedule(delay = DEBOUNCE_MS): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.reload();
		}, delay);
	}

	/** Reads the tasks of every Markdown note in the result, then draws the table. Older passes that finish late are dropped. */
	async reload(): Promise<void> {
		const gen = ++this.generation;
		const files = (this.data?.data ?? []).map((e) => e.file).filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
		const notes: { file: TFile; tasks: TaskInfo[] }[] = [];
		const paths = new Set<string>();
		for (const file of files) {
			if (paths.has(file.path)) continue;
			paths.add(file.path);
			notes.push({ file, tasks: await this.tasksOf(file) });
		}
		if (gen !== this.generation) return;
		for (const p of [...this.cache.keys()]) if (!paths.has(p)) this.cache.delete(p);
		this.paths = paths;
		this.notes = notes;
		this.render();
	}

	/** Tasks of one note: the metadata cache gives the task lines (no code blocks), the parser reads each line. */
	private async tasksOf(file: TFile): Promise<TaskInfo[]> {
		const meta = this.app.metadataCache.getFileCache(file);
		const items = (meta?.listItems ?? []).filter((i) => i.task !== undefined);
		if (!items.length) return [];
		const hit = this.cache.get(file.path);
		if (hit && hit.mtime === file.stat.mtime && hit.size === file.stat.size && hit.meta === meta) return hit.tasks;
		const content = await this.app.vault.cachedRead(file);
		const tasks = collectTasks(
			file.path,
			file.basename,
			content,
			items.map((i) => ({ line: i.position.start.line, task: i.task })),
			[],
		).map((r) => r.info);
		this.cache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, meta, tasks });
		return tasks;
	}

	private sortKey(): ProgressSort {
		const v = this.config?.get('sort');
		return typeof v === 'string' && v in SORT_OPTIONS ? (v as ProgressSort) : 'progress';
	}

	private flag(key: string, fallback: boolean): boolean {
		const v = this.config?.get(key);
		return typeof v === 'boolean' ? v : fallback;
	}

	/** Draws the table from this.notes. */
	render(): void {
		const day = localToday();
		const pro = isPro();
		const rows: ProgressRow[] = this.notes.map((n) => ({ path: n.file.path, note: n.file.basename, progress: progressOf(n.tasks, day) }));
		const out = arrangeProgress(rows, {
			sort: this.sortKey(),
			descending: this.flag('descending', false),
			showEmpty: this.flag('showEmpty', false),
			limit: pro ? Infinity : FREE_LIMIT,
		});
		this.shown = out.rows;

		const next = createFragment();
		const n = out.matched;
		next.createDiv({ cls: 'btr-info', text: out.rows.length < n ? `Showing ${out.rows.length} of ${n} notes. Pro shows every note.` : `${n} ${n === 1 ? 'note' : 'notes'}` });
		const table = next.createEl('table', { cls: 'btr-table btp-table' });
		const head = table.createEl('thead').createEl('tr');
		for (const t of PROGRESS_COLUMNS) head.createEl('th', { text: t, cls: t === 'Note' || t === 'Progress' || t === 'Next due' ? '' : 'btp-num' });
		const body = table.createEl('tbody');
		for (const row of out.rows) {
			const p = row.progress;
			const tr = body.createEl('tr', { cls: 'btp-row' });
			tr.dataset.path = row.path;
			tr.createEl('td', { cls: 'btp-col-note' }).createEl('a', { cls: 'internal-link btp-note', text: row.note, href: '#' });
			tr.createEl('td', { cls: 'btp-num btp-col-open', text: String(p.open) });
			tr.createEl('td', { cls: 'btp-num btp-col-done', text: String(p.done) });
			tr.createEl('td', { cls: 'btp-num btp-col-total', text: String(p.total) });
			const cell = tr.createEl('td', { cls: 'btp-col-progress' });
			if (p.percent !== null) {
				cell.createEl('progress', { cls: 'btp-bar', attr: { max: '100', value: String(p.percent), 'aria-label': `${p.done} of ${p.total} tasks done` } });
				cell.createSpan({ cls: 'btp-pct', text: progressText(p) });
			}
			const due = tr.createEl('td', { cls: 'btp-col-due', text: p.nextDue ?? '' });
			if (p.nextDue && p.nextDue < day) due.addClass('btr-overdue');
			else if (p.nextDue === day) due.addClass('btr-today');
			const late = tr.createEl('td', { cls: 'btp-num btp-col-overdue', text: String(p.overdue) });
			if (p.overdue > 0) late.addClass('btr-overdue');
		}
		if (!out.rows.length) next.createDiv({ cls: 'btr-empty', text: this.notes.length ? 'No checklist tasks in the notes of this base.' : 'No notes in this base.' });
		this.rootEl.replaceChildren(next);
	}

	/** A click on a row opens its note. Ctrl or Cmd click (or the middle button) opens it in a new tab. */
	private onClick(evt: MouseEvent): void {
		const tr = (evt.target as HTMLElement).closest<HTMLElement>('tr.btp-row');
		const path = tr?.dataset.path;
		if (path === undefined) return;
		evt.preventDefault();
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		void this.app.workspace.getLeaf(evt.button === 1 ? 'tab' : Keymap.isModEvent(evt)).openFile(file);
	}

	/** Note paths on screen, for tests: in order. */
	shownPaths(): string[] {
		return this.shown.map((r) => r.path);
	}
}
