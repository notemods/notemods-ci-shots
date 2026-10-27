import { Notice, Plugin, type MarkdownPostProcessorContext } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, MAX_PRESETS, displayFor, normalizeSettings, type Settings } from './options';
import { LabelsRenderChild } from './adapter';
import { TaskFieldLabelsSettingTab } from './settings';
import { labelsEditorExtension } from './editor';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class TaskFieldLabelsPlugin extends Plugin {
	settings: Settings = normalizeSettings(DEFAULT_SETTINGS);
	pro: SponsorsManager | null = null;
	readonly renders = new Set<LabelsRenderChild>();
	private readonly roots = new WeakSet<HTMLElement>();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		const tab = new TaskFieldLabelsSettingTab(this.app, this);
		this.register(pro.onChange(() => { this.refresh(); tab.update(); }));
		this.addSettingTab(tab);
		this.registerMarkdownPostProcessor((el, ctx) => this.attach(el, ctx), 100);
		this.registerEditorExtension(labelsEditorExtension(this));
		this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		this.app.workspace.onLayoutReady(() => void pro.refresh());
	}
	attach(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (this.roots.has(el)) return;
		// Tasks calls the Markdown renderer for descriptions. Those roots contain no fields.
		if (!el.querySelector('li.task-list-item, pre code.language-tasks, .block-language-tasks')) return;
		ctx.addChild(this.createChild(el, () => ctx.sourcePath));
	}
	createChild(el: HTMLElement, sourcePath: () => string): LabelsRenderChild {
		this.roots.add(el);
		const child = new LabelsRenderChild(el, () => displayFor(this.settings, isPro(), sourcePath()), () => {
			this.renders.delete(child);
			this.roots.delete(el);
		});
		this.renders.add(child);
		return child;
	}
	refresh(): void { for (const child of this.renders) child.adapter.refresh(); }
	onunload(): void { for (const child of [...this.renders]) child.unload(); this.renders.clear(); resetPro(); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> { this.settings = normalizeSettings(this.settings); await this.saveData(this.settings); this.refresh(); }
	savePreset(): boolean {
		if (!isPro()) return false;
		const name = this.settings.presetName.trim();
		if (!name || ['off', '__proto__', 'constructor', 'prototype'].includes(name)) return false;
		// normalizeSettings keeps 30 presets. A new name past the limit would be dropped and clear the selection.
		if (!Object.prototype.hasOwnProperty.call(this.settings.presets, name) && Object.keys(this.settings.presets).length >= MAX_PRESETS) {
			new Notice('Task Field Labels stores up to ' + MAX_PRESETS + ' presets. Save over an existing preset name.');
			return false;
		}
		this.settings.presets[name] = { labels: { ...this.settings.labels }, compact: this.settings.compact };
		this.settings.selectedPreset = name;
		void this.saveSettings();
		return true;
	}
}
