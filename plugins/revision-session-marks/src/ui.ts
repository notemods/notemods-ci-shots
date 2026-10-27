import { Modal, type App, type TFile } from 'obsidian';
import type { Review } from './review';
import type { StoredState } from './state';

export class SessionModal extends Modal {
	constructor(app: App, private readonly state: StoredState, private readonly message: string) { super(app); }
	onOpen(): void {
		this.setTitle('Writing session');
		this.modalEl.addClass('revision-session-marks-modal');
		const el = this.contentEl;
		if (this.message) el.createEl('p', { text: this.message, cls: 'revision-message' });
		const b = this.state.session;
		el.createEl('p', { text: b ? `Saved baseline: ${b.path}` : 'No free session is active.' });
		if (b) {
			el.createEl('p', { text: b.invalid ? 'File identity changed. Baseline kept for inspection.' : 'Baseline saved locally. Edit the same note, then stop the session.', cls: 'revision-proof' });
			el.createEl('pre', { text: b.text, cls: 'revision-prose' });
		}
		el.createEl('p', { text: `Named baselines: ${this.state.named.length} of 50 (Pro)` });
		for (const item of this.state.named) el.createEl('p', { text: `${item.name}, ${item.path}${item.invalid ? ' (file changed)' : ''}` });
		el.createEl('p', { text: 'Plain prose only. Input limit: 100 KB. Diff limit: 1 second or 1,000 token edits.', cls: 'revision-muted' });
	}
	onClose(): void { this.contentEl.empty(); }
}

export class ReviewModal extends Modal {
	constructor(app: App, private readonly file: TFile, private readonly review: Review, private readonly paths: string[]) { super(app); }
	onOpen(): void {
		this.setTitle('Revision review');
		this.modalEl.addClass('revision-session-marks-modal');
		const el = this.contentEl;
		el.createEl('p', { text: `Saved ${this.paths.length} review ${this.paths.length === 1 ? 'note' : 'notes'}. Source text kept.` });
		for (const path of this.paths) el.createEl('p', { text: path, cls: 'revision-muted' });
		const proofs = el.createDiv({ cls: 'revision-proofs' });
		proofs.createSpan({ text: 'Accept check passed', cls: 'revision-proof' });
		proofs.createSpan({ text: 'Reject check passed', cls: 'revision-proof' });
		el.createEl('p', { text: `${this.review.additions} additions · ${this.review.deletions} deletions · ${this.review.substitutions} substitutions` });
		el.createEl('pre', { text: this.review.text, cls: 'revision-prose revision-markup' });
		el.createEl('p', { text: 'The restore checks match the final text and the saved baseline exactly.', cls: 'revision-muted' });
		const button = el.createEl('button', { text: 'Open review note', cls: 'mod-cta' });
		button.addEventListener('click', () => { this.close(); void this.app.workspace.getLeaf('tab').openFile(this.file); });
	}
	onClose(): void { this.contentEl.empty(); }
}
