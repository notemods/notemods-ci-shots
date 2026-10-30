// The "Task rows" Bases view: one row per checklist task in the notes the base selects.
import { BasesView, Keymap, TFile, setIcon, type BasesAllOptions, type QueryController } from 'obsidian';
import { isPro, proNotice } from './pro';
import { FREE_LIMIT, arrangeRows, bucketOf, collectTasks, priorityText, type GroupKey, type SortKey, type StatusFilter, type TaskRow } from './rows';
import type { TaskEdit } from './task';
import type BasesTaskRowsPlugin from './main';

export const VIEW_TYPE = 'task-rows';
/** Wait after the last change before the rows are read again. */
export const DEBOUNCE_MS = 150;

const STATUS_OPTIONS: Record<StatusFilter, string> = { open: 'Open tasks', done: 'Done tasks', all: 'All tasks' };
const SORT_OPTIONS: Record<SortKey, string> = { due: 'Due date', scheduled: 'Scheduled date', priority: 'Priority', text: 'Task text', note: 'Note name', file: 'Order in the notes' };
const GROUP_OPTIONS: Record<GroupKey, string> = { none: 'No groups', note: 'Note', heading: 'Heading', tag: 'Tag', date: 'Date: overdue, today, next 7 days' };

/** View options in the Bases view menu. They are saved in the base file, one set per view. */
/** View key of "Sort by". Bases keeps the key "sort" for its own sort list and drops a text value there. */
export const ROW_SORT_KEY = 'rowSort';

export function viewOptions(): BasesAllOptions[] {
	return [
		{ type: 'dropdown', key: 'status', displayName: 'Show', default: 'open', options: STATUS_OPTIONS },
		{ type: 'dropdown', key: ROW_SORT_KEY, displayName: 'Sort by', default: 'due', options: SORT_OPTIONS },
		{ type: 'toggle', key: 'descending', displayName: 'Sort newest or highest first', default: false },
		{ type: 'dropdown', key: 'group', displayName: 'Group by (pro)', default: 'none', options: GROUP_OPTIONS },
		{
			type: 'group',
			displayName: 'Columns',
			items: [
				{ type: 'toggle', key: 'showScheduled', displayName: 'Scheduled date', default: true },
				{ type: 'toggle', key: 'showPriority', displayName: 'Priority', default: true },
				{ type: 'toggle', key: 'showTags', displayName: 'Tags', default: true },
				{ type: 'toggle', key: 'showHeading', displayName: 'Heading', default: true },
			],
		},
	];
}

interface Cached {
	mtime: number;
	size: number;
	/** The metadata cache entry the rows came from. The cache can parse a note after the write, with new line numbers. */
	meta: unknown;
	rows: TaskRow[];
}

export interface Timing {
	/** Reading and parsing the notes, in ms. */
	collect: number;
	/** Building the table, in ms. */
	render: number;
	tasks: number;
	rows: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Local date as YYYY-MM-DD. Plain Date, so the code does not depend on the moment types. */
export const localToday = (d = new Date()): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = localToday;

export class TaskRowsView extends BasesView {
	type = VIEW_TYPE;
	readonly rootEl: HTMLElement;
	/** Every task of the current result, in file order. */
	rows: TaskRow[] = [];
	/** Ids of the rows picked for a bulk action (Pro). */
	readonly selected = new Set<string>();
	timing: Timing = { collect: 0, render: 0, tasks: 0, rows: 0 };
	private query = '';
	private timer: number | null = null;
	private generation = 0;
	private paths = new Set<string>();
	private readonly cache = new Map<string, Cached>();
	private readonly plugin: BasesTaskRowsPlugin;
	private bodyEl: HTMLElement | null = null;
	/** Ids of the rows on screen, in order. */
	private shown: string[] = [];
	private byId = new Map<string, TaskRow>();

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: BasesTaskRowsPlugin) {
		super(controller);
		this.plugin = plugin;
		this.rootEl = containerEl.createDiv({ cls: 'btr-view' });
		this.rootEl.addEventListener('change', (evt) => this.onTableChange(evt));
		this.rootEl.addEventListener('click', (evt) => this.onTableClick(evt));
	}

