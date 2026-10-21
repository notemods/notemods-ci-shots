import { Plugin, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, isPro, resetPro, SPONSORS } from './pro';
import { MAX_BYTES, combineResults, report, runQuery, validateExpression } from './query';
import { normalizeSettings, QuerySettingTab, type QuerySettings, type SavedQuery } from './settings';
import { QueryView, VIEW_ID } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export default class QueryPlugin extends Plugin {
	settings: QuerySettings = { saved: [] };
	pro: SponsorsManager | null = null;
	readonly views = new Set<QueryView>();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.settings = normalizeSettings(await this.loadData());
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new QuerySettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => { tab.update(); for (const v of this.views) v.clearResult(); }));
		this.registerView(VIEW_ID, (leaf) => new QueryView(leaf, this));
		this.addCommand({ id: 'open-query', name: 'Open JSON query view', callback: () => { void this.openView(); } });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => { void pro.refresh(); }, 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
	async openView(): Promise<QueryView> {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_ID)[0] ?? this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_ID, active: true });
		await this.app.workspace.revealLeaf(leaf);
		if (!(leaf.view instanceof QueryView)) throw new Error('Could not open the query view.');
		return leaf.view;
	}
	async saveQuery(query: SavedQuery): Promise<void> {
		query = { ...query, name: query.name.trim() };
		if (!query.name) throw new Error('Enter a query name.');
		validateExpression(query.expression);
		if (!this.settings.saved.some((q) => q.name === query.name) && this.settings.saved.length >= 100) throw new Error('The limit is 100 saved queries.');
		const next = [...this.settings.saved.filter((q) => q.name !== query.name), { ...query, name: query.name.trim() }];
		await this.saveData({ saved: next });
		this.settings.saved = next;
	}
	async deleteQuery(name: string): Promise<void> {
		const next = this.settings.saved.filter((q) => q.name !== name);
		await this.saveData({ saved: next }); this.settings.saved = next;
	}
	async queryFile(path: string, expression: string): Promise<unknown> {
		validateExpression(expression);
		const file = this.app.vault.getFileByPath(normalizePath(path.trim()));
		if (!file) throw new Error(`Input file is absent: ${path}`);
		if (file.stat.size > MAX_BYTES) throw new Error('Input exceeds 5 MiB.');
		return runQuery(await this.app.vault.read(file), file.path, expression);
	}
	async queryFiles(paths: string[], expression: string): Promise<unknown[]> {
		if (!isPro()) throw new Error('Several files need Pro. Sponsor on GitHub, then sign in from the plugin settings.');
		if (!paths.length || paths.length > 20) throw new Error('Choose 1 to 20 files.');
		const values: unknown[] = [];
		for (const path of [...new Set(paths)]) { if (!isPro()) throw new Error('Pro is off.'); values.push(await this.queryFile(path, expression)); }
		return combineResults(values);
	}
	async writeReport(value: unknown, kind: 'csv' | 'md', title: string): Promise<TFile> {
		if (!isPro()) throw new Error('Reports need Pro. Sponsor on GitHub, then sign in from the plugin settings.');
		if (!title.trim() || /[\\/:*?"<>|#^[\]]/.test(title) || title === '.' || title === '..') throw new Error('Enter a report name without path characters.');
		const path = normalizePath(`${title.trim()}.${kind}`);
		if (this.app.vault.getAbstractFileByPath(path)) throw new Error('The report file exists. Choose a new name.');
		return this.app.vault.create(path, report(value, kind));
	}
}
