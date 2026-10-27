import { BasesView, Modal, Setting, getFrontMatterInfo, parseYaml, type App, type QueryController } from 'obsidian';
import type BasesMultiEditPlugin from './main';
import { transform, validateAction, type Action } from './edit';
import { previewChanges, FIND_DESCRIPTION, FRONTMATTER_WARNING, VALUE_DESCRIPTION } from './preview';
import { isPro, proNotice, SAVE_LEAD } from './pro';
export const VIEW_ID = 'bases-multi-edit';
export function pruneSelection(selected: Set<string>, visible: string[]): void { const allowed = new Set(visible); for (const path of selected) if (!allowed.has(path)) selected.delete(path); }
export class EditView extends BasesView {
	type = VIEW_ID;
	selected = new Set<string>();
	private root: HTMLElement;
	constructor(controller: QueryController, container: HTMLElement, private readonly plugin: BasesMultiEditPlugin) { super(controller); this.root = container.createDiv({ cls: 'bme-table-view' }); this.root.dataset.bmeGeneration = plugin.generation; }
	onunload(): void { this.selected.clear(); this.root.empty(); }
	onDataUpdated(): void { this.render(); }
	render(): void {
		if (!this.data) return;
		const rows = this.data.data.filter(e => e.file.extension === 'md');
		pruneSelection(this.selected, rows.map(e => e.file.path));
		this.root.empty();
		const bar = this.root.createDiv({ cls: 'bme-toolbar' });
		const count = bar.createSpan({ text: `${this.selected.size} of ${rows.length} selected` });
		bar.createEl('button', { text: 'Select visible' }).onclick = () => { rows.forEach(e => this.selected.add(e.file.path)); this.render(); };
		bar.createEl('button', { text: 'Clear' }).onclick = () => { this.selected.clear(); this.render(); };
		const edit = bar.createEl('button', { text: 'Edit selected', cls: 'mod-cta' });
		edit.disabled = !this.selected.size;
		edit.onclick = () => new EditModal(this.app, this.plugin, [...this.selected], () => this.data.data.map(e => e.file.path)).open();
		const undo = bar.createEl('button', { text: 'Undo last batch' });
		undo.onclick = async () => { await this.plugin.undo(); };
		this.root.createEl('p', { cls: 'bme-hint', text: 'Selection stays in this view. The current query supplies filters and sort. File and formula columns are read-only.' });
		const table = this.root.createEl('table');
		const head = table.createEl('thead').createEl('tr');
		const columns = this.config.getOrder();
		head.createEl('th', { text: 'Select' }); head.createEl('th', { text: 'Note' });
		for (const col of columns) head.createEl('th', { text: this.config.getDisplayName(col) });
		const body = table.createEl('tbody');
		for (const entry of rows) {
			const row = body.createEl('tr');
			const checkbox = row.createEl('td').createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selected.has(entry.file.path); row.toggleClass('bme-selected', checkbox.checked); checkbox.setAttribute('aria-label', `Select ${entry.file.path}`);
			checkbox.onchange = () => { row.toggleClass('bme-selected', checkbox.checked); if (checkbox.checked) this.selected.add(entry.file.path); else this.selected.delete(entry.file.path); count.setText(`${this.selected.size} of ${rows.length} selected`); edit.disabled = !this.selected.size; };
			const link = row.createEl('td').createEl('a', { text: entry.file.basename, href: '#' });
			link.onclick = e => { e.preventDefault(); void this.plugin.openNote(entry.file); };
			for (const col of columns) row.createEl('td', { text: entry.getValue(col)?.toString() ?? '' });
		}
	}
}
export class EditModal extends Modal {
	action: Action = { property: 'status', operation: 'set', type: 'text', input: 'done' };
	private revision = 0;
	constructor(app: App, private readonly plugin: BasesMultiEditPlugin, private readonly paths: string[], private readonly visiblePaths?: () => string[]) { super(app); }
	onOpen(): void { this.plugin.dialogs.add(this); this.form(); }
	form(): void {
		this.contentEl.empty(); this.setTitle(`Edit ${this.paths.length} selected notes`);
		const preview = this.contentEl.createDiv({ cls: 'bme-preview' });
		const invalidate = () => { this.revision++; preview.empty(); };
		new Setting(this.contentEl).setName('Property').setDesc('Top-level note property only.').addText(t => t.setValue(this.action.property).onChange(v => { this.action.property = v; invalidate(); }));
		let find: Setting | null = null;
		new Setting(this.contentEl).setName('Operation').addDropdown(d => d.addOptions({ set: 'Set value', append: 'Append list items', 'remove-items': 'Remove list items', 'replace-items': 'Replace list items', 'remove-property': 'Remove property' }).setValue(this.action.operation).onChange(v => { this.action.operation = v as Action['operation']; find?.settingEl.toggle(v === 'replace-items'); invalidate(); }));
		new Setting(this.contentEl).setName('Value type').addDropdown(d => d.addOptions({ text: 'Text', number: 'Number', checkbox: 'Checkbox', list: 'List (JSON)' }).setValue(this.action.type).onChange(v => { this.action.type = v as Action['type']; invalidate(); }));
		find = new Setting(this.contentEl).setName('Find items').setDesc(FIND_DESCRIPTION).addText(t => t.setPlaceholder('["draft"]').setValue(this.action.find ?? '').onChange(v => { this.action.find = v; invalidate(); }));
		find.settingEl.toggle(this.action.operation === 'replace-items');
		new Setting(this.contentEl).setName('Value').setDesc(VALUE_DESCRIPTION).addTextArea(t => t.setValue(this.action.input).onChange(v => { this.action.input = v; invalidate(); }));
		// A free user sees Save action and, after a lapsed sponsorship, the saved actions. A select shows the Pro notice.
		if (isPro() || this.plugin.settings.actions.length) {
			new Setting(this.contentEl).setName('Saved action').addDropdown(d => { d.addOption('', 'Choose an action'); this.plugin.settings.actions.forEach((a, i) => { d.addOption(String(i), `${a.operation} ${a.property}: ${a.find ? `${a.find} to ` : ''}${a.input}`); }); d.onChange(v => { if (!isPro()) { d.setValue(''); proNotice(SAVE_LEAD); return; } const a = this.plugin.settings.actions[Number(v)]; if (v !== '' && a) { this.action = { ...a }; this.revision++; this.form(); } }); });
		}
		new Setting(this.contentEl).addButton(b => b.setButtonText('Save action').onClick(async () => { if (!isPro()) { proNotice(SAVE_LEAD); return; } try { validateAction(this.action); transform({ exists: false }, this.action); await this.plugin.saveAction(this.action); preview.setText('Action saved.'); } catch (e) { preview.setText(String(e)); } }));
		new Setting(this.contentEl).addButton(b => b.setButtonText('Preview changes').setCta().onClick(() => { void (async () => {
			const revision = ++this.revision;
			preview.setText('Reading selected notes…');
			const action = { ...this.action };
			try {
				const { changes, messages } = await previewChanges(this.paths, action, async path => {
					if (this.visiblePaths && !this.visiblePaths().includes(path)) throw new Error('Note is no longer in the current query.');
					const file = this.app.vault.getFileByPath(path);
					if (!file || file.extension !== 'md') throw new Error('Markdown note no longer exists.');
					const content = await this.app.vault.read(file); const info = getFrontMatterInfo(content);
					const parsed: unknown = info.exists ? (parseYaml(info.frontmatter) ?? {}) : {};
					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid properties: ${path}`);
					return parsed as Record<string, unknown>;
				}, path => this.plugin.stamp(path));
				if (revision !== this.revision) return;
				preview.empty(); preview.createEl('p', { text: FRONTMATTER_WARNING }); preview.createEl('pre', { text: messages.join('\n\n') });
				const apply = preview.createEl('button', { text: `Apply to ${changes.length} ${changes.length === 1 ? 'note' : 'notes'}`, cls: 'mod-cta' }); apply.disabled = !changes.length;
				apply.onclick = async () => {
					if (revision !== this.revision) return; apply.disabled = true;
					try { const message = await this.plugin.apply(action, changes); if (revision === this.revision) { preview.empty(); preview.createEl('pre', { text: message }); preview.createEl('button', { text: 'Undo last batch' }).onclick = async () => { preview.setText(await this.plugin.undo()); }; } }
					catch (error) { preview.setText(String(error)); }
				};
			} catch (error) { if (revision === this.revision) preview.setText(String(error)); }
		})(); }));
		// Put the preview below the controls.
		this.contentEl.appendChild(preview);
	}
	onClose(): void { this.plugin.dialogs.delete(this); this.revision++; this.contentEl.empty(); }
}
