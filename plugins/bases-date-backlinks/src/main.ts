import { Component, Editor, MarkdownRenderer, MarkdownView, Modal, Notice, Plugin, Setting, TFile, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { BASE_FILE_PATH, BASE_VIEW_ID, buildBaseText, hasEmbed, insertEmbed, isManagedBase, updatePropertyFilter } from './basefile';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { DateBacklinksSettingTab } from './settings';
import { DateBacklinksView, viewOptions } from './view';
import { dailyConfig, isDailyName, type DailyConfig } from './setup';

const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class BasesDateBacklinksPlugin extends Plugin {
	pro: SponsorsManager | null = null;
	private settingTab: DateBacklinksSettingTab | null = null;
	private basesAvailable = false;
	settings = { autoShow: false };
	private daily: DailyConfig = { template: '', format: 'YYYY-MM-DD' };
	private autoViews = new WeakMap<MarkdownView, { path: string; component: Component; el: HTMLElement }>();
	private autoTimer: number | null = null;
	private autoRegistered = new WeakSet<MarkdownView>();
	private filterKeys = new Map<string, string>();


	async onload(): Promise<void> {
		const saved: unknown = await this.loadData();
		this.settings.autoShow = !!saved && typeof saved === 'object' && 'autoShow' in saved && saved.autoShow === true;
		await this.readDailyConfig();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.settingTab = new DateBacklinksSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(pro.onChange(() => this.settingTab?.update()));

		this.basesAvailable = this.registerBasesView(BASE_VIEW_ID, {
			name: 'Date backlinks',
			icon: 'calendar-days',
			factory: (controller, containerEl) => new DateBacklinksView(controller, containerEl, this),
			options: viewOptions,
		});
		if (!this.basesAvailable) console.warn('Date Property Backlinks: Bases is turned off in this vault, so the view is not available.');

		this.addCommand({
			id: 'insert-date-backlinks-view',
			name: 'Insert date backlinks view in the current note',
			editorCallback: (editor: Editor, ctx) => void this.insertView(editor, ctx.file),
		});

		this.addCommand({ id: 'add-to-daily-template', name: 'Add to the daily notes template', callback: () => void this.previewTemplate() });
		this.registerHoverLinkSource(BASE_VIEW_ID, { display: 'Date backlinks', defaultMod: true });
		this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleAutomaticViews()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleAutomaticViews()));
		this.register(() => { if (this.autoTimer !== null) window.clearTimeout(this.autoTimer); });

		this.app.workspace.onLayoutReady(() => {
			this.scheduleAutomaticViews();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	isPro(): boolean {
		return isPro();
	}

	onProChange(callback: () => void): () => void {
		return onProChange(callback);
	}

	private async insertView(editor: Editor, note: TFile | null): Promise<void> {
		if (!this.basesAvailable) {
			new Notice('Bases must be enabled before adding the view.');
			return;
		}
		if (!(note instanceof TFile) || note.extension !== 'md') {
			new Notice('Open a Markdown note before you add a date backlinks view.');
			return;
		}

		try {
			const base = await this.ensureBase();
			const link = `!${this.app.fileManager.generateMarkdownLink(base, note.path)}`;
			const before = editor.getValue();
			const after = insertEmbed(before, link);
			if (after === before) {
				new Notice('This note already has a date backlinks view.');
				return;
			}
			editor.replaceRange(after.slice(before.length), editor.offsetToPos(before.length));
			this.scheduleAutomaticViews();
			new Notice('View added. Choose its date property in the view settings.');
		} catch (error) {
			new Notice(`Could not add the date backlinks view. ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	private async readJson(path: string): Promise<unknown> {
		try {
			if (!await this.app.vault.adapter.exists(path)) return null;
			const result: unknown = JSON.parse(await this.app.vault.adapter.read(path));
			return result;
		} catch { return null; }
	}

	private async readDailyConfig(): Promise<void> {
		const config = this.app.vault.configDir;
		this.daily = dailyConfig(await this.readJson(`${config}/daily-notes.json`), await this.readJson(`${config}/plugins/periodic-notes/data.json`));
	}

	private async ensureBase(): Promise<TFile> {
		if (!this.basesAvailable) throw new Error('Enable the Bases core plugin first.');
		let base = this.app.vault.getAbstractFileByPath(BASE_FILE_PATH);
		if (!base) base = await this.app.vault.create(BASE_FILE_PATH, buildBaseText(this.daily.format));
		if (!(base instanceof TFile) || !isManagedBase(await this.app.vault.cachedRead(base))) {
			throw new Error(`${BASE_FILE_PATH} already exists and was not made by this plugin. Rename it, then try again.`);
		}
		return base;
	}

	async previewTemplate(): Promise<Modal | null> {
		try {
			await this.readDailyConfig();
			const path = normalizePath(this.daily.template);
			const file = this.app.vault.getFileByPath(path) ?? this.app.vault.getFileByPath(`${path}.md`);
			if (!path || !file || file.extension !== 'md') throw new Error('Choose an existing template in Daily notes or Periodic Notes first.');
			const before = await this.app.vault.cachedRead(file);
			const embed = `![[${BASE_FILE_PATH}]]`;
			const after = insertEmbed(before, embed);
			const modal = new Modal(this.app);
			modal.setTitle('Add to the daily notes template');
			modal.contentEl.createEl('p', { text: `Template: ${file.path}. New daily notes will include the view automatically.` });
			modal.contentEl.createEl('pre', { cls: 'bases-date-backlinks-preview', text: after });
			new Setting(modal.contentEl).addButton((button) => button.setButtonText(after === before ? 'Already added' : 'Add view to template').setDisabled(after === before).setCta().onClick(() => {
				void (async () => {
					try {
						await this.ensureBase();
						const view = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (view?.file?.path === file.path) {
							const text = view.editor.getValue();
							const next = insertEmbed(text, embed);
							view.editor.replaceRange(next.slice(text.length), view.editor.offsetToPos(text.length));
						} else await this.app.vault.process(file, (text) => insertEmbed(text, embed));
						modal.close();
						new Notice('Daily notes template updated. Existing notes can use the automatic view.');
					} catch (error) { new Notice(String(error)); }
				})();
			}));
			modal.open();
			return modal;
		} catch (error) { new Notice(String(error)); return null; }
	}

	async setAutoShow(enabled: boolean): Promise<void> {
		this.settings.autoShow = enabled;
		await this.saveData(this.settings);
		await this.readDailyConfig();
		this.scheduleAutomaticViews();
	}

	private scheduleAutomaticViews(): void {
		if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
		this.autoTimer = window.setTimeout(() => {
			this.autoTimer = null;
			void this.renderAutomaticViews();
		}, 150);
	}

	private async renderAutomaticViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const old = this.autoViews.get(view);
			const file = view.file;
			const show = this.settings.autoShow && file && isDailyName(file.basename, this.daily.format) && !hasEmbed(view.editor.getValue());
			if (old && (!show || old.path !== file?.path)) {
				this.removeChild(old.component);
				this.autoViews.delete(view);
			}
			if (!show || !file || this.autoViews.has(view)) continue;
			try {
				await this.ensureBase();
				if (view.file?.path !== file.path || !this.settings.autoShow || this.autoViews.has(view)) continue;
				view.contentEl.addClass('bases-date-backlinks-auto-host');
				const el = view.contentEl.createDiv({ cls: 'bases-date-backlinks-auto' });
				const component = this.addChild(new Component());
				component.register(() => { el.remove(); view.contentEl.removeClass('bases-date-backlinks-auto-host'); });
				if (!this.autoRegistered.has(view)) {
					this.autoRegistered.add(view);
					view.register(() => {
						const current = this.autoViews.get(view);
						if (current) this.removeChild(current.component);
						this.autoViews.delete(view);
					});
				}
				this.autoViews.set(view, { path: file.path, component, el });
				await MarkdownRenderer.render(this.app, `![[${BASE_FILE_PATH}]]`, el, file.path, component);
			} catch (error) { console.warn('Date backlinks automatic view:', error); }
		}
	}

	/** Keep the generated query restricted to the properties selected in its view. */
	syncPropertyFilter(properties: string[]): void {
		const file = this.app.metadataCache.getFirstLinkpathDest(BASE_FILE_PATH, this.app.workspace.getActiveFile()?.path ?? '') ?? this.app.vault.getFileByPath(BASE_FILE_PATH);
		if (!file) return;
		const key = [...new Set(properties)].sort().join('\n');
		if (key === this.filterKeys.get(file.path)) return;
		this.filterKeys.set(file.path, key);
		void this.app.vault.process(file, (text) => updatePropertyFilter(text, properties)).catch(() => { this.filterKeys.delete(file.path); });
	}

}
