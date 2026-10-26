import { FuzzySuggestModal, MarkdownRenderChild, MarkdownView, Notice, Plugin, TFile, parseLinktext, type App, type Editor, type MarkdownFileInfo } from 'obsidian';
import { createGitHubSponsors, guardSponsorsPro } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { ID_RE, dataRows, findMarkedLine, markedRows, removeUnusedAnchors, rowAnchor } from './rows';
import { DEFAULT_SETTINGS, normalizeSettings, TableRowLinksSettingTab, type TableRowLinksSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

const PRO_TICK_MS = 6 * 60 * 60 * 1000;

interface RowItem { id: string; line: number; label: string; path?: string }

export default class TableRowLinksPlugin extends Plugin {
	settings: TableRowLinksSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new TableRowLinksSettingTab(this.app, this);
		this.register(pro.onChange(() => tab.update()));
		this.addSettingTab(tab);
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
		this.addCommand({
			id: 'copy-row-link', name: 'Copy link to this table row',
			editorCheckCallback: (checking, editor, ctx) => {
				const available = !!ctx.file && dataRows(editor.getValue().split('\n')).includes(editor.getCursor().line);
				if (available && !checking) void this.copyRowLink(editor, ctx.file);
				return available;
			},
		});
		this.addCommand({
			id: 'jump-to-row', name: 'Jump to table row...',
			editorCallback: (editor) => new RowJumpModal(this.app, markedRows(editor.getValue()), (row) => this.position(editor, row.line)).open(),
		});
		this.addCommand({ id: 'jump-to-row-vault', name: 'Jump to table row in vault (pro)', callback: guardSponsorsPro(pro, () => void this.searchVault()) });
		this.addCommand({ id: 'remove-unused-anchors', name: 'Remove unused row anchors (pro)', editorCallback: guardSponsorsPro(pro, (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => void this.removeUnused(editor, ctx.file)) });
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
			if (!this.settings.editorMenu || !info.file || !dataRows(editor.getValue().split('\n')).includes(editor.getCursor().line)) return;
			menu.addItem((item) => item.setTitle('Copy link to this table row').setIcon('link').onClick(() => void this.copyRowLink(editor, info.file!)));
		}));
		this.registerObsidianProtocolHandler('table-row', (params) => void this.openRow(params));
		this.registerMarkdownPostProcessor(async (el, ctx) => {
			const child = new MarkdownRenderChild(el);
			ctx.addChild(child);
			// Resolve candidate row links before their click. Native block links keep their normal behavior.
			for (const anchor of Array.from(el.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) {
				const link = parseLinktext(anchor.getAttribute('data-href') ?? '');
				const id = link.subpath.startsWith('#^') ? link.subpath.slice(2) : '';
				if (!ID_RE.test(id)) continue;
				const file = link.path ? this.app.metadataCache.getFirstLinkpathDest(link.path, ctx.sourcePath) : this.app.vault.getAbstractFileByPath(ctx.sourcePath);
				if (!(file instanceof TFile) || findMarkedLine(await this.app.vault.cachedRead(file), id) < 0) continue;
				anchor.classList.add('table-row-links-anchor');
				child.registerDomEvent(el, 'click', (event) => {
					if (!event.composedPath().includes(anchor)) return;
					if (!isPro() || event.button !== 0) return;
					event.preventDefault(); event.stopImmediatePropagation();
					void this.openRow({ file: file.path, row: id }, event.ctrlKey || event.metaKey);
				}, { capture: true });
			}
		});
	}

	onunload(): void { resetPro(); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<TableRowLinksSettings> | null); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }

	async copyRowLink(editor: Editor, file: TFile): Promise<void> {
		const line = editor.getCursor().line;
		const result = rowAnchor(editor.getValue().split('\n'), line, this.app.vault.getName(), file.path);
		if (!result.available) return;
		if (result.changed) editor.setLine(line, result.line);
		try {
			await navigator.clipboard.writeText(result.link);
			new Notice('Copied the table row link');
		} catch { new Notice('Could not copy the row link. The anchor is saved; try the copy command again.'); }
	}

	position(editor: Editor, line: number): void {
		editor.setCursor({ line, ch: 0 });
		editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
		editor.focus();
	}

	async openRow(params: Record<string, string>, newTab = false): Promise<void> {
		const path = params.file ?? '';
		const id = params.row ?? '';
		const file = this.app.vault.getAbstractFileByPath(path);
		if ((params.vault && params.vault !== this.app.vault.getName()) || !(file instanceof TFile) || file.extension !== 'md') {
			new Notice(`File not found: ${path}`); return;
		}
		try {
			const leaf = this.app.workspace.getLeaf(newTab ? 'tab' : false);
			await leaf.openFile(file, { state: { mode: 'source', source: true }, active: true });
			if (!(leaf.view instanceof MarkdownView)) return;
			const line = findMarkedLine(leaf.view.editor.getValue(), id);
			this.position(leaf.view.editor, Math.max(0, line));
			if (line < 0) new Notice(`Row anchor ${id} not found in ${path}`);
		} catch { new Notice(`Could not open table row in ${path}`); }
	}

	async searchVault(): Promise<void> {
		if (!isPro()) return;
		const rows: RowItem[] = [];
		for (const file of this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path))) {
			const active = this.app.workspace.getActiveViewOfType(MarkdownView);
			const text = active?.file === file ? active.editor.getValue() : await this.app.vault.cachedRead(file);
			rows.push(...markedRows(text).map((row) => ({ ...row, path: file.path })));
		}
		if (!isPro()) return;
		new RowJumpModal(this.app, rows, (row) => {
			if (isPro()) void this.openRow({ file: row.path!, row: row.id });
		}).open();
	}

	/** Keep URI, row-style wikilink and Markdown link references from Markdown notes in this vault. */
	async removeUnused(editor: Editor, file: TFile | null): Promise<void> {
		if (!isPro() || !file) return;
		const before = editor.getValue();
		const keep = new Set<string>();
		for (const source of this.app.vault.getMarkdownFiles()) {
			const text = source === file ? before : await this.app.vault.cachedRead(source);
			// A bare URI can end before punctuation. An HTML link can encode its ampersands.
			for (const m of text.matchAll(/obsidian:\/\/table-row\?[^\s)<>"']+/g)) {
				try {
					const p = new URL(m[0].replace(/&amp;/g, '&')).searchParams;
					const row = /^[a-z0-9]{6}(?![a-z0-9])/.exec(p.get('row') ?? '')?.[0];
					if (row && p.get('file') === file.path && (!p.get('vault') || p.get('vault') === this.app.vault.getName())) keep.add(row);
				} catch { /* Invalid links do not retain an anchor. */ }
			}
			// A wikilink in a table cell escapes its alias pipe. A Markdown link can encode its path.
			for (const m of text.matchAll(/\[\[([^\]\n]*?)#\^([a-z0-9]{6})(?:\\?\|[^\]\n]*)?\]\]|\]\(\s*<?([^()<>\n]*?)#\^([a-z0-9]{6})>?\s*\)/g)) {
				let path = m[1] ?? m[3] ?? '';
				if (m[3] !== undefined) {
					try { path = decodeURIComponent(path); } catch { /* Keep the raw path. */ }
				}
				const target = path ? this.app.metadataCache.getFirstLinkpathDest(path, source.path) : source;
				if (target?.path === file.path) keep.add(m[2] ?? m[4]!);
			}
		}
		if (!isPro()) return;
		if (editor.getValue() !== before) { new Notice('The note changed during the scan. Run the command again.'); return; }
		const result = removeUnusedAnchors(before, keep);
		if (result.removed) editor.setValue(result.text);
		new Notice(`Removed ${result.removed} unused row anchors`);
	}
}

export class RowJumpModal extends FuzzySuggestModal<RowItem> {
	constructor(app: App, private readonly rows: RowItem[], private readonly pick: (row: RowItem) => void) {
		super(app);
		this.setPlaceholder('Find a marked table row');
		this.modalEl.addClass('table-row-links-modal');
	}
	getItems(): RowItem[] { return this.rows; }
	getItemText(item: RowItem): string { return `${item.label}${item.path ? ` — ${item.path}` : ''} (line ${item.line + 1}, ${item.id})`; }
	onChooseItem(item: RowItem): void { this.pick(item); }
}
