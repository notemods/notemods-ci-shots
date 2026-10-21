import { Modal, Setting } from 'obsidian';
import type CraftLinkRepairPlugin from './main';
import type { RepairPlan } from './repair';
import { isPro } from './pro';

export class RepairModal extends Modal {
	plan: RepairPlan | null = null;
	private serial = 0;
	private openState = false;
	private folder: string;
	constructor(private plugin: CraftLinkRepairPlugin) { super(plugin.app); this.folder = plugin.settings.folder; }
	onOpen(): void { this.openState = true; this.setTitle('Craft link repair'); this.contentEl.addClass('craft-repair'); this.draw(); }
	onClose(): void { this.openState = false; this.serial++; this.contentEl.empty(); }
	private draw(): void {
		const el = this.contentEl; el.empty();
		el.createEl('p', { text: 'Choose a folder with an unpacked export in this vault. Review links before you write copies. Source notes stay intact.' });
		new Setting(el).setName('Export folder').addText((t) => t.setPlaceholder('Craft exports').setValue(this.folder).onChange((value) => { this.folder = value; this.plan = null; this.serial++; preview.empty(); }));
		new Setting(el).setName(isPro() ? 'Pro is active' : 'Free: up to 10 note copies per pass').setDesc(isPro() ? 'Saved output and date choices apply to this pass.' : 'Date links use YYYY-MM-DD. Copies are beside source notes.').addButton((b) => b.setButtonText('Preview links').setCta().onClick(async () => {
			b.setDisabled(true);
			const serial = ++this.serial;
			preview.setText('Reading local export files…');
			try {
				const plan = await this.plugin.prepare(this.folder);
				if (!this.openState || serial !== this.serial) return;
				this.plan = plan;
				this.plugin.settings.folder = plan.folder;
				await this.plugin.saveSettings();
				if (this.openState && serial === this.serial) this.showPlan(preview, plan);
			} catch (error) { if (this.openState && serial === this.serial) preview.setText(error instanceof Error ? error.message : String(error)); }
			finally { b.setDisabled(false); }
		}));
		const preview = el.createDiv({ cls: 'craft-repair-preview' });
	}
	private showPlan(el: HTMLElement, plan: RepairPlan): void {
		el.empty();
		el.createEl('p', { cls: 'craft-repair-summary', text: `${plan.copies.length} copies · ${plan.changes.length} repaired links · ${plan.issues.length} review items · ${plan.skipped.length} existing copies` });
		if (!plan.copies.length) el.createEl('p', { text: 'No new Markdown notes to copy. Check the export folder or the existing copies.' });
		const list = el.createDiv({ cls: 'craft-repair-list' });
		for (const copy of plan.copies.slice(0, 30)) {
			list.createEl('p', { cls: 'craft-repair-output', text: `${copy.source} → ${copy.path}` });
			const changes = plan.changes.filter((c) => c.source === copy.source);
			for (const change of changes.slice(0, 12)) {
				list.createDiv({ text: `${change.label}: ${change.url}` });
				list.createEl('code', { text: `[[${change.target}|${change.label}]]` });
			}
		}
		for (const item of plan.issues.slice(0, 30)) list.createEl('p', { cls: 'craft-repair-issue', text: `${item.reason}: ${item.url || item.source}` });
		for (const blocked of plan.blocked) el.createEl('p', { cls: 'craft-repair-issue', text: blocked });
		if (plan.copies.length > 30 || plan.issues.length > 30) el.createEl('p', { text: 'The preview shows the first 30 copies and review items. The report includes the full issue list.' });
		new Setting(el).setName('Write reviewed copies').setDesc('No existing note is overwritten. A report is saved in the export folder.').addButton((b) => b.setButtonText('Write copies').setCta().setDisabled(plan.blocked.length > 0 || plan.copies.length === 0).onClick(async () => {
			b.setDisabled(true);
			try {
				const result = await this.plugin.writePlan(plan);
				if (!this.openState) return;
				el.empty();
				el.createEl('p', { text: `${result.written.length} copies written. Report: ${result.report || 'could not create report'}` });
				for (const failure of result.failures) el.createEl('p', { cls: 'craft-repair-issue', text: failure });
				if (result.report) new Setting(el).setName('Review the report').addButton((button) => button.setButtonText('Open report').onClick(async () => {
					const file = this.app.vault.getFileByPath(result.report);
					if (file) { this.close(); await this.app.workspace.getLeaf('tab').openFile(file); }
				}));
			} catch (error) { if (this.openState) el.createEl('p', { cls: 'craft-repair-issue', text: error instanceof Error ? error.message : String(error) }); }
		}));
	}
}
