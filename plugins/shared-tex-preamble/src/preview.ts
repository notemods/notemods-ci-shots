import { Modal, SuggestModal, finishRenderMath, loadMathJax, renderMath, type App } from 'obsidian';
import { expand, formatIssue, sampleCall, type Preamble } from './preamble';
import { mathError } from './math';

export interface LibraryChoice {
	/** Library name; empty = the macro file. */
	name: string;
	label: string;
	path: string;
}

export class LibrarySuggestModal extends SuggestModal<LibraryChoice> {
	constructor(
		app: App,
		private readonly choices: LibraryChoice[],
		placeholder: string,
		private readonly onPick: (c: LibraryChoice) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): LibraryChoice[] {
		const q = query.trim().toLowerCase();
		return this.choices.filter((c) => c.label.toLowerCase().includes(q) || c.path.toLowerCase().includes(q));
	}

	renderSuggestion(c: LibraryChoice, el: HTMLElement): void {
		el.createDiv({ text: c.label });
		el.createEl('small', { text: c.path === '' ? 'No file selected' : c.path, cls: 'stp-muted' });
	}

	onChooseSuggestion(c: LibraryChoice): void {
		this.onPick(c);
	}
}

/**
 * Pro: the definitions of a library, a sample of each and the errors. The plugin expands each sample itself
 * and gives only the result to the engine, so the preview adds no definition to the engine.
 */
export class LibraryPreviewModal extends Modal {
	/** Rows that show a math error, for the tests. */
	sampleErrors = 0;

	constructor(
		app: App,
		private readonly choice: LibraryChoice,
		private readonly preamble: Preamble | null,
	) {
		super(app);
	}

	onOpen(): void {
		void this.draw();
	}

	private async draw(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('stp-preview');
		contentEl.dataset.state = 'loading';
		this.setTitle(`Preview: ${this.choice.label}`);
		contentEl.createEl('p', { text: this.choice.path === '' ? 'No file is selected for this library.' : this.choice.path, cls: 'stp-muted' });
		const p = this.preamble;
		if (!p) {
			contentEl.createEl('p', { text: 'The file does not exist or is not a .md, .tex or .sty file.', cls: 'stp-error' });
			contentEl.dataset.state = 'done';
			return;
		}
		const summary = contentEl.createEl('p', { cls: 'stp-summary' });
		if (p.blocked.length > 0) {
			summary.setText(`Rejected: the file has ${p.blocked.length} package command${p.blocked.length === 1 ? '' : 's'}. Reload loads nothing from it.`);
			this.issueList(p.blocked.map(formatIssue));
			contentEl.dataset.state = 'done';
			return;
		}
		const errorList = this.issueList(p.errors.map(formatIssue));
		const table = contentEl.createEl('table', { cls: 'stp-table' });
		const head = table.createEl('thead').createEl('tr');
		for (const h of ['Line', 'Command', 'Sample', 'Result']) head.createEl('th', { text: h });
		const body = table.createEl('tbody');
		await loadMathJax();
		for (const d of p.defs) {
			const row = body.createEl('tr');
			row.createEl('td', { text: String(d.line) });
			row.createEl('td', { text: `\\${d.name}` }).createEl('small', { text: ` ${d.args} arg${d.args === 1 ? '' : 's'}`, cls: 'stp-muted' });
			const call = sampleCall(d);
			row.createEl('td').createEl('code', { text: call });
			const cell = row.createEl('td');
			const x = expand(call, p.defs);
			let message = x.error;
			if (message === null) {
				try {
					const el = renderMath(x.text, false);
					message = mathError(el);
					if (message === null) cell.appendChild(el);
				} catch (e) {
					message = e instanceof Error ? e.message : String(e);
				}
			}
			if (message !== null) {
				this.sampleErrors++;
				cell.createSpan({ text: message, cls: 'stp-error' });
				errorList.createEl('li', { text: `line ${d.line}: \\${d.name}: ${message}` });
			}
		}
		await finishRenderMath();
		const total = p.errors.length + this.sampleErrors;
		summary.setText(`${p.defs.length} definition${p.defs.length === 1 ? '' : 's'}, ${total} error${total === 1 ? '' : 's'}.`);
		errorList.toggleClass('stp-hidden', total === 0);
		contentEl.dataset.state = 'done';
	}

	private issueList(lines: string[]): HTMLUListElement {
		const ul = this.contentEl.createEl('ul', { cls: 'stp-errors' });
		for (const l of lines) ul.createEl('li', { text: l });
		ul.toggleClass('stp-hidden', lines.length === 0);
		return ul;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
