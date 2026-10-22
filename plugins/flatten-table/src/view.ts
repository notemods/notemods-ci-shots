import { BasesView, Keymap, Notice, TFile, setIcon, type BasesAllOptions, type BasesViewConfig, type HoverParent, type HoverPopover, type QueryController } from 'obsidian';
import { tokenize, type Token } from './inline';
import { FREE_MAX_SOURCES, isPro, onProChange } from './pro';
import { INDEX_COLUMN, SOURCE_COLUMN, flatten, nextSort, normName, noteName, readSort, type Flat, type FilterOp, type FlattenOptions, type Row, type SourceNote } from './flatten';
import type FlattenTablePlugin from './main';

export const VIEW_ID = 'flatten-table';
const SORT_KEY = 'flattenSort';

export interface RenderStats {
	notes: number;
	rows: number;
	totalMs: number;
}

export type ViewOptions = FlattenOptions & { showSource: boolean; showIndex: boolean };

/** The property name from the view option: "note.roles" (property picker) or "roles" (typed in the base file). */
export function propertyName(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	return raw.trim().replace(/^note\./, '');
}

/** Bases view that shows one row for each item of a list property. */
export class FlattenView extends BasesView implements HoverParent {
	type = VIEW_ID;
	hoverPopover: HoverPopover | null = null;
	/** The newest flat table, for export and tests. */
	last: Flat | null = null;
	stats: RenderStats | null = null;
	lastShowSource = true;
	private timer: number | null = null;
	private paths = new Set<string>();

	constructor(
		controller: QueryController,
		readonly containerEl: HTMLElement,
		private readonly plugin: FlattenTablePlugin,
	) {
		super(controller);
		this.containerEl.addClass('flatten-table');
		// Bases hides an empty view container in embeds and then never loads it, so the view starts with a line of text.
		this.containerEl.createDiv({ cls: 'flatten-table-empty', text: 'Reading properties...' });
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
		this.timer = null;
	}

	onDataUpdated(): void {
		this.schedule(0);
	}

