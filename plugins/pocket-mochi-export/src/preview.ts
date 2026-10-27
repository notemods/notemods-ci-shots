import { Modal, Setting, type App } from 'obsidian';
import type { ExportPlan } from './mochi';

/** The preview lines: card count, decks, missing images and warnings. Pure, so tests can read it. */
export function previewLines(plan: ExportPlan, target: string): { label: string; items: string[] }[] {
	const out: { label: string; items: string[] }[] = [
		{ label: 'Cards', items: [String(plan.cardCount)] },
		{ label: plan.decks.length === 1 ? 'Deck' : 'Decks', items: plan.decks.map((d) => `${d.name} (${d.cards} card${d.cards === 1 ? '' : 's'})`) },
		{ label: 'Images', items: [String(plan.media.length)] },
		{ label: 'File', items: [target] },
	];
	const parent = plan.deckData.find((d) => plan.deckData.some((child) => child.parentId === d.id));
	if (parent) out.splice(1, 0, { label: 'Parent deck', items: [parent.name] });
	if (plan.missing.length) out.push({ label: 'Missing attachments', items: plan.missing });
	if (plan.warnings.length) out.push({ label: 'Warnings', items: plan.warnings });
	return out;
}

/** Shows what the export will write. Resolves true on Export, false on Cancel or close. */
export class PreviewModal extends Modal {
	private done = false;

	constructor(
		app: App,
		private readonly plan: ExportPlan,
		private readonly target: string,
		private readonly resolve: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Export to a .mochi file');
		this.contentEl.addClass('pocket-mochi-export-preview');
		for (const part of previewLines(this.plan, this.target)) {
			const sec = this.contentEl.createDiv({ cls: 'pocket-mochi-export-section' });
			sec.createDiv({ cls: 'pocket-mochi-export-label', text: part.label });
			const ul = sec.createEl('ul');
			for (const item of part.items) ul.createEl('li', { text: item });
		}
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(false)))
			.addButton((b) =>
				b
					.setButtonText('Export')
					.setCta()
					.onClick(() => this.finish(true)),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.done) {
			this.done = true;
			this.resolve(false);
		}
	}

	private finish(ok: boolean): void {
		if (!this.done) {
			this.done = true;
			this.resolve(ok);
		}
		this.close();
	}
}

/** Opens the preview and waits for the answer. */
export function confirmExport(app: App, plan: ExportPlan, target: string): Promise<boolean> {
	return new Promise((resolve) => new PreviewModal(app, plan, target, resolve).open());
}
