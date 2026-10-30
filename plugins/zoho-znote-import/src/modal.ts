import { UI } from './copy';
import { Modal, Notice, Setting } from 'obsidian';
import { isPro } from './pro';
import { readExport, type Profile } from './importer';
import type ZohoZnoteImportPlugin from './main';

function stringMap(text: string): Record<string, string> {
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) throw new Error('Use a JSON object with string values.');
	return value as Record<string, string>;
}
export class ImportModal extends Modal {
	private bytes: Uint8Array | null = null;
	private folder: string;
	private baseline = 'Zoho import';
	private profileName = '';
	private notebookJson = '{}';
	private fieldsJson = '{}';
	private useProfile = false;
	private reading = false;
	private fileSelectionGeneration = 0;
	private status!: HTMLParagraphElement;
	constructor(private plugin: ZohoZnoteImportPlugin, private review: boolean) {
		super(plugin.app); this.folder = review ? 'Zoho review' : 'Zoho import';
	}
	onOpen(): void {
		this.setTitle(this.review ? UI.compareCommand : 'Import a Zoho native export');
		this.contentEl.addClass('zoho-import-dialog');
		this.contentEl.createEl('p', { text: UI.intro });
		const file = this.contentEl.createEl('input', { type: 'file', attr: { accept: '.zip', 'aria-label': UI.picker } });
		file.addEventListener('change', () => {
			const selected = file.files?.[0];
			if (selected) void this.selectFile(selected);
		});
		new Setting(this.contentEl).setName('New output folder').setDesc('The folder must not exist.').addText(t => t.setValue(this.folder).onChange(v => { this.folder = v; }));
		if (this.review) new Setting(this.contentEl).setName('Baseline import folder').setDesc('Read Card index.json from this folder.').addText(t => t.setValue(this.baseline).onChange(v => { this.baseline = v; }));
		new Setting(this.contentEl).setName(UI.profiles).setDesc('Save notebook folder names and YAML field names on this device.').setHeading();
		new Setting(this.contentEl).setName('Saved profile').addDropdown(d => {
			d.addOption('', 'Default fields and notebook names');
			for (const p of this.plugin.settings.profiles) d.addOption(p.name, p.name);
			d.setDisabled(!isPro()).onChange(v => {
				const p = this.plugin.settings.profiles.find(p => p.name === v);
				this.useProfile = !!p;
				if (p) { this.profileName = p.name; this.notebookJson = JSON.stringify(p.notebookFolders); this.fieldsJson = JSON.stringify(p.fields); }
				this.renderMapping(mapping);
			});
		});
		const mapping = this.contentEl.createDiv(); this.renderMapping(mapping);
		this.status = this.contentEl.createEl('p', { cls: 'zoho-import-status', text: UI.noZip });
		new Setting(this.contentEl).addButton(b => b.setButtonText(this.review ? 'Create review folder' : 'Import cards').setCta().onClick(async () => {
			if (!this.bytes || this.reading) { new Notice(UI.selectZip); return; }
			b.setDisabled(true);
			try {
				const profile = this.useProfile ? this.profile() : null;
				const result = await this.plugin.importBytes(this.bytes, this.folder, profile, this.review ? this.baseline : undefined);
				this.status.textContent = `Import complete. ${result.notes} notes, ${result.assets} assets, ${result.warnings.length} warnings. Report: ${result.report}`;
				new Notice(`Created ${result.notes} notes. Read ${result.report}.`);
			} catch (e) { this.status.textContent = `Import stopped. ${e instanceof Error ? e.message : String(e)} If files were created, use a new output folder for the next attempt.`; }
			finally { b.setDisabled(false); }
		}));
	}
	private renderMapping(el: HTMLElement): void {
		el.empty();
		new Setting(el).setName('Profile name').addText(t => t.setValue(this.profileName).setDisabled(!isPro()).onChange(v => { this.profileName = v; }));
		new Setting(el).setName('Notebook folders').setDesc('JSON object, for example {"My Notebook":"Projects"}. One folder name per notebook.').addTextArea(t => t.setValue(this.notebookJson).setDisabled(!isPro()).onChange(v => { this.notebookJson = v; this.useProfile = true; }));
		new Setting(el).setName('Field names').setDesc('JSON object, for example {"color":"card_color"}. Sources: title, created, modified, color, tags, notebook.').addTextArea(t => t.setValue(this.fieldsJson).setDisabled(!isPro()).onChange(v => { this.fieldsJson = v; this.useProfile = true; }));
		new Setting(el).addButton(b => b.setButtonText(UI.saveProfile).setDisabled(!isPro()).onClick(async () => {
			try { await this.plugin.saveProfile(this.profile()); this.useProfile = true; new Notice('Profile saved. Reopen the dialog to select it.'); }
			catch (e) { new Notice(e instanceof Error ? e.message : String(e)); }
		}));
	}
	private profile(): Profile { return { name: this.profileName, notebookFolders: stringMap(this.notebookJson), fields: stringMap(this.fieldsJson) }; }
	async selectFile(file: File): Promise<void> {
		const selection = ++this.fileSelectionGeneration;
		this.bytes = null; this.reading = true;
		try {
			if (file.size > 64 * 1024 * 1024) throw new Error('ZIP exceeds 64 MiB.');
			const bytes = new Uint8Array(await file.arrayBuffer());
			if (selection !== this.fileSelectionGeneration) return;
			const archive = readExport(bytes); this.bytes = bytes;
			this.status.textContent = `${file.name}: ${archive.cardCount} cards, ${archive.notebookCount} notebooks, ${archive.resourceCount} resource members. ${archive.cards.length} supported cards; ${archive.warnings.length} warnings. Read the report after import.`;
		} catch (e) { if (selection === this.fileSelectionGeneration) this.status.textContent = `Cannot read ZIP. ${e instanceof Error ? e.message : String(e)}`; }
		finally { if (selection === this.fileSelectionGeneration) this.reading = false; }
	}
	onClose(): void { this.fileSelectionGeneration++; this.bytes = null; this.contentEl.empty(); }
}
