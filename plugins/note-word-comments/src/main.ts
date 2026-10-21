import { MarkdownView, Notice, Plugin, TFile, type Editor, type MarkdownFileInfo } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import type { NoteSource, PlanOptions } from './export';
import { PickNotesModal, PreviewModal } from './modals';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, NoteWordCommentsSettingTab, normalizeSettings, type NoteWordCommentsSettings } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export function needsPro(feature: string): void {
	new Notice(`${feature} is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
}

export default class NoteWordCommentsPlugin extends Plugin {
	settings: NoteWordCommentsSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Vault path of the last DOCX file that this session wrote. */
	lastExport: string | null = null;
	private settingTab: NoteWordCommentsSettingTab | null = null;

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
		this.settingTab = new NoteWordCommentsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'export-active-note',
			name: 'Export the active note to a docx file',
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx.file;
				if (!file) return;
				this.previewActive(file, editor.getValue());
			},
		});

		this.addCommand({
			id: 'export-folder-notes',
			name: 'Join notes of this folder in one docx file',
			editorCallback: (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx.file;
				if (file) this.pickNotes(file);
			},
		});

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	/** Parse options from the settings and the Pro state. */
	planOptions(): PlanOptions {
		const pro = isPro();
		return { author: this.settings.author.trim() || DEFAULT_SETTINGS.author, pro, labels: pro && this.settings.authorLabels };
	}

	/** Opens the preview for one note with the text of its editor. Returns the modal. */
	previewActive(file: TFile, text: string): PreviewModal {
		const modal = new PreviewModal(this, [{ file, text }]);
		modal.open();
		return modal;
	}

	/** Pro: opens the note picker for the Markdown notes in the folder of file. */
	pickNotes(file: TFile): PickNotesModal | null {
		if (!isPro()) {
			needsPro('Joining several notes');
			return null;
		}
		const folder = file.parent;
		const files = (folder?.children ?? []).filter((f): f is TFile => f instanceof TFile && f.extension === 'md').sort((a, b) => a.basename.localeCompare(b.basename));
		const name = folder && folder.path !== '/' ? folder.name : this.app.vault.getName();
		const modal = new PickNotesModal(this, files, name);
		modal.open();
		return modal;
	}

	/** Current text of each file. An open editor of the file gives its unsaved text. */
	async readSources(files: TFile[]): Promise<NoteSource[]> {
		const open = new Map<string, string>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file) open.set(leaf.view.file.path, leaf.view.editor.getValue());
		});
		const out: NoteSource[] = [];
		for (const file of files) out.push({ file, text: open.get(file.path) ?? (await this.app.vault.cachedRead(file)) });
		return out;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<NoteWordCommentsSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
