import { Plugin, type Editor } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { HistoryModal, SolveModal, needsPro } from './modal';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { SolverRunner, blobWorkerFactory } from './runner';
import { DEFAULT_SETTINGS, PocketSymbolicSolverSettingTab, addHistory, normalizeData, upsertByName, type PocketSymbolicSolverData } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** The bundled solver worker (src/worker.ts with nerdamer), put in by esbuild.config.mjs. */
declare const PSS_WORKER_SOURCE: string;

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

/** The selection as an equation: one line, without $ signs or backticks around it. */
export function equationFromSelection(sel: string): string {
	return sel
		.replace(/^\s*(?:\$\$?|`)|(?:\$\$?|`)\s*$/g, '')
		.replace(/\s*\n\s*/g, ' ')
		.trim();
}

export default class PocketSymbolicSolverPlugin extends Plugin {
	data: PocketSymbolicSolverData = normalizeData(null);
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Runs solves in a worker. The worker starts at the first solve, not at load. */
	runner = new SolverRunner(blobWorkerFactory(typeof PSS_WORKER_SOURCE === 'string' ? PSS_WORKER_SOURCE : ''), DEFAULT_SETTINGS.timeoutSeconds * 1000);
	/** The open solve modal, for tests and screenshots. */
	openModal: SolveModal | null = null;
	private settingTab: PocketSymbolicSolverSettingTab | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadAll();
		this.runner.timeoutMs = this.data.settings.timeoutSeconds * 1000;
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new PocketSymbolicSolverSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'solve',
			name: 'Solve an equation for a symbol',
			icon: 'sigma',
			editorCallback: (editor: Editor) => {
				this.openSolver(editor);
			},
		});
		this.addCommand({
			id: 'search-history',
			name: 'Search solve history',
			icon: 'history',
			editorCallback: (editor: Editor) => {
				this.openHistory(editor);
			},
		});

		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.runner.stop();
		resetPro();
	}

	/** Opens the solve modal. The equation field holds the selection. */
	openSolver(editor: Editor, init?: { equation: string; symbol: string; solve?: boolean }): SolveModal {
		const modal = new SolveModal(this.app, this, editor, init ?? { equation: equationFromSelection(editor.getSelection()), symbol: 'x' });
		modal.open();
		return modal;
	}

	/** Pro: opens the history search. A pick opens the solve modal with that equation. */
	openHistory(editor: Editor): HistoryModal | null {
		if (!isPro()) {
			needsPro('History search');
			return null;
		}
		const modal = new HistoryModal(this.app, this, (h) => this.openSolver(editor, { equation: h.equation, symbol: h.symbol, solve: true }));
		modal.open();
		return modal;
	}

	async recordHistory(equation: string, symbol: string, result: string): Promise<void> {
		if (!this.data.settings.keepHistory) return;
		this.data.history = addHistory(this.data.history, { equation: equation.trim(), symbol: symbol.trim(), result, at: Date.now() });
		await this.saveAll();
	}

	async clearHistory(): Promise<void> {
		this.data.history = [];
		await this.saveAll();
	}

	async saveEquation(name: string, equation: string, symbol: string): Promise<void> {
		if (!isPro()) {
			needsPro('Saved equations');
			return;
		}
		this.data.saved = upsertByName(this.data.saved, { name: name.trim(), equation: equation.trim(), symbol: symbol.trim() });
		await this.saveAll();
	}

	async saveParamSet(name: string, table: string): Promise<void> {
		if (!isPro()) {
			needsPro('Parameter sets');
			return;
		}
		this.data.paramSets = upsertByName(this.data.paramSets, { name, table });
		await this.saveAll();
	}

	async loadAll(): Promise<void> {
		this.data = normalizeData(await this.loadData());
	}

	async saveAll(): Promise<void> {
		this.runner.timeoutMs = this.data.settings.timeoutSeconds * 1000;
		await this.saveData(this.data);
	}
}
