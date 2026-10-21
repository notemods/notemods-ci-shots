import { MarkdownRenderChild, Notice, normalizePath } from 'obsidian';
import type PocketMarkwhenPlugin from './main';
import { MARKDOWN_NAME, PRO_NAME, proLabel } from './labels';
import { isPro, onProChange } from './pro';
import { filterEvents, localDay, markdownList, parseTimeline, todayIndex, type TimelineEvent, type TimelineSource } from './timeline';
import type { TimelineFilter } from './settings';

export class TimelinePanel extends MarkdownRenderChild {
	filter: TimelineFilter = { from: '', to: '', tag: '' };
	private sources: TimelineSource[];
	private rows: HTMLElement;
	private status: HTMLElement;
	private fromInput: HTMLInputElement;
	private toInput: HTMLInputElement;
	private tagInput: HTMLInputElement;
	private proArea: HTMLElement;
	private visible: TimelineEvent[] = [];
	private rowEls: HTMLElement[] = [];
	private collapsed = new Set<string>();
	private revision = 0;
	constructor(el: HTMLElement, private plugin: PocketMarkwhenPlugin, private initialSources: TimelineSource[]) {
		super(el); this.sources = initialSources;
		el.addClass('pocket-markwhen');
		const tools = el.createDiv({ cls: 'pocket-markwhen-tools' });
		this.fromInput = this.dateInput(tools, 'From');
		this.toInput = this.dateInput(tools, 'To');
		const today = tools.createEl('button', { text: 'Today' });
		today.addEventListener('click', () => this.goToday());
		const clear = tools.createEl('button', { text: 'Clear filter' });
		clear.addEventListener('click', () => this.applyFilter({ from: '', to: '', tag: '' }));
		const tags = tools.createEl('label', { text: 'Tag' });
		this.tagInput = tags.createEl('input', { type: 'text', attr: { 'aria-label': 'Tag filter', placeholder: 'Tag name' } });
		this.tagInput.addEventListener('input', () => { this.filter.tag = this.tagInput.value; this.draw(); });
		this.status = el.createDiv({ cls: 'pocket-markwhen-status', attr: { role: 'status', 'aria-live': 'polite' } });
		this.proArea = el.createDiv({ cls: 'pocket-markwhen-pro' });
		this.rows = el.createDiv({ cls: 'pocket-markwhen-rows' });
		this.draw(); this.drawPro();
	}
	onload(): void {
		this.register(onProChange(() => {
			this.revision++;
			if (!isPro()) this.sources = this.initialSources;
			this.drawPro(); this.draw();
		}));
		const refresh = (path: string): void => {
			if (this.sources.length > this.initialSources.length && this.sources.some((s) => s.path === path)) void this.combine(this.sources.map((s) => s.path));
		};
		this.registerEvent(this.plugin.app.vault.on('modify', (file) => refresh(file.path)));
		this.registerEvent(this.plugin.app.vault.on('delete', (file) => refresh(file.path)));
		this.registerEvent(this.plugin.app.vault.on('rename', (_file, oldPath) => refresh(oldPath)));
	}
	onunload(): void { this.revision++; }
	private dateInput(parent: HTMLElement, name: string): HTMLInputElement {
		const label = parent.createEl('label', { text: name });
		const input = label.createEl('input', { type: 'date', attr: { 'aria-label': name } });
		input.addEventListener('change', () => {
			this.filter.from = this.fromInput.value; this.filter.to = this.toInput.value; this.draw();
		});
		return input;
	}
	applyFilter(filter: TimelineFilter): void {
		this.filter = { ...filter }; this.fromInput.value = filter.from; this.toInput.value = filter.to; this.tagInput.value = filter.tag; this.draw();
	}
	private draw(): void {
		this.rows.empty(); this.rowEls = []; this.visible = [];
		if (this.filter.from && this.filter.to && this.filter.from > this.filter.to) { this.status.setText('From must be on or before to.'); return; }
		for (const source of this.sources) {
			const doc = parseTimeline(source.source, source.path);
			if (doc.title) this.rows.createEl('h3', { text: doc.title, cls: 'pocket-markwhen-title' });
			if (doc.error) this.rows.createEl('p', { text: doc.error });
			const events = filterEvents(doc.events, this.filter);
			const groups = new Map<string, HTMLElement>();
			for (const e of events) {
				let parent = this.rows;
				for (let i = 0; i < e.groups.length; i++) {
					const key = JSON.stringify([source.path, e.groups.slice(0, i + 1)]);
					let group = groups.get(key);
					if (!group) {
						const details = parent.createEl('details', { cls: 'pocket-markwhen-group' });
						details.open = !this.collapsed.has(key);
						details.createEl('summary', { text: e.groups[i] });
						details.addEventListener('toggle', () => { if (details.open) this.collapsed.delete(key); else this.collapsed.add(key); });
						group = details.createDiv(); groups.set(key, group);
					}
					parent = group;
				}
				const row = parent.createEl('article', { cls: 'pocket-markwhen-event', attr: { tabindex: '0' } });
				row.createEl('time', { text: e.date });
				row.createDiv({ text: e.text, cls: 'pocket-markwhen-text' });
				const chips = row.createDiv({ cls: 'pocket-markwhen-tags' });
				for (const tag of e.tags) chips.createSpan({ text: tag, cls: 'pocket-markwhen-tag' });
				if (this.sources.length > 1) row.createDiv({ text: e.path, cls: 'pocket-markwhen-path' });
				this.visible.push(e); this.rowEls.push(row);
			}
		}
		this.status.setText(this.visible.length ? `${this.visible.length} dated ${this.visible.length === 1 ? 'event' : 'events'}` : 'No dated events');
	}
	goToday(today = localDay()): boolean {
		const i = todayIndex(this.visible, today);
		for (const row of this.rowEls) row.removeClass('pocket-markwhen-today');
		const row = this.rowEls[i];
		if (!row) { this.status.setText('No event starts on or after today in this filter.'); return false; }
		let parent = row.parentElement;
		while (parent && parent !== this.containerEl) { if (parent.instanceOf(HTMLDetailsElement)) parent.open = true; parent = parent.parentElement; }
		row.addClass('pocket-markwhen-today'); row.scrollIntoView({ block: 'center' }); row.focus({ preventScroll: true }); return true;
	}
	private requirePro(): boolean {
		if (isPro()) return true;
		new Notice(`This feature needs ${PRO_NAME}. Open the plugin settings to sign in with GitHub.`); return false;
	}
	async combine(paths: string[]): Promise<boolean> {
		if (!this.requirePro()) return false;
		const rev = ++this.revision;
		const sources: TimelineSource[] = [...this.initialSources];
		try {
			for (const path of new Set(paths)) {
				if (!path || sources.some((s) => s.path === path)) continue;
				const file = this.plugin.app.vault.getFileByPath(normalizePath(path));
				if (file?.extension === 'mw') sources.push({ path: file.path, source: await this.plugin.app.vault.read(file) });
			}
			if (rev !== this.revision || !isPro()) return false;
			this.sources = sources; this.draw(); return true;
		} catch { new Notice('Could not read a selected file.'); return false; }
	}
	async saveFilter(name: string): Promise<boolean> {
		if (!this.requirePro() || !name.trim()) return false;
		const clean = name.trim().slice(0, 80);
		this.plugin.settings.savedFilters = this.plugin.settings.savedFilters.filter((f) => f.name !== clean);
		this.plugin.settings.savedFilters.push({ name: clean, ...this.filter });
		await this.plugin.saveSettings(); this.drawPro(); return true;
	}
	async exportMarkdown(): Promise<string | null> {
		if (!this.requirePro()) return null;
		if (!this.visible.length) { new Notice('No dated events to export.'); return null; }
		let path = normalizePath(`Markwhen events ${localDay()}.md`);
		for (let n = 2; this.plugin.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`Markwhen events ${localDay()} ${n}.md`);
		const file = await this.plugin.app.vault.create(path, markdownList(this.visible));
		new Notice(`Saved ${file.path}`); return file.path;
	}
	private drawPro(): void {
		this.proArea.empty();
		const details = this.proArea.createEl('details');
		details.createEl('summary', { text: proLabel('Combine files, saved filters and export') });
		if (!isPro()) { details.createEl('p', { text: `The timeline, source editor, date filters and today are free. Sign in with GitHub in settings to use ${PRO_NAME}.` }); return; }
		const label = details.createEl('label', { text: 'Choose .mw files' });
		const select = label.createEl('select', { attr: { multiple: '', size: '4', 'aria-label': 'Files to combine' } });
		for (const file of this.plugin.app.vault.getFiles().filter((f) => f.extension === 'mw').sort((a, b) => a.path.localeCompare(b.path))) {
			const option = select.createEl('option', { text: file.path, value: file.path });
			option.selected = this.sources.some((s) => s.path === file.path);
		}
		const combine = details.createEl('button', { text: proLabel('Combine files') });
		combine.addEventListener('click', () => { void this.combine(Array.from(select.selectedOptions).map((o) => o.value)); });
		const name = details.createEl('input', { type: 'text', attr: { 'aria-label': 'Filter name', placeholder: 'Filter name' } });
		const save = details.createEl('button', { text: proLabel('Save filter') });
		save.addEventListener('click', () => { void this.saveFilter(name.value); });
		const saved = details.createEl('select', { attr: { 'aria-label': 'Saved filter' } });
		saved.createEl('option', { text: 'Load a saved filter', value: '' });
		for (const f of this.plugin.settings.savedFilters) saved.createEl('option', { text: f.name, value: f.name });
		saved.addEventListener('change', () => {
			if (!this.requirePro()) return;
			const f = this.plugin.settings.savedFilters.find((f) => f.name === saved.value);
			if (f) this.applyFilter(f);
		});
		const remove = details.createEl('button', { text: proLabel('Delete selected filter') });
		remove.addEventListener('click', () => {
			if (!this.requirePro()) return;
			this.plugin.settings.savedFilters = this.plugin.settings.savedFilters.filter((f) => f.name !== saved.value);
			void this.plugin.saveSettings(); this.drawPro();
		});
		const exp = details.createEl('button', { text: proLabel(`Export ${MARKDOWN_NAME} list`) });
		exp.addEventListener('click', () => { void this.exportMarkdown().catch(() => new Notice('Could not write the export file.')); });
	}
}
