import { BasesView, Keymap, Notice, TFile, setIcon, type BasesAllOptions, type BasesViewConfig, type HoverParent, type HoverPopover, type QueryController } from 'obsidian';
import { tokenize, type Token } from './inline';
import { FREE_MAX_SOURCES, isPro, onProChange } from './pro';
import { SOURCE_COLUMN, noteName, rollup, type FilterOp, type Mode, type Rollup, type RollupOptions, type Row, type SourceNote, type SummaryFn, type Which } from './table';
import type TableRollupPlugin from './main';

export const VIEW_ID = 'table-rollup';
const SORT_KEY = 'rollupSort';
const FIND_KEY = 'rollupFind';

export interface RenderStats {
	notes: number;
	rows: number;
	readMs: number;
	totalMs: number;
}

/** Bases view that merges the tables of every note in the base into one table. */
export class RollupView extends BasesView implements HoverParent {
	type = VIEW_ID;
	hoverPopover: HoverPopover | null = null;
	/** The newest merged table, for export and tests. */
	last: Rollup | null = null;
	stats: RenderStats | null = null;
	lastShowSource = true;
	private token = 0;
	private timer: number | null = null;
	private findTimer: number | null = null;
	private paths = new Set<string>();

	constructor(
		controller: QueryController,
		readonly containerEl: HTMLElement,
		private readonly plugin: TableRollupPlugin,
	) {
		super(controller);
		this.containerEl.addClass('table-rollup');
		// Bases hides an empty view container in embeds and then never loads it, so the view starts with a line of text.
		this.containerEl.createDiv({ cls: 'table-rollup-empty', text: 'Reading tables...' });
	}