	onload(): void {
		this.plugin.views.add(this);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (this.paths.has(file.path)) this.schedule();
			}),
		);
		// A view loaded again after an unload has an empty table (onunload clears it): draw it again.
		if (this.paths.size > 0) this.schedule(0);
	}

	onunload(): void {
		this.plugin.views.delete(this);
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.rootEl.empty();
	}

	onDataUpdated(): void {
		this.schedule();
	}

	/** Reads the rows again after a short pause, so a burst of changes costs one pass. */
	schedule(delay = DEBOUNCE_MS): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.reload();
		}, delay);
	}

	/** Collects the tasks of every note in the result, then draws the table. Older passes that finish late are dropped. */
	async reload(): Promise<void> {
		const gen = ++this.generation;
		const t0 = performance.now();
		const files = (this.data?.data ?? []).map((e) => e.file).filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
		const rows: TaskRow[] = [];
		const paths = new Set<string>();
		for (const file of files) {
			paths.add(file.path);
			rows.push(...(await this.tasksOf(file)));
		}
		if (gen !== this.generation) return;
		for (const p of [...this.cache.keys()]) if (!paths.has(p)) this.cache.delete(p);
		this.paths = paths;
		this.rows = rows;
		const before = this.byId;
		this.byId = new Map(rows.map((r) => [r.id, r]));
		// An id is path#line. When lines above a task move, the id points to another line, so the selection goes.
		for (const id of [...this.selected]) if (this.byId.get(id)?.raw !== before.get(id)?.raw || !this.byId.has(id)) this.selected.delete(id);
		this.timing.collect = performance.now() - t0;
		this.render();
	}

	private async tasksOf(file: TFile): Promise<TaskRow[]> {
		const meta = this.app.metadataCache.getFileCache(file);
		const items = (meta?.listItems ?? []).filter((i) => i.task !== undefined);
		if (!items.length) return [];
		const hit = this.cache.get(file.path);
		if (hit && hit.mtime === file.stat.mtime && hit.size === file.stat.size && hit.meta === meta) return hit.rows;
		const content = await this.app.vault.cachedRead(file);
		const rows = collectTasks(
			file.path,
			file.basename,
			content,
			items.map((i) => ({ line: i.position.start.line, task: i.task })),
			(meta?.headings ?? []).map((h) => ({ line: h.position.start.line, heading: h.heading })),
		);
		this.cache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, meta, rows });
		return rows;
	}

	private opt<T extends string>(key: string, allowed: Record<T, string>, fallback: T): T {
		const v = this.config?.get(key);
		return typeof v === 'string' && v in allowed ? (v as T) : fallback;
	}

	private flag(key: string, fallback: boolean): boolean {
		const v = this.config?.get(key);
		return typeof v === 'boolean' ? v : fallback;
	}

	/** Draws the toolbar and the table from this.rows. */
	render(): void {
		const t0 = performance.now();
		const pro = isPro();
		const day = today();
		const status = this.opt<StatusFilter>('status', STATUS_OPTIONS, 'open');
		// The old key "sort" is the fallback. Bases keeps "sort" for its own sort list (see ROW_SORT_KEY).
		const sort = this.opt<SortKey>(ROW_SORT_KEY, SORT_OPTIONS, this.opt<SortKey>('sort', SORT_OPTIONS, 'due'));
		const wanted = this.opt<GroupKey>('group', GROUP_OPTIONS, 'none');
		const group = pro ? wanted : 'none';
		const cols = { scheduled: this.flag('showScheduled', true), priority: this.flag('showPriority', true), tags: this.flag('showTags', true), heading: this.flag('showHeading', true) };
		const out = arrangeRows(this.rows, { status, query: this.query, sort, descending: this.flag('descending', false), group, limit: pro ? Infinity : FREE_LIMIT, today: day });
		this.shown = out.groups.flatMap((g) => g.rows.map((r) => r.id));

		const root = this.rootEl;
		const keepFocus = root.querySelector<HTMLInputElement>('.btr-search') === activeDocument.activeElement;
		// Build off screen, then swap in one step.
		const next = createFragment();
		this.renderToolbar(next, { status, sort, group: wanted, pro });
		const info = next.createDiv({ cls: 'btr-info' });
		const n = out.matched;
		info.setText(out.shown < n ? `Showing ${out.shown} of ${n} tasks. Pro shows every task.` : `${n} ${n === 1 ? 'task' : 'tasks'}`);
		if (!pro && wanted !== 'none') info.createSpan({ cls: 'btr-pro-note', text: ' Grouping is a pro feature, so the rows are not grouped.' });

		const table = next.createEl('table', { cls: 'btr-table' });
		const head = table.createEl('thead').createEl('tr');
		if (pro) head.createEl('th', { cls: 'btr-col-select' }).createEl('input', { type: 'checkbox', cls: 'btr-select-all', attr: { 'aria-label': 'Select every shown task' } });
		const titles = ['', 'Task', 'Due', ...(cols.scheduled ? ['Scheduled'] : []), ...(cols.priority ? ['Priority'] : []), ...(cols.tags ? ['Tags'] : []), 'Note', ...(cols.heading ? ['Heading'] : []), ...(pro ? [''] : [])];
		for (const t of titles) head.createEl('th', { text: t });
		const body = table.createEl('tbody');
		const span = String(titles.length + (pro ? 1 : 0));
		const icon = pro ? this.todayButton() : null;
		for (const g of out.groups) {
			if (group !== 'none') body.createEl('tr', { cls: 'btr-group', attr: { 'data-group': g.key } }).createEl('td', { text: `${g.label} (${g.rows.length})`, attr: { colspan: span } });
			for (const row of g.rows) this.renderRow(body, row, { pro, day, cols, icon });
		}
		if (!out.matched) next.createDiv({ cls: 'btr-empty', text: this.rows.length ? 'No task matches the filter.' : 'No checklist tasks in the notes of this base.' });
		root.replaceChildren(next);
		this.bodyEl = body;
		this.updateSelection();
		if (keepFocus) {
			const s = root.querySelector<HTMLInputElement>('.btr-search');
			s?.focus();
			s?.setSelectionRange(s.value.length, s.value.length);
		}
		this.timing = { ...this.timing, render: performance.now() - t0, tasks: this.rows.length, rows: out.shown };
	}

	/** One listener for the whole table: done boxes, select boxes, links, due cells and the today buttons. */
	private onTableChange(evt: Event): void {
		const target = evt.target as HTMLElement;
		if (target.hasClass('btr-select-all')) {
			const on = (target as HTMLInputElement).checked;
			for (const id of this.shown) {
				if (on) this.selected.add(id);
				else this.selected.delete(id);
			}
			this.bodyEl?.querySelectorAll<HTMLInputElement>('td.btr-col-select input').forEach((b) => (b.checked = on));
			this.updateSelection();
			return;
		}
		const row = this.rowOf(target);
		if (!row) return;
		const box = target as HTMLInputElement;
		if (target.hasClass('task-list-item-checkbox')) {
			box.disabled = true;
			void this.plugin.editRows([row], box.checked ? { type: 'done', today: today() } : { type: 'open' }).then(() => this.schedule(0));
		} else if (target.hasClass('btr-select')) {
			if (box.checked) this.selected.add(row.id);
			else this.selected.delete(row.id);
			this.updateSelection();
		}
	}

	private onTableClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement;
		const row = this.rowOf(target);
		if (!row) return;
		if (target.closest('a.btr-text, a.btr-note')) {
			evt.preventDefault();
			void this.open(row, Keymap.isModEvent(evt) !== false);
			return;
		}
		if (target.closest('button.btr-today')) {
			if (!isPro()) return;
			void this.plugin.editRows([row], { type: 'today', today: today() }).then(() => this.schedule(0));
			return;
		}
		const due = target.closest<HTMLElement>('td.btr-editable');
		if (due) this.editDue(due, row);
	}

	private rowOf(el: HTMLElement): TaskRow | undefined {
		const id = el.closest<HTMLElement>('tr.btr-row')?.dataset.id;
		return id === undefined ? undefined : this.byId.get(id);
	}

	/** Counts on the bulk buttons and the state of the select-all box, without drawing the rows again. */
	private updateSelection(): void {
		const n = this.selected.size;
		this.rootEl.querySelectorAll<HTMLButtonElement>('button.btr-bulk-done, button.btr-bulk-today').forEach((b) => {
			b.disabled = n === 0;
			b.setText(`${b.hasClass('btr-bulk-done') ? 'Complete selected' : 'Move selected to today'} (${n})`);
		});
		const all = this.rootEl.querySelector<HTMLInputElement>('input.btr-select-all');
		if (all) all.checked = this.shown.length > 0 && this.shown.every((id) => this.selected.has(id));
	}

	/** The calendar button, made once per pass and cloned for each row (an icon per row is slow). */
	private todayButton(): HTMLElement {
		const btn = createEl('button', { cls: 'clickable-icon btr-today', attr: { 'aria-label': 'Move to today' } });
		setIcon(btn, 'calendar-check');
		return btn;
	}

	private renderToolbar(root: DocumentFragment, s: { status: StatusFilter; sort: SortKey; group: GroupKey; pro: boolean }): void {
		const bar = root.createDiv({ cls: 'btr-toolbar' });
		const search = bar.createEl('input', { type: 'search', cls: 'btr-search', attr: { placeholder: 'Filter tasks, tags, notes', 'aria-label': 'Filter tasks' } });
		search.value = this.query;
		search.addEventListener('input', () => {
			this.query = search.value;
			this.render();
		});
		this.select(bar, 'status', STATUS_OPTIONS, s.status, 'Show');
		this.select(bar, ROW_SORT_KEY, SORT_OPTIONS, s.sort, 'Sort by');
		const dir = bar.createEl('button', { cls: 'clickable-icon btr-dir', attr: { 'aria-label': 'Reverse the sort' } });
		setIcon(dir, this.flag('descending', false) ? 'arrow-up-wide-narrow' : 'arrow-down-narrow-wide');
		dir.addEventListener('click', () => {
			this.config.set('descending', !this.flag('descending', false));
			this.render();
		});
		const grp = this.select(bar, 'group', GROUP_OPTIONS, s.group, 'Group by');
		if (!s.pro) grp.addClass('btr-locked');
		if (!s.pro) return;
		const done = bar.createEl('button', { cls: 'btr-bulk-done' });
		done.addEventListener('click', () => void this.bulk({ type: 'done', today: today() }));
		const move = bar.createEl('button', { cls: 'btr-bulk-today' });
		move.addEventListener('click', () => void this.bulk({ type: 'today', today: today() }));
	}

	private select<T extends string>(bar: HTMLElement, key: string, options: Record<T, string>, value: T, label: string): HTMLSelectElement {
		const el = bar.createEl('select', { cls: `dropdown btr-${key}`, attr: { 'aria-label': label } });
		for (const [k, v] of Object.entries(options) as Array<[T, string]>) el.createEl('option', { value: k, text: v });
		el.value = value;
		el.addEventListener('change', () => {
			if (key === 'group' && el.value !== 'none' && !isPro()) {
				proNotice('Grouping is a pro feature.');
				el.value = value;
				return;
			}
			this.config.set(key, el.value);
			this.render();
		});
		return el;
	}

	private renderRow(body: HTMLElement, row: TaskRow, o: { pro: boolean; day: string; cols: { scheduled: boolean; priority: boolean; tags: boolean; heading: boolean }; icon: HTMLElement | null }): void {
		const info = row.info;
		const tr = body.createEl('tr', { cls: info.done ? 'btr-row is-done' : 'btr-row' });
		tr.dataset.id = row.id;
		if (o.pro) {
			const pick = tr.createEl('td', { cls: 'btr-col-select' }).createEl('input', { type: 'checkbox', cls: 'btr-select', attr: { 'aria-label': 'Select this task' } });
			pick.checked = this.selected.has(row.id);
		}
		const box = tr.createEl('td', { cls: 'btr-col-done' }).createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox', attr: { 'aria-label': info.done ? 'Mark as not done' : 'Mark as done' } });
		box.checked = info.done;
		tr.createEl('td', { cls: 'btr-col-text' }).createEl('a', { cls: 'btr-text', text: info.text || '(empty task)', href: '#' });
		const due = tr.createEl('td', { cls: `btr-col-due btr-${bucketOf(info, o.day)}`, text: info.dates.due ?? '' });
		if (o.pro) {
			due.addClass('btr-editable');
			due.setAttr('aria-label', 'Edit the due date');
		}
		if (o.cols.scheduled) tr.createEl('td', { cls: 'btr-col-scheduled', text: info.dates.scheduled ?? '' });
		if (o.cols.priority) tr.createEl('td', { cls: 'btr-col-priority', text: priorityText(info.priority) });
		if (o.cols.tags) {
			const cell = tr.createEl('td', { cls: 'btr-col-tags' });
			for (const t of info.tags) cell.createSpan({ cls: 'tag', text: `#${t}` });
		}
		tr.createEl('td', { cls: 'btr-col-note' }).createEl('a', { cls: 'internal-link btr-note', text: row.note, href: '#' });
		if (o.cols.heading) tr.createEl('td', { cls: 'btr-col-heading', text: row.heading });
		if (o.icon) tr.createEl('td', { cls: 'btr-col-actions' }).appendChild(o.icon.cloneNode(true));
	}

	/** Pro: swaps the due cell for a date input; Enter or leaving the cell writes, Escape cancels. */
	private editDue(cell: HTMLElement, row: TaskRow): void {
		if (cell.querySelector('input') || !isPro()) return;
		cell.empty();
		const input = cell.createEl('input', { type: 'date', cls: 'btr-date-input' });
		input.value = row.info.dates.due ?? '';
		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			const value = input.value.trim();
			if (!save || value === (row.info.dates.due ?? '')) return this.render();
			void this.plugin.editRows([row], { type: 'date', field: 'due', value: value || null }).then(() => this.schedule(0));
		};
		input.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') finish(true);
			if (evt.key === 'Escape') finish(false);
		});
		input.addEventListener('blur', () => finish(true));
		input.focus();
	}

	private async bulk(edit: TaskEdit): Promise<void> {
		if (!isPro()) return;
		const rows = this.rows.filter((r) => this.selected.has(r.id));
		if (!rows.length) return;
		await this.plugin.editRows(rows, edit);
		this.selected.clear();
		this.schedule(0);
	}

	private async open(row: TaskRow, newLeaf: boolean): Promise<void> {
		const file = this.app.vault.getFileByPath(row.path);
		if (!file) return;
		await this.app.workspace.getLeaf(newLeaf).openFile(file, { eState: { line: row.line } });
	}

	/** Rows on screen, for tests: the ids in order. */
	shownIds(): string[] {
		return Array.from(this.bodyEl?.querySelectorAll<HTMLElement>('tr.btr-row') ?? []).map((tr) => tr.dataset.id ?? '');
	}
}
