/* eslint obsidianmd/ui/sentence-case: ["warn", {"brands": ["Pro", "Markdown", "GitHub"], "acronyms": ["SRT", "VTT"]}] -- Keep the tier name, brands and format names in their correct case. */
import { Modal, Notice, Setting, SuggestModal, type TFile } from 'obsidian';
import { DEFAULT_TEMPLATE, exactCloze, renderCards, type Answer, type Card } from './cards';
import { filterCues, formatTime, parseSubtitles, type Cue, type ParseResult } from './cues';
import { isPro, onProChange, proNotice } from './pro';
import SubtitleSentenceMinerPlugin, { showError } from './main';

export class SourcePicker extends SuggestModal<TFile> {
	constructor(readonly plugin: SubtitleSentenceMinerPlugin, readonly choose: (file: TFile) => Promise<unknown>) {
		super(plugin.app);
		this.setPlaceholder('Select an in-vault SRT or VTT file');
		this.emptyStateText = 'No subtitle file found. Add an SRT or VTT file to this vault.';
	}
	getSuggestions(query: string): TFile[] {
		return this.app.vault.getFiles().filter((file) => this.plugin.isSubtitle(file) && file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => a.path.localeCompare(b.path));
	}
	renderSuggestion(file: TFile, el: HTMLElement): void { el.setText(file.path); }
	onChooseSuggestion(file: TFile): void { void this.choose(file).catch(showError); }
}

interface Entry { source: string; cue: Cue; answer?: Answer; selected: boolean }

export class MinerModal extends Modal {
	readonly entries: Entry[] = [];
	readonly warnings: string[] = [];
	query = '';
	templateName = '';
	private list: HTMLElement | null = null;
	private summary: HTMLElement | null = null;
	private off: (() => void) | null = null;
	private closed = false;
	private readonly children = new Set<Modal>();

	constructor(readonly plugin: SubtitleSentenceMinerPlugin, source: string, parsed: ParseResult) {
		super(plugin.app);
		this.addParsed(source, parsed);
	}

	private addParsed(source: string, parsed: ParseResult): void {
		this.entries.push(...parsed.cues.map((cue) => ({ source, cue, selected: false })));
		this.warnings.push(...parsed.warnings.map((warning) => `${source}: ${warning}`));
	}

	onOpen(): void {
		this.plugin.miners.add(this);
		this.modalEl.addClass('ssm-modal');
		this.setTitle('Subtitle sentence miner');
		this.contentEl.addClass('ssm-miner');
		this.contentEl.createEl('p', { text: 'Choose cues, set their answers, then review a new card note.' });
		new Setting(this.contentEl).setName('Filter cue text').addText((text) => {
			text.inputEl.dataset.ssm = 'filter';
			text.setPlaceholder('Find a sentence').onChange((value) => { this.query = value; this.drawList(); });
		});
		new Setting(this.contentEl).setName('Combine subtitle files (Pro)').setDesc('Add another source to this card selection.').addButton((button) => {
			button.buttonEl.dataset.ssm = 'add-source';
			button.setButtonText('Add source (Pro)').onClick(() => {
			if (!isPro()) { proNotice('Combined cards need Pro.'); return; }
			this.openChild(new SourcePicker(this.plugin, (file) => this.addSource(file)));
			});
		});
		new Setting(this.contentEl).setName('Card template (Pro)').addDropdown((dropdown) => {
			dropdown.selectEl.dataset.ssm = 'template';
			dropdown.addOption('', 'Default Markdown');
			for (const template of this.plugin.settings.templates) dropdown.addOption(template.name, template.name);
			dropdown.onChange((value) => {
				if (value && !isPro()) { dropdown.setValue(''); proNotice('Saved templates need Pro.'); return; }
				this.templateName = value;
			});
		}).addButton((button) => {
			button.buttonEl.dataset.ssm = 'save-template';
			button.setButtonText('Save template (Pro)').onClick(() => {
			if (!isPro()) { proNotice('Saved templates need Pro.'); return; }
			this.openChild(new TemplateModal(this.plugin, () => { this.close(); new Notice('Template saved. Open a subtitle file to use it.'); }));
			});
		});
		this.summary = this.contentEl.createEl('p', { cls: 'ssm-summary', attr: { 'aria-live': 'polite' } });
		this.list = this.contentEl.createDiv({ cls: 'ssm-cues' });
		new Setting(this.contentEl).addButton((button) => button.setButtonText('Select shown cues').onClick(() => {
			for (const entry of this.visible()) entry.selected = true;
			this.drawList();
		})).addButton((button) => {
			button.buttonEl.dataset.ssm = 'preview';
			button.setButtonText('Preview card note').setCta().onClick(() => this.preview());
		}).addButton((button) => button.setButtonText('Close').onClick(() => this.close()));
		this.off = onProChange(() => { this.templateName = ''; this.drawList(); });
		this.drawList();
	}