	/**
	 * Events go here, not in the constructor: Bases can unload a view and load the same object again (for example
	 * when the plugin reloads with a base open), and an unload removes everything that was registered.
	 */
	onload(): void {
		this.plugin.views.add(this);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (this.paths.has(file.path)) this.schedule();
			}),
		);
		this.register(onProChange(() => this.schedule(0)));
		if (this.last) this.schedule(0);
	}

	onunload(): void {
		this.plugin.views.delete(this);
		if (this.timer !== null) window.clearTimeout(this.timer);
		if (this.findTimer !== null) window.clearTimeout(this.findTimer);
		this.findTimer = null;
		this.token++;
	}

	onDataUpdated(): void {
		this.schedule(0);
	}

	/** Redraws after `delay` ms; calls in between restart the wait (debounce). */
	schedule(delay = this.plugin.settings.debounceMs): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.render();
		}, delay);
	}

	/** The options of this view, read from the base file, with Pro-only options removed for free users. */
	options(): RollupOptions & { showSource: boolean } {
		const c = this.config;
		const pro = isPro();
		const str = (k: string) => (typeof c.get(k) === 'string' ? (c.get(k) as string) : '');
		const list = c.get('columns');
		const sort = c.get(SORT_KEY) as RollupOptions['sort'] | undefined;
		return {
			mode: (str('mode') || 'tables') as Mode,
			heading: str('heading'),
			which: (str('which') || 'first') as Which,
			columns: Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [],
			showSource: c.get('showSource') !== false,
			sort: sort && typeof sort.column === 'string' ? sort : null,
			summary: pro ? ((str('summary') || 'none') as SummaryFn) : 'none',
			groupBy: pro ? str('groupColumn') : '',
			filter: pro && str('filterColumn') ? { column: str('filterColumn'), op: (str('filterOp') || 'contains') as FilterOp, value: str('filterValue') } : null,
			find: str(FIND_KEY),
			maxSources: pro ? 0 : FREE_MAX_SOURCES,
		};
	}

	/** Reads the notes of the base, merges their tables and draws the result. Older runs that finish late are dropped. */
	async render(): Promise<void> {
		// A Pro change or a note edit can arrive before Bases has given this view its first data.
		if (!(this.data as BasesView['data'] | undefined)) return;
		const run = ++this.token;
		const t0 = performance.now();
		const opts = this.options();
		const files = this.data.data.map((e) => e.file).filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
		this.paths = new Set(files.map((f) => f.path));
		if (opts.mode === 'tasks' && !isPro()) {
			this.drawMessage('The task list rollup is a pro feature. Sponsor on GitHub, then sign in from the plugin settings, or set Read to Tables in the view options.');
			return;
		}
		const notes: SourceNote[] = await Promise.all(files.map((f) => this.plugin.readNote(f, opts.mode ?? 'tables')));
		if (run !== this.token) return;
		const t1 = performance.now();
		const result = rollup(notes, opts);
		this.last = result;
		this.lastShowSource = opts.showSource;
		this.draw(result, opts);
		this.stats = { notes: files.length, rows: result.rows.length, readMs: t1 - t0, totalMs: performance.now() - t0 };
	}

	private drawMessage(text: string): void {
		this.containerEl.empty();
		this.containerEl.createDiv({ cls: 'table-rollup-empty', text });
	}

	private draw(r: Rollup, opts: ReturnType<RollupView['options']>): void {
		const el = this.containerEl;
		const active = document.activeElement;
		const keepFind = active instanceof HTMLInputElement && el.contains(active) && active.classList.contains('table-rollup-find-input');
		const caret = keepFind ? active.selectionStart : null;
		// A live update can draw again while the user types: keep the typed text, not the saved one.
		const typed = keepFind ? active.value : null;
		el.empty();
		this.drawBar(el, r, opts);
		if (keepFind) {
			const input = el.querySelector<HTMLInputElement>('.table-rollup-find-input');
			if (input) {
				if (typed !== null && input.value !== typed) {
					input.value = typed;
					input.parentElement?.toggleClass('has-text', typed.trim() !== '');
				}
				input.focus();
				const end = caret ?? input.value.length;
				input.setSelectionRange(end, end);
			}
		}
		if (r.rows.length === 0 && opts.find?.trim()) {
			el.createDiv({ cls: 'table-rollup-empty', text: `No rows hold "${opts.find.trim()}". Select the X button to show all rows.` });
			return;
		}
		if (r.rows.length === 0) {
			const where = opts.heading ? `under the heading "${opts.heading}"` : 'in these notes';
			el.createDiv({ cls: 'table-rollup-empty', text: `No rows. No note in this base has a ${opts.mode === 'tasks' ? 'task' : 'table row'} ${where}.` });
			return;
		}
		const wrap = el.createDiv({ cls: 'table-rollup-scroll' });
		const table = wrap.createEl('table', { cls: 'table-rollup-table' });
		this.drawHead(table, r, opts);
		const body = table.createEl('tbody');
		const width = r.columns.length + (opts.showSource ? 1 : 0);
		if (r.groups) {
			for (const g of r.groups) {
				const head = body.createEl('tr', { cls: 'table-rollup-group' });
				head.createEl('td', { text: `${g.key || '(empty)'}  ·  ${g.rows.length} ${g.rows.length === 1 ? 'row' : 'rows'}`, attr: { colspan: String(width) } });
				for (const row of g.rows) this.drawRow(body, row, r, opts.showSource);
				if (g.summary) this.drawSummary(body, g.summary, opts.showSource, 'Subtotal', 'table-rollup-subtotal');
			}
		} else {
			for (const row of r.rows) this.drawRow(body, row, r, opts.showSource);
		}
		if (r.summary) this.drawSummary(table.createEl('tfoot'), r.summary, opts.showSource, labelOf(opts.summary ?? 'none'), 'table-rollup-total');
	}

	private drawBar(el: HTMLElement, r: Rollup, opts: ReturnType<RollupView['options']>): void {
		const bar = el.createDiv({ cls: 'table-rollup-bar' });
		bar.createSpan({ cls: 'table-rollup-count', text: `${r.rows.length} ${r.rows.length === 1 ? 'row' : 'rows'} from ${r.sources} ${r.sources === 1 ? 'note' : 'notes'}` });
		const find = bar.createDiv({ cls: 'table-rollup-find' });
		if ((opts.find ?? '').trim()) find.addClass('has-text');
		const input = find.createEl('input', {
			cls: 'table-rollup-find-input',
			type: 'text',
			attr: { placeholder: 'Find rows...', 'aria-label': 'Find rows', value: opts.find ?? '', 'data-testid': 'table-rollup-find' },
		});
		input.addEventListener('input', () => {
			find.classList.toggle('has-text', input.value.trim() !== '');
			if (this.findTimer !== null) window.clearTimeout(this.findTimer);
			this.findTimer = window.setTimeout(() => {
				this.findTimer = null;
				// Read the box that is on screen now: a redraw can replace this input before the wait ends.
				const now = this.containerEl.querySelector<HTMLInputElement>('.table-rollup-find-input') ?? input;
				this.config.set(FIND_KEY, now.value);
				this.schedule(0);
			}, 200);
		});
		const clear = find.createEl('button', { cls: 'table-rollup-find-clear clickable-icon', attr: { 'aria-label': 'Clear find', 'data-testid': 'table-rollup-find-clear' } });
		setIcon(clear, 'x');
		clear.addEventListener('click', () => {
			if (this.findTimer !== null) window.clearTimeout(this.findTimer);
			this.findTimer = null;
			input.value = '';
			this.config.set(FIND_KEY, '');
			this.schedule(0);
		});
		if (r.skippedSources > 0) {
			bar.createSpan({
				cls: 'table-rollup-limit',
				text: `The free version merges the first ${FREE_MAX_SOURCES} notes with rows. ${r.skippedSources} more ${r.skippedSources === 1 ? 'note is' : 'notes are'} left out.`,
			});
		}
		if (!isPro()) return;
		for (const kind of ['markdown', 'csv'] as const) {
			const b = bar.createEl('button', { cls: 'table-rollup-export', text: kind === 'markdown' ? 'Export Markdown' : 'Export CSV' });
			b.addEventListener('click', () => void this.plugin.exportView(this, kind));
		}
	}

	private drawHead(table: HTMLTableElement, r: Rollup, opts: ReturnType<RollupView['options']>): void {
		const tr = table.createEl('thead').createEl('tr');
		const cols = opts.showSource ? [SOURCE_COLUMN, ...r.columns] : r.columns;
		const aligns = opts.showSource ? [null, ...r.align] : r.align;
		cols.forEach((name, i) => {
			const active = opts.sort && opts.sort.column.toLowerCase() === name.toLowerCase() ? opts.sort.dir : null;
			const th = tr.createEl('th', { attr: { 'aria-sort': active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none', title: 'Sort by this column' } });
			if (aligns[i]) th.addClass(`table-rollup-${aligns[i]}`);
			th.createSpan({ text: name });
			if (active) setIcon(th.createSpan({ cls: 'table-rollup-sort' }), active === 'asc' ? 'arrow-up' : 'arrow-down');
			th.addEventListener('click', () => this.cycleSort(name, active));
		});
	}

	/** Header click: ascending, then descending, then no sort. Stored in the base file with the view. */
	private cycleSort(column: string, active: 'asc' | 'desc' | null): void {
		const next = active === null ? { column, dir: 'asc' } : active === 'asc' ? { column, dir: 'desc' } : null;
		this.config.set(SORT_KEY, next);
		this.schedule(0);
	}

	private drawRow(body: HTMLElement, row: Row, r: Rollup, showSource: boolean): void {
		const tr = body.createEl('tr');
		if (showSource) {
			const td = tr.createEl('td', { cls: 'table-rollup-source' });
			this.link(td, row.source.replace(/\.md$/i, ''), noteName(row.source), row.source);
		}
		row.cells.forEach((cell, k) => {
			const td = tr.createEl('td');
			if (r.align[k]) td.addClass(`table-rollup-${r.align[k]}`);
			this.drawCell(td, cell, row.source);
		});
	}

	private drawSummary(parent: HTMLElement, values: (string | null)[], showSource: boolean, label: string, cls: string): void {
		const tr = parent.createEl('tr', { cls });
		if (showSource) tr.createEl('td', { text: label });
		values.forEach((v, k) => {
			const td = tr.createEl('td', { text: v ?? '' });
			if (k === 0 && !showSource && v === null) td.setText(label);
		});
	}

	private drawCell(td: HTMLElement, cell: string, sourcePath: string): void {
		for (const t of tokenize(cell)) this.drawToken(td, t, sourcePath);
	}

	private drawToken(td: HTMLElement, t: Token, sourcePath: string): void {
		switch (t.kind) {
			case 'text':
				td.appendText(t.text);
				return;
			case 'code':
				td.createEl('code', { text: t.text });
				return;
			case 'wikilink':
				this.link(td, t.target, t.text, sourcePath);
				return;
			case 'link':
				// A script or data URL from a note is shown as text, never as a link that runs it.
				if (/^\s*(javascript|vbscript|data):/i.test(t.href)) td.appendText(t.text);
				else if (/^[a-z][a-z0-9+.-]*:/i.test(t.href)) td.createEl('a', { cls: 'external-link', text: t.text, href: t.href, attr: { target: '_blank', rel: 'noopener' } });
				else this.link(td, safeDecode(t.href), t.text, sourcePath);
				return;
			case 'tag':
				td.createEl('a', { cls: 'tag', text: t.text, href: t.text });
				return;
			default:
				td.createEl(({ strong: 'strong', em: 'em', del: 'del', mark: 'mark' } as const)[t.kind], { text: t.text });
		}
	}

	/** An internal link that opens the note (Ctrl or Cmd click: new tab) and shows the page preview on hover. */
	private link(parent: HTMLElement, target: string, text: string, sourcePath: string): void {
		const a = parent.createEl('a', { cls: 'internal-link', text, href: target, attr: { 'data-href': target } });
		a.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.app.workspace.openLinkText(target, sourcePath, Keymap.isModEvent(evt));
		});
		a.addEventListener('mouseover', (event) => {
			this.app.workspace.trigger('hover-link', { event, source: VIEW_ID, hoverParent: this, targetEl: a, linktext: target, sourcePath });
		});
	}

	/** Is this view in the active tab? */
	isActive(): boolean {
		const leafEl = this.app.workspace.getMostRecentLeaf()?.view.containerEl ?? null;
		return leafEl !== null && this.containerEl.isConnected && leafEl.contains(this.containerEl);
	}

	/** Shows a notice that a feature needs Pro. */
	static needsPro(feature: string): void {
		new Notice(`${feature} is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
	}
}

/** decodeURI that keeps the text as it is when it holds a percent sign that is not an escape (100%.md). */
function safeDecode(href: string): string {
	try {
		return decodeURI(href);
	} catch {
		return href;
	}
}

function labelOf(fn: SummaryFn): string {
	return { none: '', sum: 'Sum', avg: 'Average', count: 'Count', min: 'Min', max: 'Max' }[fn];
}

/** The options shown in the view options menu of the base. */
export function viewOptions(config: BasesViewConfig): BasesAllOptions[] {
	const tasks = () => config.get('mode') === 'tasks';
	return [
		{ type: 'dropdown', key: 'mode', displayName: 'Read', default: 'tables', options: { tables: 'Tables', tasks: 'Tasks (Pro)' } },
		{ type: 'text', key: 'heading', displayName: 'Under heading', default: '', placeholder: 'Any heading' },
		{ type: 'dropdown', key: 'which', displayName: 'Which table', default: 'first', options: { first: 'First', second: 'Second', third: 'Third', all: 'All' }, shouldHide: tasks },
		{ type: 'multitext', key: 'columns', displayName: 'Columns (empty shows all)', default: [] },
		{ type: 'toggle', key: 'showSource', displayName: 'Show source column', default: true },
		{
			type: 'group',
			displayName: 'Pro',
			items: [
				{ type: 'dropdown', key: 'summary', displayName: 'Summary row', default: 'none', options: { none: 'None', sum: 'Sum', avg: 'Average', count: 'Count', min: 'Min', max: 'Max' } },
				{ type: 'text', key: 'groupColumn', displayName: 'Group by column', default: '', placeholder: 'Column name or Source' },
				{ type: 'text', key: 'filterColumn', displayName: 'Filter column', default: '', placeholder: 'Column name' },
				{
					type: 'dropdown',
					key: 'filterOp',
					displayName: 'Filter rule',
					default: 'contains',
					options: { contains: 'contains', 'not-contains': 'does not contain', equals: 'is', 'not-equals': 'is not', gt: '>', gte: '>=', lt: '<', lte: '<=', empty: 'is empty', 'not-empty': 'is not empty' },
				},
				{ type: 'text', key: 'filterValue', displayName: 'Filter value', default: '' },
			],
		},
	];
}
