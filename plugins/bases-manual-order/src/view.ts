import { BasesView, Modal, Notice, setIcon, type App, type TFile, type BasesAllOptions, type BasesEntry, type QueryController } from 'obsidian';
import { DEFAULT_PROPERTY, planMove, rankProperty, sortRows, type RankWrite, type Row } from './order';
import { isPro, onProChange } from './pro';
export function viewOptions(): BasesAllOptions[] {
	return [
		{ type: 'dropdown', key: 'manualLayout', displayName: 'Layout', default: 'table', options: { table: 'Table', list: 'List' } },
		{ type: 'text', key: 'manualRank', displayName: 'Rank property (custom names need Pro)', default: 'manual_order', placeholder: 'manual_order' },
	];
}
export class ManualOrderView extends BasesView {
	type = 'bases-manual-order';
	private readonly root: HTMLElement;
	private busy = false;
	private dragged: { id: string; group: number } | null = null;
	constructor(controller: QueryController, container: HTMLElement) {
		super(controller); this.root = container.createDiv({ cls: 'bmo-view' });
	}
	onload(): void { this.register(onProChange(() => this.onDataUpdated())); }
	onunload(): void { this.root.empty(); }
	private rows(entries: BasesEntry[], property: string): Row[] {
		return entries.filter(e => e.file.extension === 'md').map(e => ({ id: e.file.path, rank: this.app.metadataCache.getFileCache(e.file)?.frontmatter?.[property] as unknown }));
	}
	onDataUpdated(): void {
		if (this.busy || !this.data) return;
		const active = this.root.doc.activeElement;
		const focused = active && this.root.contains(active) ? active.getAttribute('aria-label') : null;
		this.root.empty();
		let property: string;
		try { property = rankProperty(this.config.get('manualRank'), true); }
		catch (error) { this.root.createEl('p', { text: String(error) }); return; }
		this.root.createEl('p', { cls: 'bmo-hint', text: `Drag a handle onto a row to place it before that row. Rank: ${property}. Up and down buttons also work on mobile.` });
		const locked = property !== DEFAULT_PROPERTY && !isPro();
		if (locked) this.root.createEl('p', { text: 'This custom ordering is read-only until you reconnect your sponsoring account. Its rank property is unchanged.' });
		const list = this.config.get('manualLayout') === 'list';
		const groups = this.data.groupedData;
		if (!this.data.data.length) this.root.createEl('p', { text: 'No notes match this base. Change its filters to show notes.' });
		groups.forEach((group, groupIndex) => {
			const section = this.root.createDiv({ cls: 'bmo-group' });
			if (group.hasKey()) section.createEl('h3', { text: group.key?.toString() ?? 'No group' });
			const movable = sortRows(this.rows(group.entries, property));
			const rows = [...movable, ...group.entries.filter(e => e.file.extension !== 'md').map(e => ({ id: e.file.path, rank: undefined }))];
			const byPath = new Map(group.entries.map(e => [e.file.path, e]));
			const table = section.createEl('table', { cls: list ? 'bmo-table bmo-list' : 'bmo-table' });
			const columns = list ? [] : this.config.getOrder().filter(p => p !== 'file.name');
			const head = table.createEl('thead').createEl('tr');
			for (const label of ['Move', 'Note', ...columns.map(p => this.config.getDisplayName(p))]) head.createEl('th', { text: label, attr: { scope: 'col' } });
			const body = table.createEl('tbody');
			rows.forEach((row, index) => {
				const entry = byPath.get(row.id)!;
				const tr = body.createEl('tr', { attr: { 'data-path': row.id } });
				const controls = tr.createEl('td', { cls: 'bmo-controls' });
				if (!locked && entry.file.extension === 'md') {
					const handle = controls.createEl('button', { text: '⠿', attr: { 'aria-label': `Drag ${entry.file.basename}`, title: 'Drag to reorder', draggable: 'true', tabindex: '-1', 'aria-hidden': 'true' } });
					handle.addEventListener('dragstart', event => {
						this.dragged = { id: row.id, group: groupIndex };
						tr.addClass('bmo-dragging');
						event.dataTransfer?.setData('text/plain', row.id);
						if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
					});
					handle.addEventListener('dragend', () => { this.dragged = null; tr.removeClass('bmo-dragging'); this.root.querySelectorAll('.bmo-drop-target').forEach(el => el.removeClass('bmo-drop-target')); });
					tr.addEventListener('dragover', event => { if (this.dragged?.group === groupIndex) { event.preventDefault(); this.root.querySelectorAll('.bmo-drop-target').forEach(el => el.removeClass('bmo-drop-target')); tr.addClass('bmo-drop-target'); } });
					tr.addEventListener('drop', event => {
						event.preventDefault(); const drag = this.dragged; this.dragged = null;
						if (drag?.group === groupIndex) void this.move(groupIndex, drag.id, row.id, property);
					});
					const up = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': `Move ${entry.file.basename} up` } });
					setIcon(up, 'arrow-up');
					up.disabled = index === 0;
					up.addEventListener('click', () => void this.move(groupIndex, row.id, rows[index - 1]!.id, property));
					const down = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': `Move ${entry.file.basename} down` } });
					setIcon(down, 'arrow-down');
					down.disabled = index === movable.length - 1;
					down.addEventListener('click', () => void this.move(groupIndex, row.id, movable[index + 2]?.id ?? null, property));
				}
				const link = tr.createEl('td').createEl('a', { text: entry.file.basename, href: entry.file.path, cls: 'internal-link', attr: { 'data-href': entry.file.path } });
				link.addEventListener('mouseover', event => this.app.workspace.trigger('hover-link', { event, source: this.type, hoverParent: this, targetEl: link, linktext: entry.file.path, sourcePath: '' }));
				link.addEventListener('click', event => { event.preventDefault(); void this.app.workspace.openLinkText(entry.file.path, '', event.ctrlKey || event.metaKey); });
				for (const column of columns) tr.createEl('td', { text: entry.getValue(column)?.toString() ?? '' });
			});
		});
		if (focused) Array.from(this.root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.getAttribute('aria-label') === focused)?.focus();
	}
	confirmMove(count: number): Promise<boolean> {
		return new Promise(resolve => new RankConfirmModal(this.app, count, resolve).open());
	}
	async move(groupIndex: number, source: string, before: string | null, property: string): Promise<void> {
		if (this.busy) return;
		this.busy = true; this.root.setAttribute('aria-busy', 'true');
		const written: { file: TFile; write: RankWrite; hadProperty: boolean }[] = [];
		try {
			if (property !== DEFAULT_PROPERTY && !isPro()) throw new Error('Connect Pro before changing this custom ordering.');
			if (property !== rankProperty(this.config.get('manualRank'), true)) throw new Error('The rank property changed. Try again.');
			const group = this.data.groupedData[groupIndex];
			if (!group) throw new Error('The group changed. Try again.');
			const writes = planMove(this.rows(group.entries, property), source, before);
			if (writes.length > 10 && !await this.confirmMove(writes.length)) return;
			if (property !== DEFAULT_PROPERTY && !isPro()) throw new Error('Pro changed during confirmation. Try again.');
			if (property !== rankProperty(this.config.get('manualRank'), true)) throw new Error('The rank property changed. Try again.');
			// Check every file before writing. processFrontMatter then checks for edits made since the plan.
			const files = writes.map(w => {
				const file = this.app.vault.getFileByPath(w.id);
				if (!file || file.extension !== 'md') throw new Error('Only Markdown notes can store ranks.');
				return { file, write: w };
			});
			for (const { file, write } of files) {
				let hadProperty = false;
				await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
					if (frontmatter[property] !== write.previous) throw new Error('A rank changed during this move. Try again.');
					hadProperty = Object.prototype.hasOwnProperty.call(frontmatter, property);
					frontmatter[property] = write.rank;
				});
				written.push({ file, write, hadProperty });
			}
		} catch (error) {
			const failed: string[] = [];
			for (const { file, write, hadProperty } of [...written].reverse()) {
				try {
					await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
						if (frontmatter[property] !== write.rank) throw new Error('Rank changed since this move.');
						if (hadProperty) frontmatter[property] = write.previous;
						else delete frontmatter[property];
					});
				} catch { failed.push(file.path); }
			}
			const recovery = failed.length ? ` Could not restore: ${failed.join(', ')}. Check these notes before retrying.` : ` Restored ${written.length} notes to their previous ranks.`;
			new Notice(`Could not complete the move:${recovery} ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.busy = false; this.root.removeAttribute('aria-busy'); this.onDataUpdated();
		}
	}
}

export class RankConfirmModal extends Modal {
	private accepted = false;
	constructor(app: App, private readonly count: number, private readonly done: (accepted: boolean) => void) { super(app); }
	onOpen(): void {
		this.setTitle('Confirm rank updates');
		this.contentEl.createEl('p', { text: `This move updates ${this.count} notes. Obsidian will re-serialize their frontmatter. Continue?` });
		const cancel = this.contentEl.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
		const confirm = this.contentEl.createEl('button', { text: `Update ${this.count} notes`, cls: 'mod-cta' });
		confirm.addEventListener('click', () => { this.accepted = true; this.close(); });
		cancel.focus();
	}
	onClose(): void { this.contentEl.empty(); this.done(this.accepted); }
}
