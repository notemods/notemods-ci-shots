import { Modal, Notice } from 'obsidian';
import type KanbanDraftVaultPlugin from './main';
import { boardLimit, findDrafts, type Draft } from './model';
import { isPro, LIMITS_LEAD, proNotice, proText, SEARCH_LEAD } from './pro';

export async function copyOrSelect(text: string, field: HTMLTextAreaElement, write = (value: string) => navigator.clipboard.writeText(value)): Promise<boolean> {
	try { await write(text); return true; }
	catch { field.value = text; field.focus(); field.select(); return false; }
}

export class RecoveryModal extends Modal {
	private off: (() => void) | null = null;
	private list: HTMLElement | null = null;
	private status: HTMLElement | null = null;
	private retry: HTMLButtonElement | null = null;
	private search: HTMLInputElement | null = null;
	private limitButton: HTMLButtonElement | null = null;
	private lastSettings: unknown = null;
	private lastPro = false;
	constructor(readonly plugin: KanbanDraftVaultPlugin) { super(plugin.app); }
	onOpen(): void {
		this.setTitle('Draft recovery');
		this.modalEl.addClass('kanban-draft-vault-modal');
		this.contentEl.createEl('p', { text: 'Copy text, then paste it where you need it. Check the board before you add a card. Saved text can include a card that you submitted.' });
		const bar = this.contentEl.createDiv({ cls: 'kanban-draft-vault-toolbar' });
		this.status = bar.createSpan({ attr: { role: 'status' } });
		this.retry = bar.createEl('button', { text: 'Retry save' });
		this.retry.addEventListener('click', () => { void this.plugin.saveSettings(); });
		this.limitButton = bar.createEl('button', { text: 'Retention limits (pro)' });
		this.limitButton.addEventListener('click', () => { if (isPro()) new BoardLimitsModal(this.plugin).open(); else proNotice(LIMITS_LEAD); });
		const label = this.contentEl.createEl('label', { text: 'Search across boards (pro)' });
		this.search = label.createEl('input', { type: 'search', placeholder: 'Board path, lane label, or latest text', attr: { 'aria-label': 'Search drafts' } });
		this.search.addEventListener('input', () => this.renderList());
		// A free user can select the search field. It is read-only, and a click or a typed key shows the Pro notice.
		this.search.addEventListener('click', () => this.refuseSearch());
		this.search.addEventListener('keydown', (event) => { if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') this.refuseSearch(); });
		this.list = this.contentEl.createDiv({ cls: 'kanban-draft-vault-list' });
		this.off = this.plugin.onChange(() => this.refresh());
		this.refresh();
	}
	private refresh(): void {
		const pro = isPro();
		if (this.status) this.status.textContent = this.plugin.saves.error ? 'Save failed. Text is in memory.' : this.plugin.saves.busy ? 'Saving drafts…' : 'Saved drafts are up to date.';
		if (this.retry) this.retry.hidden = !this.plugin.saves.error;
		if (this.search) {
			this.search.readOnly = !pro;
			// Without Pro the list ignores the search, so the field shows no text.
			if (!pro) this.search.value = '';
		}
		if (this.lastSettings !== this.plugin.settings || this.lastPro !== pro) {
			this.lastSettings = this.plugin.settings;
			this.lastPro = pro;
			this.renderList();
		}
	}
	private refusedAt = 0;
	/** Shows the Pro notice for the search field. Keys right after a notice show no second notice. */
	private refuseSearch(): void {
		if (isPro() || Date.now() - this.refusedAt < 3000) return;
		this.refusedAt = Date.now();
		proNotice(SEARCH_LEAD);
	}
	private renderList(): void {
		if (!this.list) return;
		this.list.empty();
		const drafts = findDrafts(this.plugin.settings, this.search?.value ?? '', isPro());
		this.list.createEl('p', { text: `${drafts.length} saved draft${drafts.length === 1 ? '' : 's'}`, cls: 'kanban-draft-vault-count' });
		if (!drafts.length) this.list.createEl('p', { text: 'No saved drafts here. Open a board and type in its new-card form. Normal note editors and existing cards are excluded.' });
		for (const draft of drafts) this.renderDraft(draft);
	}
	private renderDraft(draft: Draft): void {
		const row = this.list!.createEl('article', { cls: 'kanban-draft-vault-draft', attr: { 'data-draft-id': draft.id } });
		row.createEl('strong', { text: draft.board, cls: 'kanban-draft-vault-board' });
		row.createEl('p', { text: `Captured lane: ${draft.lane} · ${new Date(draft.updatedAt).toLocaleString()}`, cls: 'kanban-draft-vault-context' });
		const field = row.createEl('textarea', { cls: 'kanban-draft-vault-text', attr: { readonly: '', 'aria-label': 'Draft text', rows: '3' } });
		field.value = draft.text;
		const buttons = row.createDiv({ cls: 'kanban-draft-vault-toolbar' });
		this.copyButton(buttons, draft.text, field, 'Copy');
		const dismiss = buttons.createEl('button', { text: 'Dismiss', attr: { 'aria-label': `Dismiss draft from ${draft.board}` } });
		dismiss.addEventListener('click', () => { dismiss.disabled = true; void this.plugin.dismiss(draft.id); });
		if (isPro() && draft.versions.length) {
			const details = row.createEl('details', { cls: 'kanban-draft-vault-versions' });
			details.createEl('summary', { text: `Saved versions (Pro) · ${draft.versions.length}` });
			for (const version of draft.versions) {
				const group = details.createDiv({ cls: 'kanban-draft-vault-version' });
				group.createEl('p', { text: new Date(version.capturedAt).toLocaleString() });
				const text = group.createEl('textarea', { cls: 'kanban-draft-vault-text', attr: { readonly: '', 'aria-label': 'Saved version text', rows: '2' } });
				text.value = version.text;
				this.copyButton(group, version.text, text, 'Copy version');
			}
		}
	}
	private copyButton(parent: HTMLElement, text: string, field: HTMLTextAreaElement, label: string): void {
		const button = parent.createEl('button', { text: label });
		button.addEventListener('click', () => {
			void (async () => {
				const copied = await copyOrSelect(text, field);
				new Notice(copied ? 'Draft copied. The saved draft is retained.' : 'Clipboard access failed. The complete text is selected. Copy it with your device controls.');
			})();
		});
	}
	onClose(): void { this.off?.(); this.off = null; this.contentEl.empty(); }
}

export class BoardLimitsModal extends Modal {
	constructor(readonly plugin: KanbanDraftVaultPlugin) { super(plugin.app); }
	onOpen(): void {
		this.setTitle('Retention limits (pro)');
		if (!isPro()) { this.contentEl.createEl('p', { text: proText('Changing the retention limits needs Pro.') }); return; }
		this.contentEl.createEl('p', { text: 'Apply removes records above the draft count or age limit. Copy text you need before you reduce a limit. Limits run when you apply them and when new text is captured with pro.' });
		const boards = [...new Set(this.plugin.settings.drafts.map((d) => d.board))].sort();
		if (!boards.length) { this.contentEl.createEl('p', { text: 'Capture a draft on a board first.' }); return; }
		const boardLabel = this.contentEl.createEl('label', { text: 'Board' });
		const select = boardLabel.createEl('select', { attr: { 'aria-label': 'Retention board' } });
		for (const board of boards) select.createEl('option', { text: board, value: board });
		const input = (label: string, max: number): HTMLInputElement => {
			const row = this.contentEl.createEl('label', { text: label, cls: 'kanban-draft-vault-limit' });
			// An empty field must not reach normalizeLimit, which clamps 0 to 1 and removes records.
			return row.createEl('input', { type: 'number', attr: { min: '1', max: String(max), step: '1', required: '', 'aria-label': label } });
		};
		const drafts = input('Saved drafts per board', 500);
		const days = input('Keep drafts for days', 3650);
		const versions = input('Older versions per draft', 50);
		const fill = (): void => {
			const limit = boardLimit(this.plugin.settings, select.value);
			drafts.value = String(limit.drafts); days.value = String(limit.days); versions.value = String(limit.versions);
		};
		select.addEventListener('change', fill);
		fill();
		const apply = this.contentEl.createEl('button', { text: 'Apply limits' });
		apply.addEventListener('click', () => {
			if (![drafts, days, versions].every((field) => field.reportValidity())) return;
			apply.disabled = true;
			void (async () => {
				const saved = await this.plugin.setBoardLimit(select.value, { drafts: Number(drafts.value), days: Number(days.value), versions: Number(versions.value) });
				new Notice(saved ? 'Board limits saved.' : 'Limits could not be saved. Open recovery and retry.');
				this.close();
			})();
		});
	}
	onClose(): void { this.contentEl.empty(); }
}
