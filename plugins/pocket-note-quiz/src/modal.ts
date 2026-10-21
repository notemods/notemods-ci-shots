import { Component, MarkdownRenderer, Modal, Setting } from 'obsidian';
import type PocketNoteQuizPlugin from './main';
import { answerText, filterQuestions, score, type Card, type Filter, type Response } from './quiz';

export class QuizModal extends Modal {
	private renderOwner = new Component();
	private active = false;
	private busy = false;
	private revealed = false;
	cards: Card[] = [];
	responses: Response[] = [];
	index = 0;
	constructor(private plugin: PocketNoteQuizPlugin, private source: Card[], private paths: string[], private title: string, private marker: string) { super(plugin.app); }
	onOpen(): void {
		this.active = true; this.renderOwner.load();
		this.modalEl.addClass('pocket-note-quiz'); this.setTitle(this.plugin.manifest.name); this.startScreen();
	}
	onClose(): void {
		this.active = false; this.renderOwner.unload(); this.contentEl.empty();
		if (this.plugin.quiz === this) this.plugin.quiz = null;
	}
	private reset(): void { this.renderOwner.unload(); this.renderOwner = new Component(); this.renderOwner.load(); this.contentEl.empty(); }
	private button(text: string, id: string, action: () => Promise<unknown> | void): HTMLButtonElement {
		const b = this.contentEl.createEl('button', { text, attr: { 'data-action': id } });
		b.addEventListener('click', () => {
			if (this.busy) return;
			this.busy = true; b.disabled = true;
			void this.plugin.run(async () => { try { await action(); } finally { this.busy = false; if (b.isConnected) b.disabled = false; } });
		});
		return b;
	}
	startScreen(): void {
		this.reset();
		this.contentEl.createEl('p', { text: this.title, cls: 'pnq-source' });
		this.contentEl.createEl('p', { text: `${this.source.length} questions · Marker ${this.marker}` });
		this.button('All questions', 'all', () => this.begin('all'));
		this.button('Only wrong', 'wrong', () => this.begin('wrong'));
		this.button('Only unmarked', 'unmarked', () => this.begin('unmarked'));
		this.button('Clear marks', 'clear', async () => {
			await this.plugin.clear(this.paths, this.marker);
			this.source = this.source.map((c) => ({ ...c, mark: null })); if (this.active) this.startScreen();
		});
		let folder = this.paths[0]?.split('/').slice(0, -1).join('/') ?? '';
		new Setting(this.contentEl).setName('Folder quiz (pro)').setDesc('Include Markdown notes in this folder and its subfolders. Empty means the vault root.')
			.addText((t) => t.setValue(folder).setPlaceholder('Folder path').onChange((v) => { folder = v; }))
			.addButton((b) => b.setButtonText('Load folder').onClick(() => this.plugin.run(() => this.plugin.startFolder(folder))));
	}
	async begin(filter: Filter): Promise<void> {
		this.cards = filterQuestions(this.source, filter); this.responses = []; this.index = 0;
		if (!this.cards.length) { this.reset(); this.contentEl.createEl('p', { text: 'No questions match this choice.' }); this.button('Back', 'back', () => this.startScreen()); return; }
		await this.drawCard();
	}
	private async drawCard(): Promise<void> {
		this.reset(); this.revealed = false;
		const c = this.cards[this.index]; if (!c || !this.active) return;
		this.contentEl.createEl('p', { text: `Question ${this.index + 1} of ${this.cards.length}`, cls: 'pnq-progress' });
		this.contentEl.createEl('p', { text: c.path, cls: 'pnq-source' });
		this.contentEl.createDiv({ text: c.question, cls: 'pnq-question' });
		this.button('Show answer', 'show', () => this.showAnswer());
	}
	async showAnswer(): Promise<void> {
		if (this.revealed || !this.active) return;
		const c = this.cards[this.index]; if (!c) return;
		this.revealed = true;
		this.contentEl.querySelector('[data-action="show"]')?.remove();
		const answer = this.contentEl.createDiv({ cls: 'pnq-answer' });
		try {
			await MarkdownRenderer.render(this.app, answerText(c.answer), answer, c.path, this.renderOwner);
		} catch (error) {
			this.revealed = false; answer.remove();
			if (this.active) this.button('Show answer', 'show', () => this.showAnswer());
			throw error;
		}
		if (!this.active || !answer.isConnected) return;
		this.button('Correct', 'correct', () => this.respond('correct'));
		this.button('Wrong', 'mark-wrong', () => this.respond('wrong'));
	}
	async respond(result: 'correct' | 'wrong'): Promise<void> {
		const c = this.cards[this.index]; if (!c || !this.revealed) return;
		this.revealed = false; this.responses.push({ ...c, result }); this.index++;
		if (this.index < this.cards.length) await this.drawCard(); else this.summary();
	}
	private summary(): void {
		this.reset(); const s = score(this.responses);
		this.contentEl.createDiv({ text: `${s.correct} / ${s.total} correct`, cls: 'pnq-score' });
		const status = this.contentEl.createEl('p', { text: `${s.wrong} wrong. Source marks have not changed.` });
		this.button('Apply marks to source', 'apply', async () => {
			const r = await this.plugin.apply(this.responses, this.marker);
			if (this.active) { status.setText('Apply complete.'); this.contentEl.createEl('p', { text: `Applied ${r.applied} marks; ${r.skipped} skipped card${r.skipped === 1 ? '' : 's'}.`, cls: 'pnq-applied' }); this.contentEl.querySelector('[data-action="apply"]')?.remove(); }
		});
		this.button('Save dated score report (Pro)', 'report', async () => {
			const path = await this.plugin.saveReport(this.responses);
			if (path && this.active) this.contentEl.createEl('p', { text: path, cls: 'pnq-report' });
		});
		this.button('Close', 'close', () => this.close());
	}
}
