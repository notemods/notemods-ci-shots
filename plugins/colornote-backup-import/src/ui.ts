import { COPY } from './copy';
import { Modal, Setting, Notice, type TextComponent } from 'obsidian';
import { decodeBackup, recordClass, compareBackups, validFolder, colorMap, type Backup } from './backup';
import { isPro, onProChange } from './pro';
import type ColornoteBackupImportPlugin from './main';

class BackupPicker {
	file: File | null = null;
	password: TextComponent | null = null;
	constructor(container: HTMLElement, label: string, private changed: () => void) {
		const row = new Setting(container).setName(label).setDesc('Local version 7.1 backup, up to 32 MiB.');
		const input = row.controlEl.createEl('input', { type: 'file', attr: { 'aria-label': label } });
		input.addEventListener('change', () => { this.file = input.files?.[0] ?? null; changed(); });
		new Setting(container).setName(`${label} password`).addText((t) => {
			this.password = t;
			t.inputEl.type = 'password';
			t.inputEl.autocomplete = 'off';
			t.inputEl.setAttribute('aria-label', `${label} password`);
			t.onChange(() => changed());
		});
	}
	async decode(): Promise<Backup> {
		if (!this.file) throw new Error('Select a backup file.');
		if (this.file.size > 32 * 1024 * 1024) throw new Error('The backup exceeds the 32 MiB input limit.');
		const bytes = new Uint8Array(await this.file.arrayBuffer());
		try { return decodeBackup(bytes, this.password?.getValue() ?? ''); }
		finally { bytes.fill(0); }
	}
	clear(): void { this.password?.setValue(''); this.file = null; this.changed(); }
}

export class ImportModal extends Modal {
	private picker: BackupPicker | null = null;
	private preview: Backup | null = null;
	private folder = 'ColorNote imports';
	private colors = '{}';
	private profileName = '';
	private status: HTMLElement | null = null;
	private closed = false;
	private generation = 0;
	private off: (() => void) | null = null;
	constructor(private owner: ColornoteBackupImportPlugin) { super(owner.app); owner.modals.add(this); }
	onOpen(): void {
		this.titleEl.setText(COPY.importBackup);
		this.contentEl.addClass('colornote-import');
		this.contentEl.createEl('p', { text: 'Decode and review the record counts, then import into a new folder. The password stays in this modal.' });
		this.picker = new BackupPicker(this.contentEl, 'Backup', () => { this.preview = null; this.generation++; });
		let folderText: TextComponent;
		let colorsText: TextComponent;
		new Setting(this.contentEl).setName('Parent folder').addText((t) => { folderText = t; t.setValue(this.folder).onChange((v) => { this.folder = v; }); });
		new Setting(this.contentEl).setName(COPY.colors).setDesc('JSON mapping, for example {"0":"Yellow","1":"Green"}.').addText((t) => { colorsText = t; t.setValue(this.colors).onChange((v) => { this.colors = v; }); });
		new Setting(this.contentEl).setName(COPY.profiles).addDropdown((d) => {
			d.addOption('', 'Select a profile');
			this.owner.settings.profiles.forEach((p, i) => { d.addOption(String(i), p.name); });
			d.onChange((v) => {
				if (!v || !this.owner.requirePro()) return;
				const p = this.owner.settings.profiles[Number(v)];
				if (!p) return;
				this.folder = p.folder; this.colors = JSON.stringify(p.colors); folderText.setValue(this.folder); colorsText.setValue(this.colors);
			});
		});
		new Setting(this.contentEl).setName(COPY.profileName).addText((t) => t.onChange((v) => { this.profileName = v; })).addButton((b) => b.setButtonText('Save profile').onClick(async () => {
			if (!this.owner.requirePro()) return;
			try { if (await this.owner.saveProfile({ name: this.profileName, folder: this.folder, colors: colorMap(this.colors) })) this.show('Profile saved. Close and open this modal to select it.'); } catch (e) { this.error(e); }
		}));
		this.status = this.contentEl.createDiv({ cls: 'colornote-status', attr: { 'aria-live': 'polite' } });
		new Setting(this.contentEl).addButton((b) => b.setButtonText('Decode and review').onClick(async () => {
			const generation = this.generation;
			b.setDisabled(true);
			try {
				const backup = await this.picker!.decode();
				if (this.closed || generation !== this.generation) return;
				this.preview = backup;
				this.show(`Version 7.1 · Header count ${backup.headerCount} · Decoded records ${backup.records.length}`);
				const counts = new Map<string, number>();
				for (const r of backup.records) { const k = recordClass(r); counts.set(k, (counts.get(k) ?? 0) + 1); }
				for (const [k, n] of counts) this.status!.createEl('p', { text: `${k}: ${n}` });
			} catch (e) { if (!this.closed) this.error(e); }
			finally { b.setDisabled(false); }
		})).addButton((b) => b.setButtonText('Import notes').setCta().onClick(async () => {
			if (!this.preview) { this.show('Decode and review the backup first.'); return; }
			b.setDisabled(true);
			try {
				const root = await this.owner.importBackup(this.preview, validFolder(this.folder), isPro() ? colorMap(this.colors) : {});
				this.preview = null; this.picker?.clear();
				if (!this.closed) this.show(`Import complete. Notes and report: ${root}`);
				new Notice(`ColorNote import complete: ${root}`);
			} catch (e) { if (!this.closed) this.error(e); }
			finally { b.setDisabled(false); }
		}));
		this.off = onProChange(() => { if (!this.closed) this.show('Pro state changed. Check the selected profile before import.'); });
	}
	private show(text: string): void { this.status?.empty(); this.status?.createEl('p', { text }); }
	private error(e: unknown): void { this.show(e instanceof Error ? e.message : String(e)); }
	onClose(): void { this.owner.modals.delete(this); this.closed = true; this.off?.(); this.picker?.clear(); this.preview = null; this.contentEl.empty(); }
}

