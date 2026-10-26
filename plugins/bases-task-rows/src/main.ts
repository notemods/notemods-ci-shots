import { Notice, Plugin, TFile, TFolder, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, onProChange, setProSource } from './pro';
import { DEFAULT_SETTINGS, BasesTaskRowsSettingTab, normalizeSettings, type BasesTaskRowsSettings } from './settings';
import { editTaskLine, nextOccurrenceLine, type TaskEdit } from './task';
import { TaskRowsView, VIEW_TYPE, viewOptions } from './view';
import { PROGRESS_VIEW_NAME, PROGRESS_VIEW_TYPE, TaskProgressView, progressViewOptions } from './progress-view';
import { applyLineEdits, type LineEdit } from './write';
import type { TaskRow } from './rows';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export interface EditOutcome {
	written: number;
	conflicts: number;
}

/** Text of a new base file that shows the tasks of one folder, and a Task progress view with one row per note. */
export function taskBaseText(folder: string): string {
	const filter = folder === '/' || folder === '' ? '' : `filters:\n  and:\n    - file.inFolder(${JSON.stringify(folder)})\n`;
	return `${filter}views:\n  - type: ${VIEW_TYPE}\n    name: Tasks\n    status: open\n    rowSort: due\n  - type: ${PROGRESS_VIEW_TYPE}\n    name: ${PROGRESS_VIEW_NAME}\n    progressSort: progress\n`;
}

export default class BasesTaskRowsPlugin extends Plugin {
	settings: BasesTaskRowsSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** False when the Bases core plugin is off, so the view could not be registered. */
	basesReady = false;
	readonly views = new Set<TaskRowsView>();
	readonly progressViews = new Set<TaskProgressView>();
	private settingTab: BasesTaskRowsSettingTab | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		setProSource(pro);
		this.register(
			onProChange(() => {
				this.refreshViews();
				this.settingTab?.update();
			}),
		);
		this.settingTab = new BasesTaskRowsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.basesReady = this.registerBasesView(VIEW_TYPE, {
			name: 'Task rows',
			icon: 'list-checks',
			factory: (controller, containerEl) => new TaskRowsView(controller, containerEl, this),
			options: () => viewOptions(),
		});
		const progressReady = this.registerBasesView(PROGRESS_VIEW_TYPE, {
			name: PROGRESS_VIEW_NAME,
			icon: 'percent',
			factory: (controller, containerEl) => new TaskProgressView(controller, containerEl, this),
			options: () => progressViewOptions(),
		});
		this.basesReady = this.basesReady && progressReady;

		this.addCommand({
			id: 'create-task-base',
			name: 'Create a task base for the current folder',
			callback: () => void this.createTaskBase(),
		});

		this.app.workspace.onLayoutReady(() => {
			void this.reopenStaleBases();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		setProSource(null);
		this.views.clear();
		this.progressViews.clear();
	}

	/**
	 * After a plugin update or reload, Bases keeps showing the task views of the old plugin code, and they stop
	 * following note edits. This opens each such base tab again, so its view runs the current code. A first start finds none.
	 */
	async reopenStaleBases(): Promise<number> {
		let n = 0;
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const el = leaf.view.containerEl;
			const stale = el.querySelector('.btr-view') !== null && ![...this.views, ...this.progressViews].some((v) => el.contains(v.rootEl));
			if (!stale) continue;
			const state = leaf.getViewState();
			await leaf.setViewState({ type: 'empty' });
			await leaf.setViewState(state);
			n++;
		}
		return n;
	}

	/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
	isPro(): boolean {
		return this.pro?.isPro() ?? false;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	refreshViews(): void {
		for (const v of this.views) v.render();
		for (const v of this.progressViews) v.render();
	}

	/**
	 * Writes one edit to each row's source line. Each file is changed in one vault.process call, and a line is
	 * replaced only when it still reads exactly as the view read it. Changed lines are skipped with a notice.
	 */
	async editRows(rows: TaskRow[], edit: TaskEdit): Promise<EditOutcome> {
		const byPath = new Map<string, LineEdit[]>();
		const style = { style: this.settings.dateStyle };
		const full: TaskEdit = edit.type === 'done' || edit.type === 'open' ? { ...edit, doneDate: this.settings.doneDate, ...style } : { ...edit, ...style };
		// After a done tick of a recurring task, the next occurrence goes on the line below (Pro).
		const inserts = new Map<string, { after: number; text: string }[]>();
		for (const row of rows) {
			// A bulk complete can hold closed rows: a cancelled task must not turn done, and a done recurring task must not repeat again.
			if ((edit.type === 'done' && row.info.done) || (edit.type === 'open' && !row.info.done)) continue;
			const next = editTaskLine(row.raw, full);
			if (next === null || next === row.raw) continue;
			const list = byPath.get(row.path) ?? [];
			list.push({ line: row.line, expected: row.raw, next });
			byPath.set(row.path, list);
			if (edit.type === 'done' && this.isPro()) {
				const occurrence = nextOccurrenceLine(row.raw, full.type === 'done' ? full.today : '', style.style ?? 'emoji');
				if (occurrence) {
					const ilist = inserts.get(row.path) ?? [];
					ilist.push({ after: row.line, text: occurrence });
					inserts.set(row.path, ilist);
				}
			}
		}
		let written = 0;
		let conflicts = 0;
		for (const [path, edits] of byPath) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				conflicts += edits.length;
				continue;
			}
			const ins = inserts.get(path);
			await this.app.vault.process(file, (content) => {
				const r = applyLineEdits(content, edits);
				let out = r.content;
				if (r.applied.length && ins?.length) {
					// Insert after the done lines, from the bottom up, so line numbers stay valid.
					const lines = out.split('\n');
					for (const i of [...ins].sort((a, b) => b.after - a.after)) {
						if (r.applied.includes(i.after)) {
							lines.splice(i.after + 1, 0, i.text);
							written++;
						}
					}
					out = lines.join('\n');
				}
				written += r.applied.length;
				conflicts += r.conflicts.length;
				return out;
			});
		}
		if (conflicts) new Notice(`${conflicts} ${conflicts === 1 ? 'task' : 'tasks'} changed in the note since the view read ${conflicts === 1 ? 'it' : 'them'}, so nothing was written for ${conflicts === 1 ? 'it' : 'them'}. The rows are read again.`);
		return { written, conflicts };
	}

	private async createTaskBase(): Promise<void> {
		const active = this.app.workspace.getActiveFile();
		const folder = active?.parent ?? this.app.vault.getRoot();
		const dir = folder instanceof TFolder ? folder.path : '/';
		const prefix = dir === '/' ? '' : `${dir}/`;
		let path = normalizePath(`${prefix}Tasks.base`);
		for (let i = 2; this.app.vault.getAbstractFileByPath(path) && i < 100; i++) path = normalizePath(`${prefix}Tasks ${i}.base`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice('Could not find a free file name for the task base.');
			return;
		}
		const file = await this.app.vault.create(path, taskBaseText(dir));
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