	onClose(): void {
		this.closed = true;
		this.off?.();
		for (const child of this.children) child.close();
		this.children.clear();
		this.plugin.miners.delete(this);
		this.contentEl.empty();
	}

	private openChild(modal: Modal): void { this.children.add(modal); modal.open(); }

	async addSource(file: TFile): Promise<void> {
		try {
			if (!isPro()) throw new Error('Combined cards need Pro.');
			if (!this.plugin.isSubtitle(file)) throw new Error('Select an SRT or VTT file.');
			if (this.entries.some((entry) => entry.source === file.path)) throw new Error('This source is already in the list.');
			const parsed = parseSubtitles(await this.app.vault.read(file));
			if (this.closed) return;
			if (!isPro()) throw new Error('Combined cards need Pro.');
			this.addParsed(file.path, parsed);
			this.drawList();
		} catch (error) { showError(error); }
	}

	private visible(): Entry[] {
		const cues = new Set(filterCues(this.entries.map((entry) => entry.cue), this.query));
		return this.entries.filter((entry) => cues.has(entry.cue));
	}

	drawList(): void {
		if (!this.list || !this.summary) return;
		this.list.empty();
		const visible = this.visible();
		this.summary.setText(`${visible.length} cues shown · ${this.entries.filter((entry) => entry.selected).length} selected · ${this.entries.filter((entry) => entry.selected && entry.answer).length} ready`);
		if (this.warnings.length) {
			const details = this.list.createEl('details', { cls: 'ssm-warnings' });
			details.createEl('summary', { text: `${this.warnings.length} parser warnings` });
			for (const warning of this.warnings) details.createEl('p', { text: warning });
		}
		if (!visible.length) this.list.createEl('p', { text: 'No cues match. Clear the filter or select another subtitle file.' });
		for (const entry of visible) {
			const row = this.list.createDiv({ cls: 'ssm-cue' });
			row.createEl('p', { cls: 'ssm-source', text: `${entry.source} · Cue ${entry.cue.number} · ${formatTime(entry.cue.start)} → ${formatTime(entry.cue.end)}` });
			row.createEl('p', { cls: 'ssm-text', text: entry.cue.text });
			new Setting(row).setName(entry.answer ? 'Answer ready' : 'Set an answer before export').addToggle((toggle) => {
				toggle.toggleEl.dataset.ssm = 'select-cue';
				toggle.toggleEl.setAttribute('aria-label', `Select cue ${entry.cue.number}`);
				toggle.setValue(entry.selected).onChange((value) => { entry.selected = value; this.drawList(); });
			}).addButton((button) => {
				button.buttonEl.dataset.ssm = 'edit-cue';
				button.setButtonText('Set answer').onClick(() => this.openChild(new AnswerModal(this.plugin, entry.cue, entry.answer, (answer) => {
					entry.answer = answer; entry.selected = true; this.drawList();
				})));
			});
		}
	}

	preview(): void {
		try {
			const selected = this.entries.filter((entry) => entry.selected);
			if (selected.some((entry) => !entry.answer)) throw new Error('Set an answer for each selected cue.');
			const cards: Card[] = selected.map((entry) => ({ source: entry.source, cue: { ...entry.cue }, answer: { ...entry.answer! } }));
			const template = this.templateName ? this.plugin.settings.templates.find((t) => t.name === this.templateName)?.body : undefined;
			this.plugin.checkCards(cards, template);
			this.openChild(new PreviewModal(this.plugin, cards, template));
		} catch (error) { showError(error); }
	}
}

