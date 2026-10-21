import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { incoming, panelStatus, type ResolvedRef } from './scan';
import type FountainReferencePanelPlugin from './main';

export const VIEW_TYPE = 'fountain-reference-panel';

/** The side panel: the references from Fountain scripts to the active Markdown note. */
export class ReferenceView extends ItemView {
	private plugin: FountainReferencePanelPlugin;
	/** The rows of the last render, for tests and the screenshot script. */
	rows: ResolvedRef[] = [];
	/** The last active Markdown note. It stays while a script is active, so a row click does not clear the list. */
	private note: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: FountainReferencePanelPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Fountain references';
	}

	getIcon(): string {
		return 'clapperboard';
	}

	async onOpen(): Promise<void> {
		// Only the note changes here. The scan runs again only when you select Refresh.
		this.registerEvent(this.app.workspace.on('file-open', () => this.render()));
		this.render();
		await Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		await Promise.resolve();
	}

	render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('fountain-reference-panel');
		const file = this.app.workspace.getActiveFile();
		if (file && file.extension === 'md') this.note = file.path;
		else if (!file || file.extension !== 'fountain' || (this.note !== null && !this.app.vault.getFileByPath(this.note))) this.note = null;
		const activePath = this.note;
		const scan = this.plugin.scan;
		this.rows = scan && activePath !== null ? incoming(scan, activePath) : [];

		const bar = el.createDiv({ cls: 'fountain-reference-panel-bar' });
		bar.createDiv({ cls: 'fountain-reference-panel-note', text: activePath ?? 'No Markdown note is open' });
		const refresh = bar.createEl('button', { text: this.plugin.scanning ? 'Scanning...' : 'Refresh', cls: 'fountain-reference-panel-refresh' });
		refresh.disabled = this.plugin.scanning;
		refresh.addEventListener('click', () => void this.plugin.refresh());

		el.createDiv({ cls: 'fountain-reference-panel-status', text: panelStatus(scan, activePath, this.rows, this.plugin.scanFiltered) });
		if (scan && this.plugin.scannedAt) {
			el.createDiv({ cls: 'fountain-reference-panel-time', text: `Saved files scanned at ${this.plugin.scannedAt}. Select Refresh after you save a change to a script.` });
		}

		if (scan && scan.failures.length > 0) {
			const box = el.createDiv({ cls: 'fountain-reference-panel-failures' });
			box.createDiv({ text: 'These scripts could not be read:' });
			const ul = box.createEl('ul');
			for (const f of scan.failures) ul.createEl('li', { text: `${f.path}: ${f.error}` });
		}

		const list = el.createDiv({ cls: 'fountain-reference-panel-list' });
		for (const r of this.rows) {
			const row = list.createDiv({ cls: 'fountain-reference-panel-row' });
			const head = row.createDiv({ cls: 'fountain-reference-panel-row-head' });
			const link = head.createEl('a', { text: r.source, cls: 'fountain-reference-panel-source', href: '#' });
			link.addEventListener('click', (evt) => {
				evt.preventDefault();
				void this.plugin.openSource(r);
			});
			head.createSpan({ cls: 'fountain-reference-panel-line', text: `Line ${r.line}` });
			row.createDiv({ cls: 'fountain-reference-panel-scene', text: r.scene !== '' ? r.scene : 'Before the first scene heading' });
			if (r.before !== '') row.createDiv({ cls: 'fountain-reference-panel-before', text: r.before });
			row.createDiv({ cls: 'fountain-reference-panel-context', text: r.context });
		}
	}
}
