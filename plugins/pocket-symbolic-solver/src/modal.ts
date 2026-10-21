import { Modal, Notice, Setting, SuggestModal, finishRenderMath, loadMathJax, renderMath, type App, type ButtonComponent, type Editor } from 'obsidian';
import { isPro } from './pro';
import type { SolveReply } from './protocol';
import { searchHistory, type HistoryEntry } from './settings';
import type PocketSymbolicSolverPlugin from './main';

export function needsPro(feature: string): void {
	new Notice(`${feature} is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
}

/**
 * Puts a block (the Pro table) under the last line of the selection. The selected text does not change.
 * A blank line goes before the block, and also after it when text follows: in Markdown, a line directly
 * under a table is a row of that table.
 */
export function insertBlockBelow(editor: Pick<Editor, 'getCursor' | 'getLine' | 'lineCount' | 'replaceRange'>, block: string): void {
	const from = editor.getCursor('from');
	const to = editor.getCursor('to');
	const line = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
	const next = line + 1 < editor.lineCount() ? editor.getLine(line + 1) : '';
	editor.replaceRange(`\n\n${block}${next.trim() ? '\n' : ''}`, { line, ch: editor.getLine(line).length });
}

/** Modal state: the editor does not change before the user taps Insert or Insert table. */
export class SolveModal extends Modal {
	equation: string;
	symbol: string;
	/** The last solve result for the current equation and symbol, or null. */
	result: SolveReply | null = null;
	/** True while a solve runs in the worker. */
	busy = false;
	table = '';
	private resultEl!: HTMLElement;
	private insertBtn!: ButtonComponent;
	private equationInput!: HTMLInputElement;
	private symbolInput!: HTMLInputElement;
	private tableBtn: ButtonComponent | null = null;
	/** Changes on each solve, so an old reply cannot overwrite a new one. */
	private seq = 0;

	constructor(
		app: App,
		private readonly plugin: PocketSymbolicSolverPlugin,
		private readonly editor: Editor,
		init: { equation: string; symbol: string; solve?: boolean },
	) {
		super(app);
		this.equation = init.equation;
		this.symbol = init.symbol;
		this.autoSolve = init.solve ?? false;
	}

	private readonly autoSolve: boolean;

	onOpen(): void {
		this.plugin.openModal = this;
		this.setTitle('Solve for a symbol');
		this.modalEl.addClass('pss-modal');
		const { contentEl } = this;
		contentEl.empty();

		if (isPro() && this.plugin.data.saved.length) {
			new Setting(contentEl)
				.setName('Saved equation')
				.setDesc('Load an equation that you saved.')
				.addDropdown((dd) => {
					dd.addOption('', 'Choose');
					for (const [i, s] of this.plugin.data.saved.entries()) dd.addOption(String(i), s.name);
					dd.selectEl.addClass('pss-saved');
					dd.onChange((v) => {
						const s = this.plugin.data.saved[Number(v)];
						if (!v || !s) return;
						this.setInputs(s.equation, s.symbol);
					});
				});
		}

		new Setting(contentEl)
			.setName('Equation')
			.setDesc('Use * for products and ^ for powers. Without "=", the plugin solves expression = 0.')
			.addText((t) => {
				t.setValue(this.equation).setPlaceholder('Equation');
				t.inputEl.addClass('pss-equation');
				t.inputEl.setAttr('autocapitalize', 'off');
				t.inputEl.setAttr('autocorrect', 'off');
				t.inputEl.spellcheck = false;
				t.onChange((v) => this.changed(v, this.symbol));
				this.equationInput = t.inputEl;
			});
		new Setting(contentEl)
			.setName('Symbol')
			.setDesc('The symbol to solve for. The other symbols stay as parameters.')
			.addText((t) => {
				t.setValue(this.symbol).setPlaceholder('Symbol');
				t.inputEl.addClass('pss-symbol');
				t.inputEl.setAttr('autocapitalize', 'off');
				t.inputEl.setAttr('autocorrect', 'off');
				t.inputEl.spellcheck = false;
				t.onChange((v) => this.changed(this.equation, v));
				this.symbolInput = t.inputEl;
			});
		for (const el of [this.equationInput, this.symbolInput]) {
			el.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter' && !ev.isComposing) {
					ev.preventDefault();
					void this.solve();
				}
			});
		}

		new Setting(contentEl)
			.addButton((b) => {
				b.setButtonText('Solve')
					.setCta()
					.onClick(() => void this.solve());
				b.buttonEl.addClass('pss-solve');
			})
			.addButton((b) => {
				b.setButtonText('Insert')
					.setDisabled(true)
					.onClick(() => this.insert());
				b.buttonEl.addClass('pss-insert');
				this.insertBtn = b;
			})
			.addButton((b) => {
				b.setButtonText('Cancel').onClick(() => this.close());
				b.buttonEl.addClass('pss-cancel');
			});
		// The result is under the buttons, so a long preview does not move them.
		this.resultEl = contentEl.createDiv({ cls: 'pss-result' });

		if (isPro()) this.renderPro(contentEl);
		else contentEl.createDiv({ cls: 'pss-pro-hint setting-item-description', text: 'Pro adds saved equations, named parameter sets, tables of results and history search.' });

		window.setTimeout(() => (this.equation ? this.symbolInput : this.equationInput).focus(), 0);
		if (this.autoSolve) void this.solve();
	}

	onClose(): void {
		if (this.plugin.openModal === this) this.plugin.openModal = null;
		this.contentEl.empty();
	}

	private renderPro(el: HTMLElement): void {
		el.createEl('h3', { text: 'Pro tools', cls: 'pss-pro-heading' });
		let saveName = '';
		new Setting(el)
			.setName('Save this equation')
			.setDesc('Save the equation and the symbol with a name.')
			.addText((t) => {
				t.setPlaceholder('Name').onChange((v) => (saveName = v));
				t.inputEl.addClass('pss-save-name');
			})
			.addButton((b) => {
				b.setButtonText('Save').onClick(() => {
					void this.plugin.saveEquation(saveName || this.equation, this.equation, this.symbol).then(() => new Notice(`Saved "${saveName || this.equation}"`));
				});
				b.buttonEl.addClass('pss-save');
			});

		new Setting(el)
			.setName('Parameter values')
			.setDesc('First line: parameter names. Next lines: values. Use commas or tabs between values.')
			.addTextArea((t) => {
				t.setPlaceholder('F, m\n10, 2\n9, 3').setValue(this.table);
				t.inputEl.addClass('pss-table');
				t.inputEl.rows = 4;
				t.inputEl.spellcheck = false;
				t.onChange((v) => (this.table = v));
			});
		const pick = new Setting(el).setName('Parameter set').setDesc('Load a named set of parameter values, or save the values above with a name.');
		pick.addDropdown((dd) => {
			dd.addOption('', 'Choose');
			for (const [i, s] of this.plugin.data.paramSets.entries()) dd.addOption(String(i), s.name);
			dd.selectEl.addClass('pss-param-pick');
			dd.onChange((v) => {
				const s = this.plugin.data.paramSets[Number(v)];
				if (!v || !s) return;
				this.table = s.table;
				const ta = this.contentEl.querySelector<HTMLTextAreaElement>('.pss-table');
				if (ta) ta.value = s.table;
			});
		});
		let setName = '';
		pick.addText((t) => {
			t.setPlaceholder('Set name').onChange((v) => (setName = v));
			t.inputEl.addClass('pss-set-name');
		});
		pick.addButton((b) => {
			b.setButtonText('Save set').onClick(() => {
				if (!setName.trim() || !this.table.trim()) {
					new Notice('Type a set name and parameter values first');
					return;
				}
				void this.plugin.saveParamSet(setName.trim(), this.table).then(() => new Notice(`Saved the parameter set "${setName.trim()}"`));
			});
			b.buttonEl.addClass('pss-save-set');
		});
		new Setting(el).addButton((b) => {
			b.setButtonText('Insert table')
				.setDisabled(true)
				.onClick(() => void this.insertTable());
			b.buttonEl.addClass('pss-insert-table');
			this.tableBtn = b;
		});
	}

	setInputs(equation: string, symbol: string): void {
		this.equationInput.value = equation;
		this.symbolInput.value = symbol;
		this.changed(equation, symbol);
	}

	private changed(equation: string, symbol: string): void {
		this.equation = equation;
		this.symbol = symbol;
		if (this.result || this.busy) {
			this.result = null;
			this.busy = false;
			this.seq++;
			this.resultEl.empty();
			this.resultEl.dataset.state = '';
			this.syncButtons();
		}
	}

	private syncButtons(): void {
		const ok = this.result?.ok === true;
		// ButtonComponent.setDisabled, not buttonEl.disabled: the component ignores clicks while its own flag is set.
		this.insertBtn.setDisabled(!ok);
		this.tableBtn?.setDisabled(!ok);
	}

	/** Solves in the worker and shows the result. The note does not change. */
	async solve(): Promise<SolveReply> {
		const seq = ++this.seq;
		this.busy = true;
		this.result = null;
		this.syncButtons();
		this.resultEl.empty();
		this.resultEl.dataset.state = 'busy';
		this.resultEl.createDiv({ cls: 'pss-busy setting-item-description', text: 'Solving' });
		const r = await this.plugin.runner.solve(this.equation, this.symbol);
		if (seq !== this.seq) return r;
		this.busy = false;
		this.result = r;
		await this.showResult(r);
		if (seq !== this.seq) return r;
		this.syncButtons();
		// Tests and screenshots wait for this state: the preview, the note and the buttons are final.
		this.resultEl.dataset.state = 'done';
		if (r.ok && r.insert) await this.plugin.recordHistory(this.equation, this.symbol, r.insert);
		return r;
	}

	private async showResult(r: SolveReply): Promise<void> {
		this.resultEl.empty();
		if (!r.ok) {
			this.resultEl.createDiv({ cls: 'pss-error', text: r.error });
			return;
		}
		await loadMathJax();
		const list = this.resultEl.createDiv({ cls: 'pss-solutions' });
		const sym = r.insert?.match(/^\$\$(.*?) = /)?.[1] ?? r.symbol;
		r.solutions.forEach((s, i) => {
			const row = list.createDiv({ cls: 'pss-solution' });
			if (r.solutions.length > 1) row.createSpan({ cls: 'pss-index', text: `${i + 1}.` });
			row.appendChild(renderMath(`${sym} = ${s.tex}`, true));
			row.createDiv({ cls: 'pss-text', text: `${r.symbol} = ${s.text}` });
		});
		await finishRenderMath();
		const notes: string[] = [`${r.solutions.length} ${r.solutions.length === 1 ? 'solution' : 'solutions'}.`];
		if (r.complex) notes.push('Some solutions are complex: i is the imaginary unit.');
		if (r.family) notes.push(`${/n_0/.test(r.solutions[0]?.text ?? '') ? 'n_0' : 'k'} is an integer.`);
		if (r.params.length) notes.push(`Parameters: ${r.params.join(', ')}.`);
		this.resultEl.createDiv({ cls: 'pss-note setting-item-description', text: notes.join(' ') });
	}

	/** Replaces the selection with the math. Only the Insert button calls this. */
	insert(): boolean {
		if (!this.result?.ok || !this.result.insert) return false;
		this.editor.replaceSelection(this.result.insert);
		this.close();
		return true;
	}

	/** Pro: puts each row of values into the solutions and inserts a Markdown table under the selection. */
	async insertTable(): Promise<boolean> {
		if (!isPro()) {
			needsPro('Tables of results');
			return false;
		}
		const r = this.result;
		if (!r?.ok) return false;
		const t = await this.plugin.runner.table(this.equation, r.symbol, r.solutions.map((s) => s.text), this.table);
		if (!t.ok || !t.markdown) {
			new Notice(t.error ?? 'Cannot make the table');
			return false;
		}
		insertBlockBelow(this.editor, t.markdown);
		this.close();
		return true;
	}
}

/** Pro: search the solve history and open a solve again. */
export class HistoryModal extends SuggestModal<HistoryEntry> {
	constructor(
		app: App,
		private readonly plugin: PocketSymbolicSolverPlugin,
		private readonly onPick: (h: HistoryEntry) => void,
	) {
		super(app);
		this.setPlaceholder('Search solves by equation, symbol or result');
		this.emptyStateText = 'No solve in the history matches.';
	}

	getSuggestions(query: string): HistoryEntry[] {
		return searchHistory(this.plugin.data.history, query);
	}

	renderSuggestion(h: HistoryEntry, el: HTMLElement): void {
		el.addClass('pss-history-item');
		el.createDiv({ text: `${h.equation}   (solve for ${h.symbol})` });
		el.createDiv({ cls: 'pss-history-result', text: `${h.result}   ${new Date(h.at).toLocaleString()}` });
	}

	onChooseSuggestion(h: HistoryEntry): void {
		this.onPick(h);
	}
}