export class AnswerModal extends Modal {
	constructor(readonly plugin: SubtitleSentenceMinerPlugin, readonly cue: Cue, readonly initial: Answer | undefined, readonly save: (answer: Answer) => void) { super(plugin.app); }
	onOpen(): void {
		this.modalEl.addClass('ssm-modal');
		this.contentEl.addClass('ssm-answer');
		this.setTitle(`Set answer for cue ${this.cue.number}`);
		this.contentEl.createEl('p', { text: 'Select one exact span in the text box. Use the button to mark it as a cloze answer, or enter a question and answer.' });
		const label = this.contentEl.createEl('label', { text: 'Cue text', attr: { for: 'ssm-span-text' } });
		const text = label.createEl('textarea', { cls: 'ssm-span-text', attr: { id: 'ssm-span-text', readonly: '', rows: '4', 'data-ssm': 'span-text' } });
		text.value = this.cue.text;
		if (this.initial?.kind === 'cloze') text.setSelectionRange(this.initial.start, this.initial.end);
		new Setting(this.contentEl).addButton((button) => {
			button.buttonEl.dataset.ssm = 'save-cloze';
			button.setButtonText('Use selected span').setCta().onClick(() => {
				try { exactCloze(this.cue.text, text.selectionStart, text.selectionEnd); this.save({ kind: 'cloze', start: text.selectionStart, end: text.selectionEnd }); this.close(); }
				catch (error) { showError(error); }
			});
		});
		let question = this.initial?.kind === 'qa' ? this.initial.question : '';
		let answer = this.initial?.kind === 'qa' ? this.initial.answer : '';
		new Setting(this.contentEl).setName('Question').addTextArea((input) => { input.inputEl.dataset.ssm = 'question'; input.setValue(question).onChange((value) => { question = value; }); });
		new Setting(this.contentEl).setName('Answer').addTextArea((input) => { input.inputEl.dataset.ssm = 'answer'; input.setValue(answer).onChange((value) => { answer = value; }); });
		new Setting(this.contentEl).addButton((button) => {
			button.buttonEl.dataset.ssm = 'save-qa';
			button.setButtonText('Use question and answer').onClick(() => {
				if (!question.trim() || !answer.trim()) { new Notice('Enter a question and an answer.'); return; }
				this.save({ kind: 'qa', question: question.trim(), answer: answer.trim() }); this.close();
			});
		}).addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}
	onClose(): void { this.contentEl.empty(); }
}

export class PreviewModal extends Modal {
	private path: string;
	private busy = false;
	private cancelled = false;
	constructor(readonly plugin: SubtitleSentenceMinerPlugin, readonly cards: Card[], readonly template?: string) {
		super(plugin.app);
		renderCards(cards, template);
		this.path = plugin.planPath(plugin.settings.outputPath);
	}
	onOpen(): void {
		this.modalEl.addClass('ssm-modal');
		this.contentEl.addClass('ssm-preview');
		this.setTitle('Preview card note');
		this.contentEl.createEl('p', { text: 'Review the Markdown text and the output path. Create note writes a new file. Cancel writes no file.' });
		new Setting(this.contentEl).setName('Output path').addText((input) => {
			input.inputEl.dataset.ssm = 'output-path';
			input.setValue(this.path).onChange((value) => { this.path = value; });
		});
		const status = this.contentEl.createEl('p', { cls: 'ssm-export-status', attr: { 'aria-live': 'polite' } });
		this.contentEl.createEl('pre', { cls: 'ssm-markdown', text: renderCards(this.cards, this.template) });
		new Setting(this.contentEl).addButton((button) => {
			button.buttonEl.dataset.ssm = 'create-note';
			button.setButtonText('Create note').setCta().onClick(async () => {
				if (this.busy || this.cancelled) return;
				try {
					const offered = this.plugin.planPath(this.path);
					if (offered !== this.path) {
						this.path = offered;
						const input = this.contentEl.querySelector<HTMLInputElement>('[data-ssm="output-path"]');
						if (input) input.value = offered;
						status.setText(`Review the new path: ${offered}. Select Create note again to confirm.`);
						return;
					}
					this.busy = true; button.setDisabled(true);
					const file = await this.plugin.createCards(this.path, this.cards, this.template);
					new Notice(`Created ${file.path}.`); this.close();
				} catch (error) { status.setText(error instanceof Error ? error.message : String(error)); }
				finally { this.busy = false; button.setDisabled(false); }
			});
		}).addButton((button) => {
			button.buttonEl.dataset.ssm = 'cancel-export';
			button.setButtonText('Cancel').onClick(() => { if (!this.busy) this.close(); });
		});
	}
	onClose(): void { this.cancelled = true; this.contentEl.empty(); }
}

class TemplateModal extends Modal {
	constructor(readonly plugin: SubtitleSentenceMinerPlugin, readonly saved: () => void) { super(plugin.app); }
	onOpen(): void {
		this.modalEl.addClass('ssm-modal'); this.setTitle('Save card template (Pro)');
		let name = ''; let body = DEFAULT_TEMPLATE;
		this.contentEl.createEl('p', { text: 'Use {{sentence}}, {{question}} and {{answer}}. Source path, cue number and times stay in the card metadata.' });
		new Setting(this.contentEl).setName('Template name').addText((input) => { input.inputEl.dataset.ssm = 'template-name'; input.onChange((value) => { name = value; }); });
		new Setting(this.contentEl).setName('Template body').addTextArea((input) => { input.inputEl.dataset.ssm = 'template-body'; input.inputEl.rows = 7; input.setValue(body).onChange((value) => { body = value; }); });
		new Setting(this.contentEl).addButton((button) => {
			button.buttonEl.dataset.ssm = 'template-save';
			button.setButtonText('Save template').setCta().onClick(async () => {
			try { await this.plugin.saveTemplate({ name, body }); this.close(); this.saved(); } catch (error) { showError(error); }
			});
		}).addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}
	onClose(): void { this.contentEl.empty(); }
}
