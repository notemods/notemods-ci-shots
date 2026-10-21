import { ItemView, Modal, Notice, Setting, type WorkspaceLeaf } from 'obsidian';
import type QueryPlugin from './main';
import { cellText, errorText, MAX_ROWS, MAX_TEXT, tableResult } from './query';
const QUERY_LANGUAGE = 'JMESPath';
const PRO_LABEL = 'Pro';
export const VIEW_ID = 'jsonpath-vault-query-view';
export class QueryView extends ItemView {
	path = ''; expression = '@'; savedName = ''; batchPaths = ''; reportName = 'Query report';
	result: unknown = undefined;
	error = '';
	private output!: HTMLElement;
	private revision = 0;
	constructor(leaf: WorkspaceLeaf, readonly owner: QueryPlugin) { super(leaf); }
	getViewType(): string { return VIEW_ID; }
	getDisplayText(): string { return 'Local JSON queries'; }
	async onOpen(): Promise<void> { this.owner.views.add(this); this.draw(); await Promise.resolve(); }
	async onClose(): Promise<void> { this.revision++; this.owner.views.delete(this); await Promise.resolve(); }
	clearResult(): void { this.revision++; this.result = undefined; this.error = ''; if (this.output) this.output.empty(); }
	draw(): void {
		const el = this.contentEl; el.empty(); el.addClass('local-json-query');
		new Setting(el).setName('Local JSON queries').setDesc(`${QUERY_LANGUAGE} only. Queries run on this device. Input limit: 5 MiB per file.`).setHeading();
		new Setting(el).setName('Input file').setDesc('Vault path to one .json or .jsonl file.').addText((t) => t.setValue(this.path).onChange((v) => { this.path = v; this.clearResult(); }));
		new Setting(el).setName('Query expression').addTextArea((t) => t.setValue(this.expression).onChange((v) => { this.expression = v; this.clearResult(); }));
		new Setting(el).setName('Run locally').addButton((b) => b.setButtonText('Run query').onClick(() => this.run(false))).addButton((b) => b.setButtonText('Copy JSON').onClick(() => this.copy()));
		this.output = el.createDiv({ cls: 'local-json-output' });
		new Setting(el).setName('Saved query').addDropdown((d) => {
			d.addOption('', 'Choose a saved query');
			for (const q of this.owner.settings.saved) d.addOption(q.name, q.name);
			d.setValue(this.savedName).onChange((name) => this.selectSaved(name));
		}).addButton((b) => b.setButtonText('Delete').onClick(async () => { try { await this.owner.deleteQuery(this.savedName); this.savedName = ''; this.draw(); } catch (e) { this.showError(e); } }));
		new Setting(el).setName('Query name').addText((t) => t.setValue(this.savedName).onChange((v) => { this.savedName = v; })).addButton((b) => b.setButtonText('Save query').onClick(async () => {
			try { await this.owner.saveQuery({ name: this.savedName.trim(), path: this.path.trim(), expression: this.expression }); this.savedName = this.savedName.trim(); this.draw(); new Notice('Query saved.'); } catch (e) { this.showError(e); }
		}));
		new Setting(el).setName(`Several files (${PRO_LABEL})`).setDesc('Select a saved query first. Enter 1 to 20 paths, one per line. Results combine in file order; arrays flatten one level.').addTextArea((t) => t.setValue(this.batchPaths).onChange((v) => { this.batchPaths = v; this.clearResult(); })).addButton((b) => b.setButtonText('Run saved query on files').onClick(() => this.run(true)));
		new Setting(el).setName(`New report (${PRO_LABEL})`).setDesc('Write the complete result to a new file at the vault root.').addButton((b) => b.setButtonText('Write report').onClick(() => {
			if (this.result === undefined) { this.showError(new Error('Run a query before you write a report.')); return; }
			new ReportModal(this).open();
		}));
		this.renderResult();
	}
	selectSaved(name: string): void {
		const q = this.owner.settings.saved.find((s) => s.name === name);
		this.clearResult(); this.savedName = name;
		if (q) { this.path = q.path; this.expression = q.expression; }
		this.draw();
	}
	async run(batch = false): Promise<void> {
		this.clearResult(); const revision = this.revision;
		try {
			let result: unknown;
			if (batch) {
				const saved = this.owner.settings.saved.find((q) => q.name === this.savedName);
				if (!saved) throw new Error('Select a saved query for several files.');
				result = await this.owner.queryFiles(this.batchPaths.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), saved.expression);
			} else result = await this.owner.queryFile(this.path, this.expression);
			if (revision !== this.revision) return;
			this.result = result; this.renderResult();
		} catch (e) { if (revision === this.revision) this.showError(e); }
	}
	showError(e: unknown): void { this.result = undefined; this.error = errorText(e); this.renderResult(); }
	renderResult(): void {
		this.output.empty();
		if (this.error) { this.output.createEl('p', { cls: 'local-json-error', text: this.error }); return; }
		if (this.result === undefined) { this.output.createEl('p', { text: 'Choose a file and run a query to see the result.' }); return; }
		const table = tableResult(this.result);
		const count = Array.isArray(this.result) ? this.result.length : 1;
		this.output.createEl('p', { cls: 'local-json-count', text: `${count} result ${count === 1 ? 'item' : 'items'}.` });
		if (count > MAX_ROWS) this.output.createEl('p', { text: `Truncated display: ${MAX_ROWS} of ${count} rows. Copy JSON and reports include the complete result.` });
		if (table) {
			if (table.omittedColumns) this.output.createEl('p', { text: `${table.omittedColumns} columns omitted from the display.` });
			const t = this.output.createEl('table'); const head = t.createEl('thead').createEl('tr');
			for (const c of table.columns) head.createEl('th', { text: c });
			const body = t.createEl('tbody');
			for (const row of table.rows) { const tr = body.createEl('tr'); for (const c of table.columns) { const text = cellText(row[c]); tr.createEl('td', { text: text.length > 2000 ? text.slice(0, 2000) + '… [cell truncated]' : text }); } }
		} else {
			const shown = Array.isArray(this.result) ? this.result.slice(0, MAX_ROWS) : this.result;
			const text = JSON.stringify(shown, null, 2);
			this.output.createEl('pre', { text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n[Text display truncated]' : text });
		}
	}
	async copy(): Promise<void> {
		if (this.result === undefined) { this.showError(new Error('Run a query before you copy.')); return; }
		try { await navigator.clipboard.writeText(JSON.stringify(this.result, null, 2)); new Notice('JSON result copied.'); } catch (e) { new Notice(`Copy failed: ${errorText(e)}`); }
	}
	async exportResult(kind: 'csv' | 'md', name: string): Promise<string | null> {
		if (this.result === undefined) { this.showError(new Error('Run a query before you write a report.')); return null; }
		try { const file = await this.owner.writeReport(this.result, kind, name); new Notice(`Report created: ${file.path}`); return file.path; }
		catch (e) { this.showError(e); return null; }
	}
}
class ReportModal extends Modal {
	constructor(private view: QueryView) { super(view.app); }
	onOpen(): void {
		this.titleEl.setText(`New report (${PRO_LABEL})`);
		new Setting(this.contentEl).setName('Report name').setDesc('New file at the vault root. Existing files are kept.').addText((t) => t.setValue(this.view.reportName).onChange((s) => { this.view.reportName = s; }));
		new Setting(this.contentEl).setName('File format').addButton((b) => b.setButtonText('Create CSV').onClick(async () => { if (await this.view.exportResult('csv', this.view.reportName)) this.close(); })).addButton((b) => b.setButtonText('Create Markdown').onClick(async () => { if (await this.view.exportResult('md', this.view.reportName)) this.close(); }));
	}
	onClose(): void { this.contentEl.empty(); }
}
