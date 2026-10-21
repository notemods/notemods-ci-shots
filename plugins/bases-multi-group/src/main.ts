import { Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, resetPro, SPONSORS } from './pro';
import { MultiGroupSettingTab } from './settings';
import { MultiGroupView, VIEW_ID, viewOptions } from './view';

export default class BasesMultiGroupPlugin extends Plugin {
	settings: Record<string, never> = {};
	pro: SponsorsManager | null = null;
	onload(): void {
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new MultiGroupSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.registerBasesView(VIEW_ID, { name: 'Multi group', icon: 'list-tree', factory: (controller, containerEl) => new MultiGroupView(controller, containerEl), options: viewOptions });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
}
