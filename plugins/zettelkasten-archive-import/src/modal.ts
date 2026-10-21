import { Modal, Notice, Setting, TFile } from 'obsidian';
import { TEXT } from './copy';
import { MAX_ZIP } from './archive';
import type { CancelToken, ImportPlan } from './importer';
import { validateRules, type Rules } from './model';
import type { Archive } from './parser';
import { isPro } from './pro';
import type Zkn3ArchiveImportPlugin from './main';

export class ImportModal extends Modal {
	private archive: Archive | null;
	private earlier: Archive | null = null;
	private plan: ImportPlan | null = null;
	private rules: Rules;
	private folder: string;
	private busy = false;
	private token: CancelToken | null = null;
	private generation = 0;
	private disposed = false;
	private proActive = isPro();
	private status: HTMLElement | null = null;
	private preview: HTMLElement | null = null;
	private proControls: HTMLElement | null = null;
	private actions: HTMLElement | null = null;

	constructor(private readonly plugin: Zkn3ArchiveImportPlugin, archive?: Archive) {
		super(plugin.app);
		this.archive = archive ?? null;
		this.rules = plugin.activeRules();
		this.folder = plugin.settings.folder;
	}
	onOpen(): void {
		this.setTitle(TEXT.title);
		this.modalEl.addClass('zkn3-import-modal');
		this.contentEl.addClass('zkn3-import');
		this.contentEl.createEl('p', { text: TEXT.description });
		const picker = new Setting(this.contentEl).setName(TEXT.fileLabel).setDesc(TEXT.fileHelp);
		const input = picker.controlEl.createEl('input', { type: 'file', cls: 'zkn3-picker' });
		input.accept = '.zkn3,.zip';
		input.setAttribute('aria-label', TEXT.fileLabel);
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (file) void this.run(async () => {
				this.archive = null;
				this.invalidate();
				if (file.size > MAX_ZIP) throw new Error('The archive exceeds 20 MiB.');
				this.archive = this.plugin.readArchive(new Uint8Array(await file.arrayBuffer()));
				await this.refreshPreview();
			});
		});
		new Setting(this.contentEl).setName('Import folder').setDesc('The notes go directly into this folder.').addText((t) => t.setValue(this.folder).onChange((value) => { this.folder = value; this.invalidate(); }));
		this.proControls = this.contentEl.createDiv();
		this.status = this.contentEl.createDiv({ cls: 'zkn3-status', attr: { role: 'status', 'aria-live': 'polite' } });
		this.preview = this.contentEl.createDiv({ cls: 'zkn3-preview' });
		this.actions = this.contentEl.createDiv({ cls: 'zkn3-actions' });
		this.updatePro();
		if (this.archive) void this.run(() => this.refreshPreview());
	}
	private invalidate(): void {
		this.generation++;
		this.plan = null;
		this.preview?.empty();
		this.message(this.archive ? 'Select Preview to check the current folder and rules.' : 'Select a .zkn3 archive.');
		this.drawActions();
	}
	private message(text: string): void { this.status?.setText(text); }
	private setInputs(disabled: boolean): void {
		this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((input) => { input.disabled = disabled; });
	}
	private async run(action: () => Promise<void>): Promise<void> {
		if (this.busy || this.disposed) return;
		this.busy = true;
		this.drawActions();
		this.setInputs(true);
		try { await action(); } catch (e) { this.plan = null; this.preview?.empty(); this.message(e instanceof Error ? e.message : String(e)); }
		finally {
			this.busy = false;
			if (!this.disposed) { this.setInputs(false); this.updatePro(); }
		}
	}
	async refreshPreview(): Promise<void> {
		if (!this.archive) { this.message('Select a .zkn3 archive first.'); return; }
		const generation = ++this.generation;
		this.plan = null;
		this.message('Convert the notes in memory and prepare the preview…');
		const plan = await this.plugin.prepare(this.archive, this.folder, isPro() ? this.rules : undefined);
		if (this.disposed || generation !== this.generation) return;
		this.plan = plan;
		this.drawPreview(plan);
		this.message('Preview ready. Existing notes and file conflicts are skipped.');
		this.drawActions();
	}
	private drawPreview(plan: ImportPlan): void {
		const el = this.preview;
		if (!el) return;
		el.empty();
		const count = (status: string) => plan.notes.filter((n) => n.status === status).length;
		el.createEl('p', { cls: 'zkn3-counts', text: `${plan.archive.notes.length} live notes · ${plan.archive.deleted.length} deleted ${plan.archive.deleted.length === 1 ? 'slot' : 'slots'} · ${count('new')} new · ${count('existing')} existing · ${count('conflict')} file conflicts` });
		const table = el.createEl('table', { cls: 'zkn3-table' });
		const header = table.createEl('thead').createEl('tr');
		for (const name of ['Position', 'Title', 'Keywords', 'File']) header.createEl('th', { text: name });
		const body = table.createEl('tbody');
		plan.archive.notes.slice(0, 8).forEach((note, i) => {
			const row = body.createEl('tr');
			for (const value of [String(note.position), note.title || '—', note.keywords.join(', ') || '—', plan.notes[i]?.path ?? '']) row.createEl('td', { text: value });
		});
		if (plan.notes.length > 8) el.createEl('p', { text: `The table shows the first 8 of ${plan.notes.length} live notes.` });
		this.list(el, 'Missing link targets', plan.missing);
		this.list(el, 'Unsupported markup (kept as source text)', plan.unsupported);
		this.list(el, 'Source warnings', plan.archive.warnings);
		this.list(el, 'File conflicts', plan.notes.filter((n) => n.status === 'conflict').map((n) => n.path));
	}
	private list(el: HTMLElement, title: string, values: string[]): void {
		if (!values.length) return;
		const details = el.createEl('details', { cls: 'zkn3-list' });
		details.createEl('summary', { text: `${title} (${values.length})` });
		const list = details.createEl('ul');
		for (const value of values.slice(0, 30)) list.createEl('li', { text: value });
		if (values.length > 30) list.createEl('li', { text: `${values.length - 30} more items.` });
	}
	updatePro(): void {
		const el = this.proControls;
		if (!el || this.disposed) return;
		const pro = isPro();
		if (pro !== this.proActive) {
			this.proActive = pro;
			this.rules = this.plugin.activeRules();
			this.earlier = null;
			if (!this.token) this.invalidate();
		}
		el.empty();
		const off = !pro || this.busy;
		const details = el.createEl('details', { cls: 'zkn3-rules' });
		details.createEl('summary', { text: TEXT.rules });
		if (!pro) details.createEl('p', { cls: 'setting-item-description', text: 'Free imports use the position as the file name and the keywords property.' });
		new Setting(details).setName('File name').addDropdown((d) => d.addOption('number', 'Position').addOption('number-title', 'Position and title').setValue(this.rules.fileName).setDisabled(off).onChange((value) => { this.rules.fileName = value === 'number-title' ? 'number-title' : 'number'; this.invalidate(); }));
		new Setting(details).setName('Keyword property').addText((t) => t.setValue(this.rules.keywordProperty).setDisabled(off).onChange((value) => { this.rules.keywordProperty = value.trim(); this.invalidate(); }));
		new Setting(details).setName('Also add keywords as tags').setDesc('Spaces become hyphens. The exact values stay in the keyword property.').addToggle((t) => t.setValue(this.rules.keywordTags).setDisabled(off).onChange((value) => { this.rules.keywordTags = value; this.invalidate(); }));
		new Setting(details).setName(TEXT.saveRules).addButton((b) => b.setButtonText('Save rules').setDisabled(off).onClick(() => void this.run(async () => {
			validateRules(this.rules);
			if (await this.plugin.saveRules(this.rules)) new Notice('Import rules saved.');
		})));
		const compare = new Setting(el).setName(TEXT.compare).setDesc('Select the archive of your last import. The preview lists the notes that were added, changed and removed.');
		const input = compare.controlEl.createEl('input', { type: 'file', cls: 'zkn3-picker zkn3-earlier' });
		input.accept = '.zkn3,.zip';
		input.disabled = off || !this.archive;
		input.setAttribute('aria-label', TEXT.compare);
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (file) void this.run(async () => {
				if (file.size > MAX_ZIP) throw new Error('The archive exceeds 20 MiB.');
				this.earlier = this.plugin.readArchive(new Uint8Array(await file.arrayBuffer()));
				this.showComparison();
			});
		});
		this.drawActions();
	}
	/** Show the changes from the earlier archive to the selected archive. Nothing is written. */
	showComparison(earlier: Archive | null = this.earlier): void {
		if (!this.archive || !earlier) return;
		this.earlier = earlier;
		const c = this.plugin.compare(earlier, this.archive);
		this.message(`${c.added.length} added · ${c.changed.length} changed · ${c.removed.length} removed · ${c.unchanged.length} unchanged since the earlier archive.`);
		const el = this.preview;
		if (!el) return;
		if (this.plan) this.drawPreview(this.plan); else el.empty();
		const pos = (values: number[]) => values.map((n) => `Note ${n}`);
		this.list(el, 'Added notes', pos(c.added));
		this.list(el, 'Changed notes', pos(c.changed));
		this.list(el, 'Removed notes', pos(c.removed));
	}
	private drawActions(): void {
		const el = this.actions;
		if (!el || this.disposed) return;
		el.empty();
		const setting = new Setting(el);
		if (this.token) {
			setting.addButton((b) => b.setButtonText('Stop import').onClick(() => { if (this.token) this.token.cancelled = true; this.message('The import stops after the current batch.'); }));
			return;
		}
		setting.addButton((b) => b.setButtonText('Preview').setDisabled(this.busy || !this.archive).onClick(() => void this.run(() => this.refreshPreview())))
			.addButton((b) => b.setButtonText('Create notes').setCta().setDisabled(this.busy || !this.plan || !this.plan.notes.some((n) => n.status === 'new')).onClick(() => void this.run(async () => {
				const plan = this.plan;
				if (!plan) return;
				const token: CancelToken = { cancelled: false };
				this.token = token;
				this.drawActions();
				let result;
				try {
					result = await this.plugin.importPlan(plan, token, (done, total) => { this.message(`Writing notes: ${done} of ${total} checked.`); });
				} finally { this.token = null; }
				this.plan = null;
				if (this.disposed) return;
				this.preview?.empty();
				const stop = result.cancelled ? ` Stopped by you: ${result.remaining} notes not checked.` : '';
				this.message(`Import ${result.cancelled ? 'stopped' : 'complete'}: ${result.created} notes created, ${result.skipped} skipped, ${result.errors.length} errors.${stop}`);
				if (this.preview) {
					this.list(this.preview, 'Import errors', result.errors);
					this.list(this.preview, 'Missing link targets', plan.missing);
					this.list(this.preview, 'Unsupported markup (kept as source text)', plan.unsupported);
				}
				const first = plan.notes.find((n) => n.status === 'new' && this.app.vault.getAbstractFileByPath(n.path) instanceof TFile);
				if (first) new Setting(this.preview ?? this.contentEl).setName('Read the imported notes').addButton((b) => b.setButtonText('Open first note').onClick(async () => {
					const f = this.app.vault.getAbstractFileByPath(first.path);
					if (f instanceof TFile) { await this.app.workspace.getLeaf(false).openFile(f); this.close(); }
				}));
				this.plugin.settings.folder = plan.folder;
				await this.plugin.saveSettings();
			})));
	}
	onClose(): void {
		this.disposed = true;
		this.generation++;
		if (this.token) this.token.cancelled = true;
		this.contentEl.empty();
		this.archive = null;
		this.earlier = null;
		this.plan = null;
		this.plugin.closed(this);
	}
}
