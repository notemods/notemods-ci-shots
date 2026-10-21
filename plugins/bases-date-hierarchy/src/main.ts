import { Notice, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, resetPro, SPONSORS } from './pro';
import { DateHierarchySettingTab } from './settings';
import { DateHierarchyView, VIEW_ID, viewOptions } from './view';

export default class BasesDateHierarchyPlugin extends Plugin {
	settings: Record<string, never> = {};
	pro: SponsorsManager | null = null;
	onload(): void {
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new DateHierarchySettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.registerHoverLinkSource(VIEW_ID, { display: 'Date hierarchy', defaultMod: true });
		const registered = this.registerBasesView(VIEW_ID, { name: 'Date hierarchy', icon: 'list-tree', factory: (controller, containerEl) => new DateHierarchyView(controller, containerEl), options: viewOptions });
		if (!registered) new Notice('Date hierarchy could not register. Enable the bases core plugin, then reload this plugin.');
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
}
