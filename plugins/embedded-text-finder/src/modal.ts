import { Modal, Notice, type TFile } from 'obsidian';
import type EmbeddedTextFinderPlugin from './main';
import { isPro } from './pro';
import type { SearchResult } from './search';

export class FinderModal extends Modal {
	folder!: HTMLSelectElement;
	query!: HTMLInputElement;
	status!: HTMLElement;
	results!: HTMLElement;
	presets!: HTMLSelectElement;
	indexToggle!: HTMLInputElement;
	activeOnly!: HTMLInputElement;
	private searchButton!: HTMLButtonElement;
	private cancelButton!: HTMLButtonElement;
	private exportButton!: HTMLButtonElement;
	private presetName!: HTMLInputElement;
	private controller: AbortController | null = null;
	private last: SearchResult | null = null;
	private lastQuery = '';
	/** A file reference, so a rename while the window is open keeps the scope. */
	private activeNote: TFile | null = null;
	constructor(readonly finder: EmbeddedTextFinderPlugin, private readonly startActive = false) { super(finder.app); }
	onOpen(): void {
		this.finder.modals.add(this);
		this.setTitle('Embedded text finder');
		this.modalEl.addClass('embedded-text-finder');
		const el = this.contentEl;
		el.empty();
		el.createEl('p', { text: 'Find containing notes and source excerpts. Markdown embeds are followed to depth two.', cls: 'etf-intro' });
		const fields = el.createDiv({ cls: 'etf-fields' });
		const folderLabel = fields.createEl('label', { text: 'Containing folder' });
		this.folder = folderLabel.createEl('select', { cls: 'etf-folder' });
		this.folder.createEl('option', { text: 'Vault root (includes subfolders)', value: '' });
		const folders = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const parts = file.path.split('/'); parts.pop();
			while (parts.length) { folders.add(parts.join('/')); parts.pop(); }
		}
		for (const path of [...folders].sort()) this.folder.createEl('option', { text: path, value: path });
		this.folder.value = this.finder.settings.folder;
		if (this.folder.selectedIndex < 0) this.folder.value = '';
		const queryLabel = fields.createEl('label', { text: 'Literal text (case-sensitive)' });
		this.query = queryLabel.createEl('input', { type: 'text', cls: 'etf-query', value: this.finder.settings.query, placeholder: 'For example, blue bird' });
		this.query.addEventListener('keydown', (event) => { if (event.key === 'Enter') void this.run(); });
		const active = this.app.workspace.getActiveFile();
		this.activeNote = active && active.extension === 'md' ? active : null;
		const activeLabel = fields.createEl('label', { cls: 'etf-active-label' });
		this.activeOnly = activeLabel.createEl('input', { type: 'checkbox', cls: 'etf-active' });
		activeLabel.appendText(this.activeNote ? ` Only the active note and its embeds (${this.activeNote.path})` : ' Only the active note and its embeds (open a Markdown note first)');
		this.activeOnly.checked = this.startActive && this.activeNote !== null;
		this.activeOnly.disabled = this.activeNote === null;
		this.activeOnly.addEventListener('change', () => { this.syncScope(); if (!this.last && !this.controller) this.status.setText(this.readyText()); });
		const actions = el.createDiv({ cls: 'etf-actions' });
		this.searchButton = actions.createEl('button', { text: 'Search', cls: 'mod-cta etf-search' });
		this.searchButton.addEventListener('click', () => void this.run());
		this.cancelButton = actions.createEl('button', { text: 'Cancel search', cls: 'etf-cancel' });
		this.cancelButton.disabled = true;
		this.cancelButton.addEventListener('click', () => this.controller?.abort());
		this.exportButton = actions.createEl('button', { text: 'Export results (pro)', cls: 'etf-export' });
		this.exportButton.addEventListener('click', () => { if (this.last) void this.finder.export(this.last, this.lastQuery).catch(() => new Notice('Could not export results.')); });
		const pro = el.createEl('details', { cls: 'etf-pro' });
		pro.createEl('summary', { text: 'Presets and local index (pro)' });
		const indexLabel = pro.createEl('label', { cls: 'etf-index-label' });
		this.indexToggle = indexLabel.createEl('input', { type: 'checkbox', cls: 'etf-index' });
		indexLabel.appendText(' Keep an incremental local index');
		this.indexToggle.addEventListener('change', () => { void this.finder.setIndex(this.indexToggle.checked).then(() => this.updatePro()); });
		pro.createEl('p', { text: 'The index stays in memory. Changed source files are read again on the next search.' });
		this.presets = pro.createEl('select', { cls: 'etf-presets', attr: { 'aria-label': 'Saved searches' } });
		this.presets.addEventListener('change', () => {
			if (!isPro()) return;
			const preset = this.finder.settings.presets.find((p) => p.name === this.presets.value);
			if (preset) { this.folder.value = preset.folder; this.query.value = preset.query; this.presetName.value = preset.name; }
		});
		this.presetName = pro.createEl('input', { type: 'text', placeholder: 'Preset name', attr: { 'aria-label': 'Preset name' } });
		const save = pro.createEl('button', { text: 'Save preset', cls: 'etf-save' });
		save.addEventListener('click', () => { void this.finder.savePreset(this.presetName.value, this.folder.value, this.query.value).then(() => this.updatePro()); });
		const remove = pro.createEl('button', { text: 'Remove preset' });
		remove.addEventListener('click', () => { void this.finder.removePreset(this.presets.value).then(() => this.updatePro()); });
		this.status = el.createEl('p', { text: this.readyText(), cls: 'etf-status', attr: { role: 'status', 'aria-live': 'polite' } });
		this.results = el.createDiv({ cls: 'etf-results' });
		this.syncScope();
		this.updatePro();
		this.query.focus();
	}
	/** The folder list does not apply when a single note is the container. */
	private syncScope(): void { this.folder.disabled = this.activeOnly.checked; }
	private readyText(): string { return this.activeOnly.checked ? 'Ready. Enter text to search the active note.' : 'Ready. Choose a folder and enter text.'; }
	updatePro(): void {
		if (!this.presets) return;
		this.presets.empty();
		this.presets.createEl('option', { text: isPro() ? 'Choose a saved search' : 'Saved searches need Pro', value: '' });
		if (isPro()) for (const preset of this.finder.settings.presets) this.presets.createEl('option', { text: preset.name, value: preset.name });
		this.presets.disabled = !isPro();
		this.indexToggle.checked = isPro() && this.finder.settings.useIndex;
		this.indexToggle.disabled = !isPro() || this.controller !== null;
		this.exportButton.disabled = !isPro() || !this.last || this.controller !== null;
	}
	async run(): Promise<SearchResult | null> {
		if (this.controller) return null;
		const query = this.query.value;
		if (!query.trim()) { this.status.setText('Enter nonblank text to search.'); return null; }
		const controller = new AbortController(); this.controller = controller;
		this.last = null;
		this.results.empty(); this.status.setText('Searching…');
		this.searchButton.disabled = true; this.cancelButton.disabled = false;
		this.folder.disabled = true; this.activeOnly.disabled = true; this.query.disabled = true; this.updatePro();
		try {
			const folder = this.folder.value;
			this.finder.settings.folder = folder; this.finder.settings.query = query;
			await this.finder.saveSettings();
			const result = await this.finder.runSearch({ folder, query, note: this.activeOnly.checked && this.activeNote ? this.activeNote.path : undefined, cancelled: () => controller.signal.aborted, progress: (count) => this.status.setText(`Searching… ${count} containing notes checked.`) });
			if (!this.finder.modals.has(this)) return null;
			this.last = result; this.lastQuery = query;
			this.render(result);
			return result;
		} catch {
			if (this.finder.modals.has(this)) this.status.setText('Search failed. Check that the vault is available, then run again.');
			return null;
		} finally {
			this.controller = null;
			this.searchButton.disabled = false; this.cancelButton.disabled = true;
			this.activeOnly.disabled = this.activeNote === null; this.syncScope(); this.query.disabled = false; this.updatePro();
		}
	}
	private render(result: SearchResult): void {
		this.results.empty();
		this.status.setText(`${result.cancelled ? 'Cancelled. Partial results.' : 'Search complete.'} ${result.matches.length} matches · ${result.scanned} containing notes · ${result.diagnostics.length} source reports.`);
		if (!result.matches.length) this.results.createEl('p', { text: 'No matching source text found.' });
		let shown = 0;
		const list = this.results.createDiv();
		const more = this.results.createEl('button', { text: 'Show next 100 matches', cls: 'etf-more' });
		const page = () => {
			for (const match of result.matches.slice(shown, shown + 100)) {
				const row = list.createEl('article', { cls: 'etf-result' });
				row.createSpan( { text: match.depth ? `Embed depth ${match.depth}` : 'Note body', cls: 'etf-depth' });
				const container = row.createEl('button', { text: `Container: ${match.container}`, cls: 'etf-container' });
				container.addEventListener('click', () => { this.close(); void this.app.workspace.openLinkText(match.container, '', false); });
				const source = row.createEl('button', { text: `Source: ${match.source}${match.subpath}`, cls: 'etf-source' });
				source.addEventListener('click', () => { this.close(); void this.app.workspace.openLinkText(match.source + match.subpath, match.container, false); });
				row.createEl('p', { text: match.excerpt, cls: 'etf-excerpt' });
			}
			shown += 100; more.hidden = shown >= result.matches.length;
		};
		more.addEventListener('click', page); page();
		if (result.diagnostics.length) {
			const details = this.results.createEl('details', { cls: 'etf-reports' });
			details.createEl('summary', { text: `Source reports (${result.diagnostics.length})` });
			for (const report of result.diagnostics.slice(0, 100)) details.createEl('p', { text: `${report.reason}: ${report.target} — in ${report.container} via ${report.source}` });
			if (result.diagnostics.length > 100) details.createEl('p', { text: 'The first 100 reports are shown.' });
		}
	}
	onClose(): void { this.controller?.abort(); this.finder.modals.delete(this); this.contentEl.empty(); }
}
