import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { equations } from './math';
import { PRO_LABEL, isPro, proText } from './pro';
import type SteadyInlineMathPlugin from './main';
export const PANEL_ID = 'steady-inline-math-equations';
export class EquationPanel extends ItemView {
	constructor(leaf: WorkspaceLeaf, readonly owner: SteadyInlineMathPlugin) { super(leaf); }
	getViewType(): string { return PANEL_ID; }
	getDisplayText(): string { return `Equations (${PRO_LABEL})`; }
	getIcon(): string { return 'sigma'; }
	async onOpen(): Promise<void> {
		this.owner.panels.add(this);
		this.render();
		await Promise.resolve();
	}
	async onClose(): Promise<void> { this.owner.panels.delete(this); await Promise.resolve(); }
	render(): void {
		this.contentEl.empty();
		this.contentEl.addClass('steady-inline-math-panel');
		this.contentEl.createEl('h2', { text: `Equations (${PRO_LABEL})` });
		if (!isPro()) { this.contentEl.createEl('p', { text: proText(`The equation panel needs ${PRO_LABEL}.`) }); return; }
		const path = this.owner.capturePanelNote();
		const cm = [...this.owner.guard.views].find((v) => this.owner.filePath(v.state) === path && v.dom.isConnected && v.dom.offsetParent !== null);
		const note = this.app.vault.getFileByPath(path);
		if (!note || !cm) { this.contentEl.createEl('p', { text: 'Open a note in the editor.' }); return; }
		const source = this.owner.guard.cleanText(cm);
		this.contentEl.createEl('p', { text: note.basename, cls: 'steady-inline-math-note' });
		const rows = equations(source);
		if (!rows.length) this.contentEl.createEl('p', { text: 'No plain paragraph equations found.' });
		for (const row of rows) {
			const item = this.contentEl.createDiv({ cls: 'steady-inline-math-equation' });
			item.createEl('small', { text: `Line ${row.line}` });
			item.createEl('code', { text: row.text });
		}
	}
}
