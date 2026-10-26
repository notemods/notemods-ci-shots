import { MarkdownView, Notice, Plugin, finishRenderMath, loadMathJax, renderMath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { engineSource, extractTex, formatIssue, isPreambleExtension, parsePreamble, type Issue, type Preamble } from './preamble';
import { SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { DEFAULT_SETTINGS, SharedTexPreambleSettingTab, normalizeSettings, type SharedTexPreambleSettings } from './settings';
import { mathError } from './math';
import { LibraryPreviewModal, LibrarySuggestModal, type LibraryChoice } from './preview';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** The most issues that one notice lists. */
const NOTICE_ISSUES = 3;
/** Notice time in ms for a problem, so there is time to read the line numbers. */
const PROBLEM_NOTICE_MS = 10_000;

export interface LoadResult {
	/** ok = definitions loaded; the other values = nothing loaded. */
	status: 'ok' | 'no-path' | 'missing' | 'wrong-type' | 'empty' | 'rejected';
	path: string;
	/** Definitions that the engine accepted. */
	loaded: string[];
	/** Problems in the file or from the engine. */
	errors: Issue[];
	/** Reading views that were drawn again. */
	refreshed: number;
}

/** Reads a file and parses it as a preamble. */
export function preambleOf(text: string, file: TFile): Preamble {
	return parsePreamble(extractTex(text, file.extension));
}

export default class SharedTexPreamblePlugin extends Plugin {
	settings: SharedTexPreambleSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** The result of the last load, for the settings and the tests. */
	last: LoadResult | null = null;
	private settingTab: SharedTexPreambleSettingTab | null = null;
	/** Each load waits for the previous one, so two loads never give definitions to the engine at the same time. */
	private queue: Promise<unknown> = Promise.resolve();
	/** Commands that this plugin gave the engine. A \providecommand can define them again at a reload. */
	private defined = new Set<string>();

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
		this.settingTab = new SharedTexPreambleSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'reload',
			name: 'Reload the macro file',
			callback: () => void this.reload('command'),
		});
		this.addCommand({
			id: 'select-library',
			name: 'Select a macro library',
			callback: () => this.chooseLibrary(),
		});
		this.addCommand({
			id: 'preview-library',
			name: 'Preview a macro library',
			callback: () => this.choosePreview(),
		});

		this.app.workspace.onLayoutReady(() => {
			void this.reload('startup');
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<SharedTexPreambleSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The path to load: the active library with Pro, else the macro file. */
	activePath(): string {
		const s = this.settings;
		if (isPro() && s.active !== '') {
			const lib = s.libraries.find((l) => l.name === s.active);
			if (lib) return lib.path;
		}
		return s.path;
	}

	/** The name of the active source, for notices. */
	activeName(): string {
		return isPro() && this.settings.active !== '' ? `library "${this.settings.active}"` : 'macro file';
	}

	statusText(): string {
		const r = this.last;
		if (!r) return 'Load the macro file again and draw open Reading views again.';
		if (r.status !== 'ok') return `Last load: nothing loaded from "${r.path}".`;
		return `Last load: ${r.loaded.length} definition${r.loaded.length === 1 ? '' : 's'} from "${r.path}", ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}.`;
	}

	needsPro(feature: string): void {
		proNotice(`${feature} is a pro feature.`);
	}

	/** Loads the active file into the engine and draws open Reading views again. Startup shows a notice only for a problem. */
	reload(reason: 'startup' | 'command'): Promise<LoadResult> {
		const next = this.queue.then(() => this.loadActive(reason));
		this.queue = next.catch(() => undefined);
		return next;
	}

	private async loadActive(reason: 'startup' | 'command'): Promise<LoadResult> {
		const path = this.activePath();
		const result = await this.loadPath(path);
		this.last = result;
		this.settingTab?.update();
		this.report(result, reason);
		return result;
	}

	private async loadPath(path: string): Promise<LoadResult> {
		const base = { path, loaded: [] as string[], errors: [] as Issue[], refreshed: 0 };
		if (path === '') return { ...base, status: 'no-path' };
		const file = this.app.vault.getFileByPath(path);
		if (!file) return { ...base, status: 'missing' };
		if (!isPreambleExtension(file.extension)) return { ...base, status: 'wrong-type' };
		const p = preambleOf(await this.app.vault.read(file), file);
		// A package or file command rejects the whole file before the engine sees it, so no package is downloaded.
		if (p.blocked.length > 0) return { ...base, status: 'rejected', errors: p.blocked };
		if (p.defs.length === 0 && p.errors.length === 0) return { ...base, status: 'empty' };
		const errors = [...p.errors];
		const loaded: string[] = [];
		if (p.defs.length > 0) {
			await loadMathJax();
			const inFile = new Set<string>();
			for (const d of p.defs) {
				let message: string | null;
				let keep = false;
				try {
					// \providecommand keeps a command of this file or of the engine, as in LaTeX.
					keep = d.kind === 'providecommand' && (inFile.has(d.name) || (!this.defined.has(d.name) && !this.isUndefined(d.name)));
					message = keep ? null : mathError(renderMath(engineSource(d), false));
				} catch (e) {
					message = e instanceof Error ? e.message : String(e);
				}
				inFile.add(d.name);
				if (message === null) {
					loaded.push(d.name);
					if (!keep) this.defined.add(d.name);
				} else errors.push({ line: d.line, message: `\\${d.name}: ${message}` });
			}
			await finishRenderMath();
		}
		errors.sort((a, b) => a.line - b.line);
		const refreshed = loaded.length > 0 ? this.refreshReadingViews() : 0;
		return { ...base, status: 'ok', loaded, errors, refreshed };
	}

	/** True when the engine does not know the command. */
	private isUndefined(name: string): boolean {
		return mathError(renderMath(`\\${name}`, false))?.startsWith('Undefined control sequence') ?? false;
	}

	/** Draws each open Reading view again, so its math uses the new definitions. Returns the count. */
	refreshReadingViews(): number {
		let n = 0;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview') {
				view.previewMode.rerender(true);
				n++;
			}
		}
		return n;
	}

	private report(r: LoadResult, reason: 'startup' | 'command'): void {
		const name = this.activeName();
		const list = (issues: Issue[]) => {
			const shown = issues.slice(0, NOTICE_ISSUES).map(formatIssue).join('\n');
			return issues.length > NOTICE_ISSUES ? `${shown}\nand ${issues.length - NOTICE_ISSUES} more.` : shown;
		};
		switch (r.status) {
			case 'no-path':
				if (reason === 'command') new Notice(`${this.manifest.name}: select a macro file in the plugin settings.`);
				return;
			case 'missing':
				new Notice(`Shared TeX Preamble: the ${name} "${r.path}" does not exist. No file was created. Select a file in the plugin settings.`, PROBLEM_NOTICE_MS);
				return;
			case 'wrong-type':
				new Notice(`Shared TeX Preamble: "${r.path}" is not a .md, .tex or .sty file.`, PROBLEM_NOTICE_MS);
				return;
			case 'empty':
				new Notice(`Shared TeX Preamble: "${r.path}" has no macro definitions. Add a line such as \\newcommand{\\R}{\\mathbb{R}}.`, PROBLEM_NOTICE_MS);
				return;
			case 'rejected':
				new Notice(`Shared TeX Preamble: "${r.path}" was rejected and nothing was loaded. Remove the package commands:\n${list(r.errors)}`, PROBLEM_NOTICE_MS);
				return;
			case 'ok': {
				const head = `Shared TeX Preamble: loaded ${r.loaded.length} definition${r.loaded.length === 1 ? '' : 's'} from "${r.path}".`;
				if (r.errors.length > 0) {
					new Notice(`${head} ${r.errors.length} parse error${r.errors.length === 1 ? '' : 's'}:\n${list(r.errors)}`, PROBLEM_NOTICE_MS);
				} else if (reason === 'command') {
					new Notice(`${head} Refreshed ${r.refreshed} Reading view${r.refreshed === 1 ? '' : 's'}.`);
				}
				return;
			}
		}
	}

	/** Pro: the libraries to choose from, with the macro file first. */
	libraryChoices(): LibraryChoice[] {
		return [{ name: '', label: 'Macro file', path: this.settings.path }, ...this.settings.libraries.map((l) => ({ name: l.name, label: l.name, path: l.path }))];
	}

	/** Pro: select the active library, then load it. */
	chooseLibrary(): void {
		if (!isPro()) {
			this.needsPro('Named libraries');
			return;
		}
		new LibrarySuggestModal(this.app, this.libraryChoices(), 'Select the library to load', (c) => void this.selectLibrary(c.name)).open();
	}

	async selectLibrary(name: string): Promise<LoadResult | null> {
		if (!isPro()) {
			this.needsPro('Named libraries');
			return null;
		}
		if (name !== '' && !this.settings.libraries.some((l) => l.name === name)) return null;
		this.settings.active = name;
		await this.saveSettings();
		this.settingTab?.update();
		return this.reload('command');
	}

	/** Pro: choose a library, then preview it. */
	choosePreview(): void {
		if (!isPro()) {
			this.needsPro('Library preview');
			return;
		}
		new LibrarySuggestModal(this.app, this.libraryChoices(), 'Select the library to preview', (c) => void this.preview(c)).open();
	}

	/** Pro: opens the preview of one library. Defines nothing in the engine. */
	async preview(choice: LibraryChoice): Promise<LibraryPreviewModal | null> {
		if (!isPro()) {
			this.needsPro('Library preview');
			return null;
		}
		const file = choice.path === '' ? null : this.app.vault.getFileByPath(choice.path);
		const p = file && isPreambleExtension(file.extension) ? preambleOf(await this.app.vault.read(file), file) : null;
		const modal = new LibraryPreviewModal(this.app, choice, p);
		modal.open();
		return modal;
	}
}