export class CompareModal extends Modal {
	private pickers: BackupPicker[] = [];
	private closed = false;
	private generation = 0;
	constructor(private owner: ColornoteBackupImportPlugin) { super(owner.app); owner.modals.add(this); }
	onOpen(): void {
		this.titleEl.setText(COPY.compareTitle);
		this.contentEl.addClass('colornote-import');
		this.contentEl.createEl('p', { text: 'Compare normal note text by UUID. This view does not write notes. Titles and metadata are not compared.' });
		const result = this.contentEl.createDiv({ cls: 'colornote-diff', attr: { 'aria-live': 'polite' } });
		for (const label of ['Earlier backup', 'Later backup']) this.pickers.push(new BackupPicker(this.contentEl, label, () => { this.generation++; result.empty(); }));
		new Setting(this.contentEl).addButton((b) => b.setButtonText('Compare note text').setCta().onClick(async () => {
			if (!this.owner.requirePro()) return;
			const generation = this.generation;
			b.setDisabled(true);
			try {
				const [before, after] = await Promise.all(this.pickers.map((p) => p.decode()));
				if (this.closed || generation !== this.generation || !this.owner.requirePro()) return;
				const changes = compareBackups(before!, after!);
				result.empty(); result.createEl('p', { text: `${changes.length} changed, added or removed notes.` });
				for (const change of changes) {
					const row = result.createEl('section');
					row.createEl('h3', { text: `${change.kind} · ${change.uuid}` });
					row.createEl('p', { text: 'Earlier text' }); row.createEl('pre', { text: change.before });
					row.createEl('p', { text: 'Later text' }); row.createEl('pre', { text: change.after });
				}
			} catch (e) { if (!this.closed) { result.empty(); result.createEl('p', { text: e instanceof Error ? e.message : String(e) }); } }
			finally { b.setDisabled(false); }
		}));
	}
	onClose(): void { this.owner.modals.delete(this); this.closed = true; this.pickers.forEach((p) => p.clear()); this.contentEl.empty(); }
}
