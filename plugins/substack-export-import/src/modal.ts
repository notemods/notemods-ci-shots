import { Modal, Notice, Setting } from 'obsidian';
import type SubstackExportImportPlugin from './main';
import { DEFAULT_MAPPING, FIELDS, makeReport, validateMapping, type Change, type Mapping, type Preview } from './importer';
import { PRO_UI, isPro, onProChange } from './pro';

export class ImportModal extends Modal {
	folder = 'Substack import';
	mapping: Mapping = { ...DEFAULT_MAPPING };
	preview: Preview | null = null;
	private bytes: Uint8Array | null = null;
	private resultEl!: HTMLElement;
	private stop: (() => void) | null = null;
	private fileSelectionGeneration = 0;
	private importClosed = false;
	private importBusy = false;
	constructor(readonly owner: SubstackExportImportPlugin) { super(owner.app); }
	onOpen(): void {
		this.importClosed = false;
		this.setTitle('Substack writer export');
		this.modalEl.addClass('substack-import-modal');
		this.draw();
		this.stop = onProChange(() => { if (!this.importClosed) this.draw(); });
	}
	onClose(): void { this.owner.activeImports.delete(this); this.importClosed = true; this.fileSelectionGeneration++; this.stop?.(); this.stop = null; this.contentEl.empty(); }
	private draw(): void {
		const el = this.contentEl; el.empty();
		el.createEl('p', { text: 'Choose one local ZIP with posts.csv and posts/<post_id>.html. Subscriber files are ignored.' });
		const fileRow = new Setting(el).setName('Writer export zip').setDesc('The zip stays on this device. Limit: 30 MiB.');
		const input = fileRow.controlEl.createEl('input', { attr: { type: 'file', accept: '.zip,application/zip', 'aria-label': 'Writer export zip' } });
		input.disabled = this.importBusy;
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) return;
			const selected = ++this.fileSelectionGeneration;
			this.preview = null; this.bytes = null;
			void this.readFile(file, selected);
		});
		new Setting(el).setName('New output folder').setDesc('Use a new folder. A parent folder must exist.').addText((text) => text.setValue(this.folder).setDisabled(this.importBusy).onChange((value) => { this.folder = value; }));
		const details = el.createEl('details');
		details.createEl('summary', { text: 'Property names for this import' });
		for (const field of FIELDS) new Setting(details).setName(field).addText((text) => text.setValue(this.mapping[field]).setDisabled(this.importBusy).onChange((value) => { this.mapping[field] = value; this.preview = null; this.resultEl.empty(); }));
		new Setting(el).setName('Preview').setDesc('Read the matched and unmatched counts before you create notes.').addButton((b) => b.setButtonText('Preview export').setDisabled(!this.bytes || this.importBusy).onClick(() => {
			try { if (this.bytes) { this.owner.checkFolder(this.folder); this.preview = this.owner.prepare(this.bytes, this.mapping); this.draw(); } }
			catch (e) { this.preview = null; this.showError(e); }
		}));
		this.resultEl = el.createDiv({ cls: 'substack-import-result' });
		if (this.preview) this.showPreview();
		this.profileControls(el);
		this.comparisonControls(el);
	}
	private async readFile(file: File, selected: number): Promise<void> {
		try {
			if (file.size > 30 * 1024 * 1024) throw new Error('The ZIP is larger than 30 MiB.');
			const bytes = new Uint8Array(await file.arrayBuffer());
			if (this.importClosed || selected !== this.fileSelectionGeneration) return;
			this.bytes = bytes;
			this.owner.checkFolder(this.folder);
			this.preview = this.owner.prepare(bytes, this.mapping);
			this.draw();
		} catch (e) { if (!this.importClosed && selected === this.fileSelectionGeneration) { this.draw(); this.showError(e); } }
	}
	/** Uses the same archive reader as file selection. QA can pass a local fixture. */
	loadBytes(bytes: Uint8Array): void {
		this.fileSelectionGeneration++;
		this.preview = null; this.bytes = bytes;
		try { this.owner.checkFolder(this.folder); this.preview = this.owner.prepare(bytes, this.mapping); this.draw(); }
		catch (e) { this.draw(); this.showError(e); }
	}
	private showPreview(): void {
		const el = this.resultEl; el.empty();
		const preview = this.preview; if (!preview) return;
		new Setting(el).setName('Import preview').setHeading();
		el.createEl('p', { text: `Matched rows: ${preview.posts.length} · Unmatched rows: ${preview.missing.length} · HTML files with no CSV row: ${preview.unmatched.length}`, cls: 'substack-import-counts' });
		const list = el.createEl('ul');
		for (const post of preview.posts.slice(0, 12)) list.createEl('li', { text: `${post.id} — ${String(post.properties[this.mapping.title] ?? '')} (${String(post.properties[this.mapping.type] ?? '')})` });
		if (preview.posts.length > 12) el.createEl('p', { text: `Showing 12 of ${preview.posts.length} matched rows.` });
		const details = el.createEl('details');
		details.createEl('summary', { text: 'Read the import report' });
		details.createEl('pre', { text: makeReport(preview) });
		new Setting(el).setName('Create notes').setDesc('Create the notes, report and local snapshot in the new folder.').addButton((b) => b.setButtonText('Create import folder').setCta().setDisabled(this.importBusy).onClick(async () => {
			if (this.importBusy) return;
			this.importBusy = true; b.setDisabled(true);
			try { await this.owner.writeImport(preview, this.folder); this.close(); }
			catch (e) { this.showError(e); }
			finally { this.importBusy = false; b.setDisabled(false); }
		}));
	}
	private profileControls(el: HTMLElement): void {
		new Setting(el).setName(PRO_UI.profileHeading).setHeading();
		let name = '';
		new Setting(el).setName('Profile name').addText((t) => t.setPlaceholder('Publication archive').onChange((v) => { name = v; })).addButton((b) => b.setButtonText('Save profile').setDisabled(!isPro() || this.importBusy).onClick(async () => {
			try { validateMapping(this.mapping); await this.owner.saveProfile({ name, folder: this.folder, mapping: this.mapping }); new Notice('Saved the local profile.'); this.draw(); }
			catch (e) { this.showError(e); }
		}));
		let chosen = this.owner.settings.profiles[0]?.name ?? '';
		new Setting(el).setName('Saved profile').addDropdown((d) => {
			if (!chosen) d.addOption('', 'No saved profiles');
			for (const p of this.owner.settings.profiles) d.addOption(p.name, p.name);
			d.setValue(chosen).setDisabled(!isPro() || this.importBusy).onChange((value) => { chosen = value; });
		}).addButton((b) => b.setButtonText('Load profile').setDisabled(!isPro() || !chosen || this.importBusy).onClick(() => {
			try { const p = this.owner.loadProfile(chosen); this.folder = p.folder; this.mapping = p.mapping; this.preview = null; this.draw(); }
			catch (e) { this.showError(e); }
		}));
	}
	private comparisonControls(el: HTMLElement): void {
		new Setting(el).setName(PRO_UI.comparisonHeading).setHeading();
		let previous = '';
		new Setting(el).setName('Previous import folder').setDesc('Read the local snapshot in this folder. Existing notes are not changed.').addText((t) => t.setPlaceholder('Previous export').onChange((v) => { previous = v; })).addButton((b) => b.setButtonText('Compare bodies').setDisabled(!isPro() || !this.preview || this.importBusy).onClick(async () => {
			try {
				if (!isPro()) throw new Error('Body comparison needs Pro.');
				const preview = this.preview; if (!preview) throw new Error('Preview an export first.');
				const changes = await this.owner.compareImport(previous, preview);
				if (!isPro() || this.importClosed) return;
				this.showChanges(changes, changesEl);
			} catch (e) { this.showError(e); }
		}));
		const changesEl = el.createDiv({ cls: 'substack-import-changes' });
	}
	showChanges(changes: Change[], el: HTMLElement): void {
		el.empty();
		el.createEl('p', { text: ['changed', 'added', 'removed', 'same'].map((s) => `${s}: ${changes.filter((c) => c.status === s).length}`).join(' · ') });
		for (const change of changes.filter((c) => c.status !== 'same')) {
			const details = el.createEl('details'); details.createEl('summary', { text: `${change.id}: ${change.status}` });
			const grid = details.createDiv({ cls: 'substack-import-diff' });
			for (const [label, body] of [['Previous body', change.before], ['New body', change.after]]) {
				const part = grid.createDiv(); part.createEl('p', { text: label ?? '' }); part.createEl('pre', { text: body ?? '' });
			}
		}
	}
	private showError(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.resultEl.createEl('p', { text: message, cls: 'substack-import-error' });
		new Notice(message);
	}
}
