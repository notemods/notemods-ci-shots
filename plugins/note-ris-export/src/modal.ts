import { Modal, Setting, type ButtonComponent, type EventRef } from 'obsidian';
import type NoteRisExportPlugin from './main';
import type { Preview } from './main';
import { isPro } from './pro';

/** The export window: folder, Pro map and filter, the preview of counts and errors, and the Export button. */
export class ExportModal extends Modal {
	folder: string;
	filter: string;
	private resultEl: HTMLElement | null = null;
	private exportBtn: ButtonComponent | null = null;
	private waitRef: EventRef | null = null;
	private active = false;
	last: Preview | null = null;

	constructor(private plugin: NoteRisExportPlugin) {
		super(plugin.app);
		this.folder = plugin.settings.folder;
		this.filter = plugin.settings.filter;
	}

	onOpen(): void {
		this.active = true;
		this.modalEl.addClass('note-ris-export');
		this.setTitle('Export reference notes to a .ris file');
		const { contentEl } = this;
		new Setting(contentEl)
			.setName('Reference folder')
			.setDesc('Markdown notes in this folder and its subfolders. Empty means the vault root.')
			.addText((t) => t.setPlaceholder('Folder path').setValue(this.folder).onChange((v) => {
				this.folder = v;
			}));
		const pro = isPro();
		new Setting(contentEl)
			.setName('Named field map (pro)')
			.setDesc('The map of the settings, or a map that you saved with a name.')
			.addDropdown((d) => {
				d.addOption('', 'Map of the settings');
				for (const m of this.plugin.settings.maps) d.addOption(m.name, m.name);
				d.setValue(pro ? this.plugin.settings.activeMap : '').setDisabled(!pro).onChange(async (v) => {
					await this.plugin.useMap(v);
					this.runPreview();
				});
			});
		new Setting(contentEl)
			.setName('Filter (pro)')
			.setDesc('Export only the notes where a property has a value. Write key = value. Empty exports each note in the folder.')
			.addText((t) => t.setPlaceholder('Example: collection = thesis').setValue(pro ? this.filter : '').setDisabled(!pro).onChange((v) => {
				this.filter = v;
			}));
		new Setting(contentEl)
			.addButton((b) => {
				b.setButtonText('Preview').onClick(() => this.runPreview());
				b.buttonEl.setAttr('data-action', 'preview');
			})
			.addButton((b) => {
				b.setButtonText('Export').setCta().setDisabled(true).onClick(() => void this.runExport());
				b.buttonEl.setAttr('data-action', 'export');
				this.exportBtn = b;
			});
		this.resultEl = contentEl.createDiv({ cls: 'nre-preview' });
		this.runPreview();
	}

	onClose(): void {
		this.active = false;
		this.stopWait();
		this.contentEl.empty();
		if (this.plugin.modal === this) this.plugin.modal = null;
	}

	private stopWait(): void {
		if (this.waitRef) this.app.metadataCache.offref(this.waitRef);
		this.waitRef = null;
	}

	/** Reads the folder again and shows the count and each error. Export is on only when the data has no error. */
	runPreview(): Preview | null {
		if (!this.active || !this.resultEl) return null;
		this.stopWait();
		const filter = isPro() ? this.filter : '';
		this.plugin.settings.folder = this.folder;
		this.plugin.settings.filter = filter;
		void this.plugin.saveSettings();
		const p = this.plugin.preview(this.folder, filter);
		this.last = p;
		const el = this.resultEl;
		el.empty();
		el.createEl('p', { text: p.message, cls: 'nre-state', attr: { 'data-state': p.state } });
		if (p.state === 'not-ready') {
			// Retry only after the cache is ready: Obsidian fires "resolved" when it has indexed the files.
			this.waitRef = this.app.metadataCache.on('resolved', () => this.runPreview());
		}
		if (p.problems.length) {
			el.createEl('p', { text: `${p.problems.length} note${p.problems.length === 1 ? ' has' : 's have'} missing or invalid fields. Fix them, then select Preview. Export is off.`, cls: 'nre-blocked' });
			const ul = el.createEl('ul', { cls: 'nre-problems' });
			for (const pr of p.problems) {
				const li = ul.createEl('li');
				li.createSpan({ text: pr.path, cls: 'nre-path' });
				li.createSpan({ text: `: ${pr.errors.join('; ')}` });
			}
		} else if (p.state === 'ok') {
			el.createEl('p', { text: `Ready: ${p.sources.length} record${p.sources.length === 1 ? '' : 's'} with no errors.`, cls: 'nre-ready' });
		}
		this.exportBtn?.setDisabled(!(p.state === 'ok' && p.problems.length === 0));
		return p;
	}

	async runExport(): Promise<string | null> {
		const path = await this.plugin.exportRis(this.folder, isPro() ? this.filter : '');
		if (!this.active || !this.resultEl) return path;
		if (path) this.resultEl.createEl('p', { text: `Saved ${path}`, cls: 'nre-saved' });
		else this.runPreview();
		return path;
	}
}
