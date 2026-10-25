// Commands: copy a GitHub-style heading link, convert the heading links of a note or (Pro) of the vault.
import { Modal, Notice, Setting, type App, type Editor, type TFile } from 'obsidian';
import { applyPlan, githubLink, headingAtLine, planConvertWith, type PlanItem } from './slug';
import type { SlugIndex } from './resolve';

/** Most rows that a preview modal lists. The apply step uses every row. */
const MAX_ROWS = 200;

/** Copies `[Heading](#slug)` for the heading at or above the cursor. Returns the text, or null. */
export async function copyHeadingLink(index: SlugIndex, editor: Editor, file: TFile): Promise<string | null> {
	const note = index.slugsOf(file);
	const i = headingAtLine(
		note.headings.map((h) => h.position.start.line),
		editor.getCursor().line,
	);
	const heading = note.headings[i];
	const slug = note.slugs[i];
	if (!heading || slug === undefined) {
		new Notice('No heading above this line.');
		return null;
	}
	const text = githubLink(heading.heading, slug);
	await navigator.clipboard.writeText(text);
	new Notice(`Copied ${text}`);
	return text;
}

/** The convert plan for the text of the open note. */
export function planForEditor(index: SlugIndex, editor: Editor, file: TFile): { text: string; items: PlanItem[] } {
	const text = editor.getValue();
	return { text, items: planConvertWith(text, index.lookup(file.path)) };
}

/** Applies a plan to the editor in one transaction (one undo). Returns false when the note changed after the plan. */
export function applyToEditor(editor: Editor, text: string, items: readonly PlanItem[]): boolean {
	if (editor.getValue() !== text) return false;
	editor.transaction({
		changes: items.map((it) => ({ from: editor.offsetToPos(it.from), to: editor.offsetToPos(it.to), text: it.new })),
	});
	return true;
}

/** A modal that lists the changes and applies them on "Convert". */
export class PreviewModal extends Modal {
	constructor(
		app: App,
		private titleText: string,
		private rows: string[],
		private total: number,
		private onApply: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.titleText);
		const { contentEl } = this;
		contentEl.addClass('gfm-slugs-preview');
		if (this.total === 0) {
			contentEl.createEl('p', { text: 'No heading links to convert.' });
			return;
		}
		contentEl.createEl('p', { text: `${this.total} change${this.total === 1 ? '' : 's'}. One undo reverts the changes in an open note.` });
		const list = contentEl.createEl('ul', { cls: 'gfm-slugs-preview-list' });
		for (const row of this.rows.slice(0, MAX_ROWS)) list.createEl('li', { text: row });
		if (this.rows.length > MAX_ROWS) contentEl.createEl('p', { text: `${this.rows.length - MAX_ROWS} more rows are not shown.` });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText('Convert')
					.setCta()
					.onClick(() => {
						this.close();
						void this.onApply();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Rows for the preview of one note. */
export function planRows(items: readonly PlanItem[]): string[] {
	return items.map((it) => `Line ${it.line + 1}: ${it.old} to ${it.new}`);
}

export interface VaultPlan {
	files: { file: TFile; count: number }[];
	total: number;
}

/** Pro: the count of changes for each note of the vault. Reads each note once, one note at a time. */
export async function planVault(app: App, index: SlugIndex, shouldStop: () => boolean): Promise<VaultPlan> {
	const files: { file: TFile; count: number }[] = [];
	let total = 0;
	for (const file of app.vault.getMarkdownFiles()) {
		if (shouldStop()) break;
		const text = await app.vault.cachedRead(file);
		if (!text.includes('](') || !text.includes('#')) continue;
		const count = planConvertWith(text, index.lookup(file.path)).length;
		if (count > 0) {
			files.push({ file, count });
			total += count;
		}
	}
	return { files, total };
}

/** Pro: converts each note. The plan is made again inside vault.process from the text on disk, so no edit is lost. */
export async function applyVault(app: App, index: SlugIndex, plan: VaultPlan, shouldStop: () => boolean): Promise<number> {
	let changed = 0;
	for (const { file } of plan.files) {
		if (shouldStop()) break;
		await app.vault.process(file, (data) => {
			const items = planConvertWith(data, index.lookup(file.path));
			changed += items.length;
			return items.length ? applyPlan(data, items) : data;
		});
	}
	return changed;
}
