import { BasesView, BooleanValue, DateValue, StringValue, NullValue, NumberValue, Keymap, type App, type BasesAllOptions, type BasesEntry, type BasesPropertyId, type QueryController, type Value } from 'obsidian';
import { buildGroups, type Cell, type Group, type GroupOptions, type Row } from './group';
import { patchChildren } from './dom';
import { isPro, onProChange } from './pro';

export const VIEW_ID = 'bases-date-hierarchy';
export const KEY = { date: 'dateHierarchyDate', period: 'dateHierarchyPeriod', newest: 'dateHierarchyNewest', number: 'dateHierarchyNumber', mode: 'dateHierarchyMode', remember: 'dateHierarchyRemember', collapsed: 'dateHierarchyCollapsed' } as const;
export function plain(value: Value | null): Cell {
 if (value === null || value instanceof NullValue) return null;
 if (value instanceof DateValue) return value.dateOnly().toString();
 if (value instanceof NumberValue) { const n = Number(value.toString()); return Number.isFinite(n) ? n : null; }
 if (value instanceof BooleanValue) return value.isTruthy();
 if (value instanceof StringValue) return value.toString();
 return null;
}
/** Preserve raw note date text before Bases can normalize an impossible calendar day. */
export function dateCell(app: App, entry: BasesEntry, property: BasesPropertyId): Cell {
 if (property.startsWith('note.')) {
  const raw: unknown = app.metadataCache.getFileCache(entry.file)?.frontmatter?.[property.slice(5)];
  if (typeof raw === 'string') return raw;
 }
 return plain(entry.getValue(property));
}
export class DateHierarchyView extends BasesView {
	type = VIEW_ID;
	readonly root: HTMLElement;
	private collapsed = new Set<string>();
	private stateMode: boolean | null = null;
	private persistTimer: number | null = null;
	private groups: Group[] = [];
	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.root = containerEl.createDiv({ cls: 'bases-date-hierarchy', attr: { role: 'region' } });
	}
	onload(): void {
		this.register(() => { if (this.persistTimer !== null) window.clearTimeout(this.persistTimer); });
		this.registerDomEvent(this.root, 'click', (event) => this.click(event));
		this.registerDomEvent(this.root, 'auxclick', (event) => this.click(event));
		this.registerDomEvent(this.root, 'mouseover', (event) => {
			const link = event.target instanceof Element ? event.target.closest<HTMLElement>('a.internal-link') : null;
			if (link) this.app.workspace.trigger('hover-link', { event, source: VIEW_ID, hoverParent: this, targetEl: link, linktext: link.dataset.href ?? link.getAttribute('href'), sourcePath: '' });
		});
		this.register(onProChange(() => this.render()));
		this.registerDomEvent(this.root, 'toggle', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLDetailsElement) || !target.dataset.group) return;
			const key = target.dataset.group;
			const was = this.collapsed.has(key);
			if (was === !target.open) return;
			if (target.open) this.collapsed.delete(key); else this.collapsed.add(key);
			this.applyDayFolds();
			this.persist();
		}, { capture: true });
	}
	onunload(): void { this.root.empty(); }
	onDataUpdated(): void { this.render(); }
 private click(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLElement>('[data-action]');
  if (button && event.type === 'click') {
   this.collapsed = button.dataset.action === 'collapse' ? new Set(this.groups.map((g) => g.key)) : new Set();
   this.persist(); this.render(); return;
  }
  const link = target?.closest<HTMLAnchorElement>('a.internal-link');
  if (!link || (event.type === 'auxclick' && event.button !== 1)) return;
  const path = link.dataset.href ?? link.getAttribute('href');
  if (!path) return;
  event.preventDefault();
  void this.app.workspace.openLinkText(path, '', event.button === 1 ? 'tab' : Keymap.isModEvent(event));
 }
 private applyDayFolds(): void {
  for (const row of Array.from(this.root.querySelectorAll<HTMLElement>('[data-day]'))) row.hidden = this.collapsed.has(row.dataset.day ?? '');
 }
 private persist(): void {
  if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
  if (!isPro() || this.config.get(KEY.remember) !== true) return;
  this.persistTimer = window.setTimeout(() => {
   this.persistTimer = null;
   const keys: string[] = [];
   const visit = (groups: Group[]) => { for (const group of groups) { if (this.collapsed.has(group.key)) keys.push(group.key); else visit(group.children); } };
   visit(this.groups);
   if (JSON.stringify(this.config.get(KEY.collapsed)) !== JSON.stringify(keys)) this.config.set(KEY.collapsed, keys);
  }, 300);
 }
	options(): GroupOptions {
  return { property: this.config.getAsPropertyId(KEY.date) ?? '', pro: isPro(), period: this.config.get(KEY.period) === 'iso-week' ? 'iso-week' : 'month', newestFirst: this.config.get(KEY.newest) !== false, summaryProperty: this.config.getAsPropertyId(KEY.number) ?? undefined, summaryMode: this.config.get(KEY.mode) === 'average' ? 'average' : 'sum' };
	}
	render(): void {
		if (!(this.data as BasesView['data'] | undefined)) return;
		this.root.setAttribute('aria-label', this.config.name);
		const opts = this.options();
		const remember = opts.pro && this.config.get(KEY.remember) === true;
		if (this.stateMode !== remember) { this.collapsed.clear(); this.stateMode = remember; }
		if (remember && this.persistTimer === null) {
			const saved = this.config.get(KEY.collapsed);
			this.collapsed = new Set(Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : []);
		}
		const output = createDiv();
		const scroll = this.root.scrollTop;
		const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement : null;
		const properties = opts.property ? [opts.property] : [];
		const entries = new Map(this.data.data.map((entry) => [entry.file.path, entry]));
		const rows: Row[] = this.data.data.map((entry) => {
			const values: Record<string, Cell> = {};
			for (const property of [...properties, ...(opts.summaryProperty ? [opts.summaryProperty] : [])]) values[property] = property === opts.property ? dateCell(this.app, entry, property as BasesPropertyId) : plain(entry.getValue(property as BasesPropertyId));
			return { id: entry.file.path, values };
		});
		const groups = buildGroups(rows, opts);
		this.groups = groups;
		const bar = output.createDiv({ cls: 'bdh-bar' });
		bar.createSpan({ text: `${entries.size} ${entries.size === 1 ? 'note' : 'notes'} · ${opts.period === 'iso-week' ? 'Year / ISO week / Day' : 'Year / Month / Day'}` });
		const collapse = bar.createEl('button', { text: 'Collapse all' });
		const expand = bar.createEl('button', { text: 'Expand all' });
  collapse.dataset.action = 'collapse'; expand.dataset.action = 'expand';
  const finish = () => { patchChildren(this.root, output); this.applyDayFolds(); if (focused && this.root.contains(focused)) focused.focus({ preventScroll: true }); this.root.scrollTop = scroll; };
  if (!rows.length) { output.createDiv({ cls: 'bdh-empty', text: 'No notes match this base. Change its filters to see groups.' }); finish(); return; }
  if (!properties.length) output.createDiv({ cls: 'bdh-empty', text: 'Choose a date property in the view options to make Year / Month / Day groups.' });
		const configured = this.config.getOrder();
		const columns: BasesPropertyId[] = configured.length ? configured : ['file.name'];
		const table = (parent: HTMLElement, ids: string[], days: Group[] = []) => {
			const el = parent.createEl('table', { cls: 'bdh-table' });
			const head = el.createEl('thead').createEl('tr');
			head.createEl('th', { text: 'Note', attr: { scope: 'col' } });
			for (const p of columns.filter((p) => p !== 'file.name')) head.createEl('th', { text: this.config.getDisplayName(p), attr: { scope: 'col' } });
			const body = el.createEl('tbody');
   if (days.length) for (const day of days) {
    const header = body.createEl('tr'); header.dataset.node = day.key;
    const cell = header.createEl('th', { attr: { colspan: String(columns.filter((p) => p !== 'file.name').length + 1) } });
    const details = cell.createEl('details', { cls: 'bdh-group bdh-day' }); details.dataset.group = day.key; details.open = !this.collapsed.has(day.key);
    const heading = details.createEl('summary', { text: `${day.label} (${day.count})` });
    if (opts.pro && opts.summaryProperty) heading.appendText(` · ${opts.summaryMode === 'average' ? 'Average' : 'Sum'}: ${day.summary ?? 'no numbers'}`);
    for (const id of day.rows) { const entry = entries.get(id); if (entry) { const row = this.row(body, entry, columns); row.dataset.day = day.key; } }
   } else for (const id of ids) { const entry = entries.get(id); if (entry) this.row(body, entry, columns); }
		};
		const draw = (parent: HTMLElement, items: Group[]) => {
			for (const group of items) {
				const details = parent.createEl('details', { cls: 'bdh-group' });
				details.dataset.group = group.key;
				details.open = !this.collapsed.has(group.key);
				const heading = details.createEl('summary');
				heading.createSpan({ cls: 'bdh-property', text: `${this.config.getDisplayName(group.property as BasesPropertyId)}: ` });
				heading.createSpan({ text: group.label });
				heading.createSpan({ cls: 'bdh-count', text: ` (${group.count})` });
				if (opts.pro && opts.summaryProperty) heading.createSpan({ cls: 'bdh-summary', text: ` · ${opts.summaryMode === 'average' ? 'Average' : 'Sum'} ${this.config.getDisplayName(opts.summaryProperty as BasesPropertyId)}: ${group.summary === null ? 'no numbers' : String(Math.round(group.summary * 100) / 100)}` });
				const content = details.createDiv({ cls: 'bdh-content' });
				if (group.children.length && group.children[0]?.children.length) draw(content, group.children);
				else table(content, group.rows, group.children);
			}
		};
		if (groups.length) draw(output, groups); else table(output, [...entries.keys()]);
		finish();
	}
	private row(body: HTMLElement, entry: BasesEntry, columns: BasesPropertyId[]): HTMLElement {
		const row = body.createEl('tr', { cls: 'bdh-row' });
		row.dataset.node = entry.file.path;
		const link = row.createEl('td').createEl('a', { text: entry.file.basename, cls: 'internal-link', href: entry.file.path });
  link.dataset.href = entry.file.path;
  for (const property of columns.filter((p) => p !== 'file.name')) entry.getValue(property)?.renderTo(row.createEl('td'), this.app.renderContext);
  return row;
	}
}
export function viewOptions(): BasesAllOptions[] {
 return [
  { type: 'property', key: KEY.date, displayName: 'Date property' },
  { type: 'toggle', key: KEY.newest, displayName: 'Newest first', default: true },
  { type: 'dropdown', key: KEY.period, displayName: 'Middle level', default: 'month', options: { month: 'Month', 'iso-week': 'ISO week' } },
  { type: 'property', key: KEY.number, displayName: 'Number property for summary (Pro)' },
  { type: 'dropdown', key: KEY.mode, displayName: 'Summary (Pro)', default: 'sum', options: { sum: 'Sum', average: 'Average' } },
  { type: 'toggle', key: KEY.remember, displayName: 'Remember collapsed groups (Pro)', default: false },
 ];
}
