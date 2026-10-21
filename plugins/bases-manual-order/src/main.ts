import { Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, resetPro } from './pro';
import { BasesManualOrderSettingTab } from './settings';
import { ManualOrderView, viewOptions } from './view';
export default class BasesManualOrderPlugin extends Plugin {
	pro: SponsorsManager | null = null;
	onload(): void {
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new BasesManualOrderSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.registerHoverLinkSource('bases-manual-order', { display: 'Bases Manual Order', defaultMod: true });
		this.registerBasesView('bases-manual-order', {
			name: 'Manual order', icon: 'list-ordered',
			factory: (controller, container) => new ManualOrderView(controller, container),
			options: viewOptions,
		});
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { resetPro(); }
}
