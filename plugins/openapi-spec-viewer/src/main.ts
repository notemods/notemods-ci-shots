import { Modal, Notice, Plugin, Setting, normalizePath, type TFile } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro, proNotice } from './pro';
import { ReferenceSettings, normalizeSaved, type Saved } from './settings';
import { endpointMarkdown, type Endpoint } from './model';
import { ReferenceView, VIEW_TYPE } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class LocalApiPlugin extends Plugin {
	settings: Saved = { bookmarks: [], filters: [] };
	pro: SponsorsManager | null = null;
	readonly views = new Set<ReferenceView>();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.settings = normalizeSaved(await this.loadData() as unknown);
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		this.pro = pro;
		pro.init();
		bindPro(pro);
		const tab = new ReferenceSettings(this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => { tab.update(); for (const view of this.views) view.render(); }));
		this.registerView(VIEW_TYPE, (leaf) => new ReferenceView(leaf, this));
		this.addCommand({ id: 'open-reference', name: 'Open local API file', callback: () => new FilePicker(this).open() });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
	async openFile(path: string): Promise<void> {
		try { await this.app.workspace.getLeaf('tab').setViewState({ type: VIEW_TYPE, active: true, state: { path } }); }
		catch { new Notice('Could not open the reference view.'); }
	}
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	async bookmark(source: string, endpoint: string): Promise<boolean> {
		if (!isPro()) { proNotice('Endpoint bookmarks need pro.'); return false; }
		const next = this.settings.bookmarks.slice();
		const index = next.findIndex((b) => b.source === source && b.endpoint === endpoint);
		if (index < 0) next.push({ source, endpoint }); else next.splice(index, 1);
		try { await this.saveData({ ...this.settings, bookmarks: next }); this.settings.bookmarks = next; return true; }
		catch { new Notice('Could not save the bookmark.'); return false; }
	}
	async saveFilter(name: string, tag: string): Promise<boolean> {
		if (!isPro()) { proNotice('Named tag filters need pro.'); return false; }
		if (!name.trim() || !tag) { new Notice('Enter a name and select a tag.'); return false; }
		const filters = this.settings.filters.filter((f) => f.name !== name.trim());
		filters.push({ name: name.trim(), tag });
		try { await this.saveData({ ...this.settings, filters }); this.settings.filters = filters; return true; }
		catch { new Notice('Could not save the filter.'); return false; }
	}
	async exportEndpoint(endpoint: Endpoint, source: string): Promise<TFile | null> {
		if (!isPro()) { proNotice('Endpoint notes need pro.'); return null; }
		const stem = `API ${endpoint.id}`.replace(/[^\p{L}\p{N} _-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
		for (let index = 0; index < 1000; index++) {
			const path = normalizePath(`${stem}${index ? ` ${index + 1}` : ''}.md`);
			if (this.app.vault.getAbstractFileByPath(path)) continue;
			try {
				const file = await this.app.vault.create(path, endpointMarkdown(endpoint, source));
				new Notice(`Created ${path}`);
				return file;
			} catch {
				if (this.app.vault.getAbstractFileByPath(path)) continue;
				new Notice('Could not write the endpoint note.'); return null;
			}
		}
		new Notice('No unused endpoint note name was found.'); return null;
	}
}
class FilePicker extends Modal {
	constructor(private readonly owner: LocalApiPlugin) { super(owner.app); }
	onOpen(): void {
		this.setTitle('Open local API file');
		const files = this.app.vault.getFiles().filter((f) => /^(json|ya?ml)$/i.test(f.extension)).sort((a, b) => a.path.localeCompare(b.path));
		const search = this.contentEl.createEl('input', { type: 'search', attr: { placeholder: 'Filter vault files', 'aria-label': 'Filter vault files' } });
		const list = this.contentEl.createDiv({ cls: 'lar-file-list' });
		const render = () => {
			list.empty();
			const filtered = files.filter((f) => f.path.toLowerCase().includes(search.value.toLowerCase()));
			if (!filtered.length) list.createEl('p', { text: 'No JSON or YAML files found in the vault.' });
			for (const file of filtered) new Setting(list).setName(file.path).addButton((button) => button.setButtonText('Open').onClick(() => { this.close(); void this.owner.openFile(file.path); }));
		};
		search.addEventListener('input', render); render();
	}
	onClose(): void { this.contentEl.empty(); }
}
