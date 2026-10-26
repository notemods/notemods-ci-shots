import { Modal, Setting, type ButtonComponent } from 'obsidian';
import { ZIM_RULES, type ZimRules, type compareZimSources } from './core/index';
import { isPro } from './pro';
import type ZimNotebookImportPlugin from './main';
import type { PreparedImport } from './main';
export class ImportModal extends Modal {
	source = '';
	destination = 'Zim import';
	rules: ZimRules = { ...ZIM_RULES };
	prepared: PreparedImport | null = null;
	private results: HTMLElement | null = null;
	private importButton: ButtonComponent | null = null;
	private generation = 0;
	constructor(readonly importer: ZimNotebookImportPlugin, private readonly onClosed: () => void = () => {}) {
		super(importer.app);
		const saved = isPro() ? importer.settings.saved : null;
		if (saved) { this.source = saved.source; this.destination = saved.destination; this.rules = { ...saved.rules }; }
	}
	onOpen(): void {
		this.setTitle('Zim page import');
		this.contentEl.addClass('zim-import');
		this.contentEl.createEl('p', { text: 'Choose a source folder in this vault. Review the plan, then write to a new folder. Source files stay in place.' });
		new Setting(this.contentEl).setName('Source folder').setDesc('Folder of Zim .txt pages already in this vault.').addText((t) => {
			t.inputEl.setAttribute('aria-label', 'Source folder');
			t.setValue(this.source).setPlaceholder('Zim source').onChange((v) => { this.source = v; this.invalidate(); });
		});
		new Setting(this.contentEl).setName('New destination folder').addText((t) => {
			t.inputEl.setAttribute('aria-label', 'New destination folder');
			t.setValue(this.destination).onChange((v) => { this.destination = v; this.invalidate(); });
		});
		new Setting(this.contentEl).setName('Folders').addDropdown((d) => d.addOptions({ tree: 'Keep the page tree', flat: 'One folder' }).setValue(this.rules.folders).onChange((v) => { this.rules.folders = v === 'flat' ? 'flat' : 'tree'; this.invalidate(); }));
		new Setting(this.contentEl).setName('Page names').addDropdown((d) => d.addOptions({ spaces: 'Keep spaces', hyphens: 'Use hyphens for spaces' }).setValue(this.rules.names).onChange((v) => { this.rules.names = v === 'hyphens' ? 'hyphens' : 'spaces'; this.invalidate(); }));
		new Setting(this.contentEl).setName('Saved rules (pro)').setDesc('Save this source, destination and naming rule for the next session.').addButton((b) => b.setButtonText('Save rules').onClick(async () => {
			try { if (await this.importer.saveRules(this.source.trim(), this.destination.trim(), this.rules)) this.message('Import rules saved.'); }
			catch (error) { this.message(String(error)); }
		}));
		new Setting(this.contentEl).setName('Import plan').addButton((b) => b.setButtonText('Review plan').onClick(async () => {
			b.setDisabled(true); await this.review(); b.setDisabled(false);
		})).addButton((b) => {
			this.importButton = b; b.setButtonText('Write new notes').setCta().setDisabled(true).onClick(async () => {
				b.setDisabled(true);
				if (!this.prepared) return;
				try { const result = await this.importer.writeImport(this.prepared); this.message(`Created ${result.created} notes. Report: ${result.report}`); this.prepared = null; }
				catch (error) { this.message(String(error)); }
			});
		});
		this.results = this.contentEl.createDiv({ cls: 'zim-import-results', attr: { 'aria-live': 'polite' } });
	}
	private invalidate(): void { this.generation++; this.prepared = null; this.importButton?.setDisabled(true); this.message('The inputs changed. Review the plan again.'); }
	private message(text: string): void { this.results?.empty(); this.results?.createEl('p', { text }); }
	async review(): Promise<void> {
		const generation = ++this.generation;
		this.prepared = null; this.importButton?.setDisabled(true);
		try {
			const prepared = await this.importer.prepare(this.source, this.destination, { ...this.rules });
			if (generation !== this.generation) return;
			this.prepared = prepared; const plan = prepared.plan;
			this.message(`${plan.notes.length} planned notes · ${plan.issues.filter((i) => i.kind === 'link').length} unresolved links · ${plan.issues.filter((i) => i.kind !== 'link').length} unsupported sections · ${plan.conflicts.length} conflicts`);
			for (const conflict of plan.conflicts) this.results?.createEl('p', { text: conflict, cls: 'zim-import-conflict' });
			const list = this.results?.createEl('ul');
			for (const note of plan.notes) list?.createEl('li', { text: `${note.source} → ${note.path}` });
			for (const issue of plan.issues) this.results?.createEl('p', { text: `${issue.source}:${issue.line} · ${issue.kind} · ${issue.detail}` });
			if (plan.notes[0]) {
				this.results?.createEl('p', { text: 'First note preview' });
				this.results?.createEl('pre', { text: plan.notes[0].body, cls: 'zim-import-preview' });
			}
			this.importButton?.setDisabled(plan.conflicts.length > 0 || plan.notes.length === 0);
		} catch (error) { if (generation === this.generation) this.message(String(error)); }
	}
	showChanges(changes: ReturnType<typeof compareZimSources>): void {
		this.message(`Later import preview · ${changes.added.length} added · ${changes.changed.length} changed · ${changes.removed.length} removed · ${changes.unchanged} unchanged`);
		for (const category of ['added', 'changed', 'removed'] as const) for (const path of changes[category]) this.results?.createEl('p', { text: `${category} · ${path}` });
		this.results?.createEl('p', { text: 'This preview compares source text. To import again, choose a new destination and review a new plan. Existing output notes stay in place.' });
	}
	onClose(): void { this.generation++; this.prepared = null; this.contentEl.empty(); this.results = null; this.importButton = null; this.onClosed(); }
}
