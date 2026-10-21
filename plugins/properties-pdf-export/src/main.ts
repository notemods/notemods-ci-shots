import { debounce, MarkdownView, Plugin, type MarkdownPostProcessorContext } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro } from './pro';
import { DEFAULT_SETTINGS, normalizeSettings, propertyRows, layoutFor, type HeaderOptions } from './header';
import { renderHeader } from './render';
import { PropertiesPdfExportSettingTab } from './settings';

export default class PropertiesPdfExportPlugin extends Plugin {
	settings: HeaderOptions = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private stopped = false;
	private readonly scheduleRefresh = debounce(() => this.refresh(), 300, true);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		this.pro.init();
		bindPro(this.pro);
		this.register(this.pro.onChange(() => this.refresh()));
		this.addSettingTab(new PropertiesPdfExportSettingTab(this.app, this));
		this.registerMarkdownPostProcessor((el, ctx) => this.process(el, ctx), 100);
		this.addCommand({
			id: 'toggle-header-preview', name: 'Toggle printable header preview',
			callback: async () => { this.settings.preview = !this.settings.preview; await this.saveSettings(); },
		});
		this.app.workspace.onLayoutReady(() => { if (!this.stopped) { void this.pro?.refresh(); this.refresh(); } });
	}

	async process(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
		// Reading sections are detached while core invokes post processors. Let core
		// attach them before selecting the first content section. Core awaits this promise.
		await Promise.resolve();
		// Core PDF rendering processes the whole document and supplies no section info.
		// Own the print root directly so a hidden frontmatter wrapper cannot hide the header.
		const printRoot = el.closest<HTMLElement>('.print .markdown-preview-view');
		const section = ctx.getSectionInfo(el);
		let owner: HTMLElement = el;
		if (printRoot) {
			owner = printRoot;
		} else {
			// The preview renderer owns its direct section children. Keep the header
			// inside the first content section, after the hidden frontmatter section.
			if (el.matches('.mod-frontmatter, .mod-ui')) return;
			const sizer = el.parentElement;
			const firstSection = sizer?.classList.contains('markdown-preview-sizer') &&
				Array.from(sizer.children).find(child => !child.matches('.ppe-header, .mod-header, .mod-footer, .markdown-preview-pusher, .mod-frontmatter, .mod-ui')) === el;
			if (section?.lineStart !== 0 && !firstSection) return;
		}
		owner.querySelectorAll(':scope > .ppe-header').forEach(header => header.remove());
		const rows = propertyRows(ctx.frontmatter as unknown, this.settings);
		if (!rows.length) return;
		owner.prepend(renderHeader(owner, rows, layoutFor(ctx.sourcePath, this.settings, isPro()), this.settings.preview));
	}

	refresh(): void {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
		});
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> { this.settings = normalizeSettings(this.settings); await this.saveData(this.settings); this.scheduleRefresh(); }
	onunload(): void { this.stopped = true; this.scheduleRefresh.cancel(); bindPro(null); this.refresh(); }
}
