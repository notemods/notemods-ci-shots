import { BasesView, BooleanValue, ListValue, NullValue, NumberValue, Keymap, type BasesAllOptions, type BasesEntry, type BasesPropertyId, type QueryController, type Value } from 'obsidian';
import { buildGroups, effectiveProperties, type Cell, type Group, type GroupOptions, type Row } from './group';
import { isPro, onProChange } from './pro';

export const VIEW_ID = 'bases-multi-group';
export const KEY = { first: 'multiGroupFirst', second: 'multiGroupSecond', third: 'multiGroupThird', split: 'multiGroupSplit', number: 'multiGroupNumber', mode: 'multiGroupMode', remember: 'multiGroupRemember', collapsed: 'multiGroupCollapsed' } as const;
export function plain(value: Value | null): Cell {
	if (value === null || value instanceof NullValue) return null;
	if (value instanceof ListValue) {
		const result: (string | number | boolean | null)[] = [];
		for (let i = 0; i < value.length(); i++) { const v = plain(value.get(i)); if (!Array.isArray(v)) result.push(v); }
		return result;
	}
	if (value instanceof NumberValue) { const n = Number(value.toString()); return Number.isFinite(n) ? n : null; }
	if (value instanceof BooleanValue) return value.isTruthy();
	return value.toString();
}
export class MultiGroupView extends BasesView {
	type = VIEW_ID;
	readonly root: HTMLElement;
	private collapsed = new Set<string>();
	private stateMode: boolean | null = null;
	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.root = containerEl.createDiv({ cls: 'bases-multi-group', attr: { role: 'region' } });
	}
	onload(): void {
		this.register(onProChange(() => this.render()));
		this.registerDomEvent(this.root, 'toggle', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLDetailsElement) || !target.dataset.group) return;
			const key = target.dataset.group;
			const was = this.collapsed.has(key);
			if (was === !target.open) return;
			if (target.open) this.collapsed.delete(key); else this.collapsed.add(key);
			this.persist();
		}, { capture: true });
	}
	onunload(): void { this.root.empty(); }
	onDataUpdated(): void { this.render(); }
	private persist(): void {
		if (isPro() && this.config.get(KEY.remember) === true) this.config.set(KEY.collapsed, [...this.collapsed]);
	}
	options(): GroupOptions {
		const properties = [KEY.first, KEY.second, KEY.third].map((k) => this.config.getAsPropertyId(k)).filter((p): p is BasesPropertyId => p !== null);
		return { properties, splitLists: this.config.get(KEY.split) === true, pro: isPro(), summaryProperty: this.config.getAsPropertyId(KEY.number) ?? undefined, summaryMode: this.config.get(KEY.mode) === 'average' ? 'average' : 'sum' };
	}
	render(): void {
		if (!(this.data as BasesView['data'] | undefined)) return;
		this.root.setAttribute('aria-label', this.config.name);
		const opts = this.options();
		const remember = opts.pro && this.config.get(KEY.remember) === true;
		if (this.stateMode !== remember) { this.collapsed.clear(); this.stateMode = remember; }
		if (remember) {
			const saved = this.config.get(KEY.collapsed);
			this.collapsed = new Set(Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : []);
		}
		this.root.empty();
		const properties = effectiveProperties(opts.properties, opts.pro);
		const entries = new Map(this.data.data.map((entry) => [entry.file.path, entry]));
		const rows: Row[] = this.data.data.map((entry) => {
			const values: Record<string, Cell> = {};
			for (const property of [...properties, ...(opts.summaryProperty ? [opts.summaryProperty] : [])]) values[property] = plain(entry.getValue(property as BasesPropertyId));
			return { id: entry.file.path, values };
		});
		const groups = buildGroups(rows, opts);
		const bar = this.root.createDiv({ cls: 'bmg-bar' });
		bar.createSpan({ text: `${entries.size} notes · ${properties.length} grouping levels` });
		const collapse = bar.createEl('button', { text: 'Collapse all' });
		const expand = bar.createEl('button', { text: 'Expand all' });
		const allKeys = (items: Group[]): string[] => items.flatMap((g) => [g.key, ...allKeys(g.children)]);
		collapse.addEventListener('click', () => { this.collapsed = new Set(allKeys(groups)); this.persist(); this.render(); });
		expand.addEventListener('click', () => { this.collapsed.clear(); this.persist(); this.render(); });
		if (!rows.length) { this.root.createDiv({ cls: 'bmg-empty', text: 'No notes match this base. Change its filters to see groups.' }); return; }
		if (!properties.length) this.root.createDiv({ cls: 'bmg-empty', text: 'Choose First property and Then property in the view options to make nested groups.' });
		const configured = this.config.getOrder();
		const columns: BasesPropertyId[] = configured.length ? configured : ['file.name'];
		const table = (parent: HTMLElement, ids: string[]) => {
			const el = parent.createEl('table', { cls: 'bmg-table' });
			const head = el.createEl('thead').createEl('tr');
			head.createEl('th', { text: 'Note', attr: { scope: 'col' } });
			for (const p of columns.filter((p) => p !== 'file.name')) head.createEl('th', { text: this.config.getDisplayName(p), attr: { scope: 'col' } });
			const body = el.createEl('tbody');
			for (const id of ids) { const entry = entries.get(id); if (entry) this.row(body, entry, columns); }
		};
		const draw = (parent: HTMLElement, items: Group[]) => {
			for (const group of items) {
				const details = parent.createEl('details', { cls: 'bmg-group' });
				details.dataset.group = group.key;
				details.open = !this.collapsed.has(group.key);
				const heading = details.createEl('summary');
				heading.createSpan({ cls: 'bmg-property', text: `${this.config.getDisplayName(group.property as BasesPropertyId)}: ` });
				heading.createSpan({ text: group.label });
				heading.createSpan({ cls: 'bmg-count', text: ` (${group.count})` });
				if (opts.pro && opts.summaryProperty) heading.createSpan({ cls: 'bmg-summary', text: ` · ${opts.summaryMode === 'average' ? 'Average' : 'Sum'} ${this.config.getDisplayName(opts.summaryProperty as BasesPropertyId)}: ${group.summary === null ? 'no numbers' : String(Math.round(group.summary * 100) / 100)}` });
				const content = details.createDiv({ cls: 'bmg-content' });
				if (group.children.length) draw(content, group.children); else table(content, group.rows);
			}
		};
		if (groups.length) draw(this.root, groups); else table(this.root, [...entries.keys()]);
	}
	private row(body: HTMLElement, entry: BasesEntry, columns: BasesPropertyId[]): void {
		const row = body.createEl('tr', { cls: 'bmg-row' });
		const link = row.createEl('td').createEl('a', { text: entry.file.basename, cls: 'internal-link', href: entry.file.path });
		link.addEventListener('click', (event) => { event.preventDefault(); void this.app.workspace.openLinkText(entry.file.path, '', Keymap.isModEvent(event)); });
		for (const property of columns.filter((p) => p !== 'file.name')) row.createEl('td', { text: entry.getValue(property)?.toString() ?? '' });
	}
}
export function viewOptions(): BasesAllOptions[] {
	return [
		{ type: 'property', key: KEY.first, displayName: 'First property' },
		{ type: 'property', key: KEY.second, displayName: 'Then property' },
		{ type: 'toggle', key: KEY.split, displayName: 'Put list items in separate groups', default: false },
		{ type: 'property', key: KEY.third, displayName: 'Third property (Pro)' },
		{ type: 'property', key: KEY.number, displayName: 'Number property for summary (Pro)' },
		{ type: 'dropdown', key: KEY.mode, displayName: 'Summary (Pro)', default: 'sum', options: { sum: 'Sum', average: 'Average' } },
		{ type: 'toggle', key: KEY.remember, displayName: 'Remember collapsed groups (Pro)', default: false },
	];
}
