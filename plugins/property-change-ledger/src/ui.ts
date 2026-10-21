import { Modal, Notice, Setting } from 'obsidian';
import type LedgerPlugin from './main';
import { counts, filterRecords, valueText, type Change } from './ledger';
import { isPro, onProChange } from './pro';
function report(e: unknown): void { new Notice(e instanceof Error ? e.message : String(e)); }
export class WatchModal extends Modal {
	constructor(public plugin: LedgerPlugin) { super(plugin.app); }
	onOpen(): void {
		this.setTitle('Watch note properties'); this.modalEl.addClass('property-change-ledger-modal');
		const draft = { folder: this.plugin.settings.folder, keys: this.plugin.settings.keys, ledger: this.plugin.settings.ledger };
		this.contentEl.createEl('p', { text: 'Save sets a new baseline. Initial values are not logged. Folder includes subfolders; blank means the vault root.' });
		for (const [key, label] of [['folder', 'Folder'], ['keys', 'Exact keys separated by commas'], ['ledger', 'Ledger path']] as const) new Setting(this.contentEl).setName(label).addText(t => t.setValue(draft[key]).onChange(v => { draft[key] = v; }));
		new Setting(this.contentEl).addButton(b => b.setButtonText('Save watch').setCta().onClick(async () => { try { await this.plugin.applyWatch(draft); this.close(); } catch (e) { report(e); } }));
		new Setting(this.contentEl).setName('Named watch profiles (pro)').setHeading();
		let name = '';
		new Setting(this.contentEl).setName('Profile name').addText(t => t.setPlaceholder('Weekly review').onChange(v => { name = v; })).addButton(b => b.setButtonText('Save current watch').onClick(async () => { try { if (await this.plugin.saveProfile(name)) { this.contentEl.empty(); this.onOpen(); } } catch (e) { report(e); } }));
		for (const profile of this.plugin.settings.profiles) new Setting(this.contentEl).setName(profile.name).setDesc(`${profile.folder || 'Vault root'} • ${profile.keys}`).addButton(b => b.setButtonText('Load').onClick(async () => { try { if (await this.plugin.loadProfile(profile.name)) this.close(); } catch (e) { report(e); } }));
	}
	onClose(): void { if (this.plugin.modal === this) this.plugin.modal = null; this.contentEl.empty(); }
}
export class HistoryModal extends Modal {
	private records: Change[] = [];
	private note = '';
	private key = '';
	private result: HTMLElement | null = null;
	private off: (() => void) | null = null;
	private closed = false;
	constructor(public plugin: LedgerPlugin) { super(plugin.app); }
	async onOpen(): Promise<void> {
		this.setTitle('Recent property changes'); this.modalEl.addClass('property-change-ledger-modal');
		this.contentEl.createEl('p', { text: 'Observed on this device. Newest records appear first. Filters use a note path fragment and an exact key.' });
		new Setting(this.contentEl).setName('Note filter').addText(t => t.setPlaceholder('Atlas').onChange(v => { this.note = v; this.render(); }));
		new Setting(this.contentEl).setName('Key filter').addText(t => t.setPlaceholder('Exact key').onChange(v => { this.key = v; this.render(); }));
		new Setting(this.contentEl).addButton(b => b.setButtonText('Refresh').onClick(async () => { this.records = await this.plugin.history(); if (!this.closed) this.render(); })).addButton(b => b.setButtonText('Export filtered CSV (pro)').onClick(async () => { try { await this.plugin.exportCsv(this.note, this.key); } catch (e) { report(e); } }));
		this.result = this.contentEl.createDiv({ cls: 'property-change-ledger-results' });
		this.off = onProChange(() => this.render());
		try { this.records = await this.plugin.history(); if (!this.closed) this.render(); } catch (e) { report(e); }
	}
	private render(): void {
		const el = this.result; if (!el || this.closed) return; el.empty();
		const filtered = filterRecords(this.records, this.note, this.key);
		el.createEl('p', { text: `${filtered.length} matching records. Showing up to 100 recent records.` });
		const table = el.createEl('table', { cls: 'property-change-ledger-table' });
		const head = table.createEl('thead').createEl('tr');
		for (const label of ['UTC time', 'Note', 'Key', 'Old', 'New']) head.createEl('th', { text: label });
		const body = table.createEl('tbody');
		for (const r of filtered.slice(-100).reverse()) {
			const row = body.createEl('tr'); row.createEl('td', { text: r.time });
			const link = row.createEl('td').createEl('button', { text: r.path, cls: 'property-change-ledger-note' });
			link.addEventListener('click', () => { void this.app.workspace.openLinkText(r.path, ''); });
			for (const value of [r.key, valueText(r.old), valueText(r.new)]) row.createEl('td', { text: value });
		}
		new Setting(el).setName('Status change counts by note (pro)').setHeading();
		if (isPro()) {
			const list = el.createEl('ul'); for (const [path, count] of counts(filtered)) list.createEl('li', { text: `${path}: ${count}` });
			if (!counts(filtered).length) el.createEl('p', { text: 'No observed changes for the exact key status in this filter.' });
		} else el.createEl('p', { text: 'Pro adds counts for the exact key status in the filtered history.' });
	}
	onClose(): void { this.closed = true; if (this.plugin.modal === this) this.plugin.modal = null; this.off?.(); this.off = null; this.contentEl.empty(); }
}