	/** Redraws after `delay` ms; calls in between restart the wait (debounce). */
	schedule(delay = this.plugin.settings.debounceMs): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.render();
		}, delay);
	}

	/** The options of this view, read from the base file, with Pro-only options removed for free users. */
	options(): ViewOptions {
		const c = this.config;
		const pro = isPro();
		const str = (k: string) => {
			const v = c.get(k);
			return typeof v === 'string' ? v : '';
		};
		const list = c.get('columns');
		const sort = readSort(c.get(SORT_KEY));
		return {
			property: propertyName(c.get('property')),
			columns: Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [],
			keepEmpty: c.get('keepEmpty') === true,
			showSource: c.get('showSource') !== false,
			showIndex: c.get('showIndex') === true,
			sort,
			groupBy: pro ? str('groupColumn') : '',
			filter: pro && str('filterColumn') ? { column: str('filterColumn'), op: (str('filterOp') || 'contains') as FilterOp, value: str('filterValue') } : null,
			maxSources: pro ? 0 : FREE_MAX_SOURCES,
		};
	}

	/** Reads the front matter of the notes in the base, flattens the list property and draws the result. */
	render(): void {
		// A Pro change or a note edit can arrive before Bases has given this view its first data.
		if (!(this.data as BasesView['data'] | undefined)) return;
		const t0 = performance.now();
		const opts = this.options();
		const files = this.data.data.map((e) => e.file).filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
		this.paths = new Set(files.map((f) => f.path));
		if (!opts.property) {
			this.last = null;
			this.drawMessage('Pick a list property in the view options ("List property"). Each item of that list becomes one row.');
			return;
		}
		const notes: SourceNote[] = files.map((f) => ({ path: f.path, frontmatter: this.app.metadataCache.getFileCache(f)?.frontmatter }));
		const result = flatten(notes, opts);
		this.last = result;
		this.lastShowSource = opts.showSource;
		this.draw(result, opts);
		this.stats = { notes: files.length, rows: result.rows.length, totalMs: performance.now() - t0 };
	}

	private drawMessage(text: string): void {
		this.containerEl.empty();
		this.containerEl.createDiv({ cls: 'flatten-table-empty', text });
	}

	private draw(r: Flat, opts: ViewOptions): void {
		const el = this.containerEl;
		el.empty();
		this.drawBar(el, r, opts);
		if (r.rows.length === 0) {
			el.createDiv({ cls: 'flatten-table-empty', text: `No rows. No note in this base has items in the property "${opts.property}".` });
			return;
		}
		const wrap = el.createDiv({ cls: 'flatten-table-scroll' });
		const table = wrap.createEl('table', { cls: 'flatten-table-table' });
		const lead = [...(opts.showSource ? [SOURCE_COLUMN] : []), ...(opts.showIndex ? [INDEX_COLUMN] : [])];
		this.drawHead(table, [...lead, ...r.columns], opts);
		const body = table.createEl('tbody');
		const width = lead.length + r.columns.length;
		if (r.groups) {
			for (const g of r.groups) {
				const head = body.createEl('tr', { cls: 'flatten-table-group' });
				head.createEl('td', { text: `${g.key || '(empty)'}  ·  ${g.rows.length} ${g.rows.length === 1 ? 'row' : 'rows'}`, attr: { colspan: String(width) } });
				for (const row of g.rows) this.drawRow(body, row, opts);
			}
		} else {
			for (const row of r.rows) this.drawRow(body, row, opts);
		}
	}

	private drawBar(el: HTMLElement, r: Flat, opts: ViewOptions): void {
		const bar = el.createDiv({ cls: 'flatten-table-bar' });
		bar.createSpan({
			cls: 'flatten-table-count',
			text: `${r.rows.length} ${r.rows.length === 1 ? 'row' : 'rows'} from ${r.sources} ${r.sources === 1 ? 'note' : 'notes'} (${opts.property})`,
		});
		if (r.skippedSources > 0) {
			bar.createSpan({
				cls: 'flatten-table-limit',
				text: `The free version flattens the first ${FREE_MAX_SOURCES} notes with items. ${r.skippedSources} more ${r.skippedSources === 1 ? 'note is' : 'notes are'} left out.`,
			});
		}
		if (!isPro()) return;
		for (const kind of ['markdown', 'csv'] as const) {
			const b = bar.createEl('button', { cls: 'flatten-table-export', text: kind === 'markdown' ? 'Export Markdown' : 'Export CSV' });
			b.addEventListener('click', () => void this.plugin.exportView(this, kind));
		}
	}

	private drawHead(table: HTMLTableElement, cols: string[], opts: ViewOptions): void {
		const tr = table.createEl('thead').createEl('tr');
		const rules = readSort(opts.sort);
		for (const name of cols) {
			const priority = rules.findIndex((r) => normName(r.column) === normName(name));
			const active = rules[priority]?.dir;
			const hint = 'Click to sort this column. Shift-click to add or change a sort rule.';
			const th = tr.createEl('th', { attr: { 'aria-sort': priority === 0 ? (active === 'asc' ? 'ascending' : 'descending') : active ? 'other' : 'none', title: hint } });
			const button = th.createEl('button', {
				cls: 'flatten-table-sort-button',
				attr: { type: 'button', 'aria-label': `${name}${active ? `, sort ${priority + 1}, ${active === 'asc' ? 'ascending' : 'descending'}` : ''}. ${hint}` },
			});
			button.createSpan({ text: name });
			if (active) {
				setIcon(button.createSpan({ cls: 'flatten-table-sort' }), active === 'asc' ? 'arrow-up' : 'arrow-down');
				if (rules.length > 1) button.createSpan({ cls: 'flatten-table-sort-priority', text: String(priority + 1), attr: { 'aria-hidden': 'true' } });
			}
			th.addEventListener('click', (event) => {
				this.config.set(SORT_KEY, nextSort(this.config.get(SORT_KEY), name, event.shiftKey));
				this.schedule(0);
			});
		}
	}

	private drawRow(body: HTMLElement, row: Row, opts: ViewOptions): void {
		const tr = body.createEl('tr');
		if (opts.showSource) {
			const td = tr.createEl('td', { cls: 'flatten-table-source' });
			this.link(td, row.source.replace(/\.md$/i, ''), noteName(row.source), row.source);
		}
		if (opts.showIndex) tr.createEl('td', { cls: 'flatten-table-index', text: row.index === 0 ? '' : String(row.index) });
		for (const cell of row.cells) {
			const td = tr.createEl('td');
			for (const t of tokenize(cell)) this.drawToken(td, t, row.source);
		}
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
				// A script URL from a property must not become a link, so it shows as plain text.
				if (/^\s*(?:javascript|data|vbscript):/i.test(t.href)) td.appendText(t.text);
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

/** decodeURI that keeps the text as it is when it holds a bare "%" (decodeURI throws on it). */
function safeDecode(href: string): string {
	try {
		return decodeURI(href);
	} catch {
		return href;
	}
}

/** The options shown in the view options menu of the base. */
export function viewOptions(_config: BasesViewConfig): BasesAllOptions[] {
	return [
		{ type: 'property', key: 'property', displayName: 'List property', placeholder: 'Pick a property', filter: (p) => p.startsWith('note.') },
		{ type: 'multitext', key: 'columns', displayName: 'Columns (empty shows all)', default: [] },
		{ type: 'toggle', key: 'showSource', displayName: 'Show source column', default: true },
		{ type: 'toggle', key: 'showIndex', displayName: 'Show item number column', default: false },
		{ type: 'toggle', key: 'keepEmpty', displayName: 'Keep notes without items', default: false },
		{
			type: 'group',
			displayName: 'Pro',
			items: [
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
