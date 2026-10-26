import { Editor, FuzzySuggestModal, Notice, Plugin, TFile, type App } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { applyEdit, type EditResult } from './board';
import type { ViewCard } from './embed';
import { tasksBridge } from './tasks';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, KanbanEmbedSettingTab, normalizeSettings, type KanbanEmbedSettings } from './settings';
import { BLOCK_ID, BoardEmbed } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

const REASONS: Record<string, string> = {
	stale: 'The board changed since the embed was drawn. The embed is drawn again; try once more.',
	missing: 'That card or lane is no longer in the board file.',
	'no-checkbox': 'This card has no checkbox.',
	empty: 'Type some text for the card first.',
};

/** True when a note's frontmatter marks it as a board of the Kanban plugin. */
export function isBoardFile(app: App, file: TFile): boolean {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	return fm !== undefined && fm['kanban-plugin'] !== undefined;
}

class BoardSuggest extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly boards: TFile[],
		private readonly pick: (f: TFile) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a board to embed');
	}
	getItems(): TFile[] {
		return this.boards;
	}
	getItemText(f: TFile): string {
		return f.path;
	}
	onChooseItem(f: TFile): void {
		this.pick(f);
	}
}

export default class KanbanEmbedPlugin extends Plugin {
	settings: KanbanEmbedSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Embeds on screen. An embed adds itself on load and removes itself on unload. */
	readonly embeds = new Set<BoardEmbed>();
	private settingTab: KanbanEmbedSettingTab | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new KanbanEmbedSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerHoverLinkSource(BLOCK_ID, { display: 'Kanban Embed', defaultMod: true });
		this.registerMarkdownCodeBlockProcessor(BLOCK_ID, (source, el, ctx) => {
			ctx.addChild(new BoardEmbed(this, el, source, ctx.sourcePath));
		});
		this.addCommand({
			id: 'insert-board-embed',
			name: 'Insert a board embed',
			editorCallback: (editor: Editor, ctx) => this.pickBoard(editor, ctx.file?.path ?? ''),
		});
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	private pickBoard(editor: Editor, sourcePath: string): void {
		const boards = this.app.vault
			.getMarkdownFiles()
			.filter((f) => isBoardFile(this.app, f))
			.sort((a, b) => a.path.localeCompare(b.path));
		if (boards.length === 0) {
			new Notice('No board found. A board is a note with kanban-plugin in its frontmatter.');
			return;
		}
		new BoardSuggest(this.app, boards, (f) => {
			const link = this.app.metadataCache.fileToLinktext(f, sourcePath, true);
			editor.replaceSelection(`\`\`\`${BLOCK_ID}\nboard: [[${link}]]\n\`\`\`\n`);
		}).open();
	}

	/** Runs one change on a board file. Shows why when the change cannot be made; embeds redraw on modify. */
	async edit(path: string, change: (md: string) => EditResult): Promise<boolean> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice(`The board ${path} is gone.`);
			return false;
		}
		let result: EditResult = { ok: false, reason: 'missing' };
		await this.app.vault.process(file, (md) => {
			result = change(md);
			return result.ok ? result.md : md;
		});
		const r = result as EditResult;
		if (!r.ok) {
			new Notice(REASONS[r.reason] ?? 'The card could not be changed.');
			for (const e of this.embeds) e.schedule(0);
		}
		return r.ok;
	}

	/** Free: checks or unchecks a card in its board file. With the Tasks plugin on, a finished card gets the Tasks done date, as in Kanban. */
	toggle(path: string, card: ViewCard, checked: boolean): Promise<boolean> {
		return this.edit(path, (md) => applyEdit(md, { type: 'toggle', lane: card.lane, card: card.index, expect: card.raw, checked }, tasksBridge(this.app, path)));
	}

	/** Pro: moves a card to place `index` of lane `lane` in the same board file. */
	async move(path: string, card: ViewCard, lane: number, index: number): Promise<boolean> {
		if (!isPro()) {
			BoardEmbed.needsPro('Moving cards');
			return false;
		}
		return this.edit(path, (md) => applyEdit(md, { type: 'move', lane: card.lane, card: card.index, expect: card.raw, toLane: lane, index }, tasksBridge(this.app, path)));
	}

	/** Pro: adds a card at the end of a lane. */
	async add(path: string, lane: number, text: string): Promise<boolean> {
		if (!isPro()) {
			BoardEmbed.needsPro('Adding cards');
			return false;
		}
		return this.edit(path, (md) => applyEdit(md, { type: 'add', lane, text }, tasksBridge(this.app, path)));
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<KanbanEmbedSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const e of this.embeds) e.schedule(0);
	}

	/** Remembers which swimlane rows of one embed are folded. Does not redraw: the row already changed on screen. */
	async saveCollapsed(key: string, rows: string[]): Promise<void> {
		const next = { ...this.settings.collapsedRows };
		if (rows.length > 0) next[key] = rows;
		else delete next[key];
		this.settings = normalizeSettings({ ...this.settings, collapsedRows: next });
		await this.saveData(this.settings);
	}
}
