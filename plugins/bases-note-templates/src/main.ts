import { FileView, Notice, Plugin, TFile, TFolder, normalizePath, parseYaml, stringifyYaml, type Menu, type TAbstractFile, type View, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { DEFAULT_BASE, DEFAULT_SETTINGS, effectiveFor, normalizeBase, usesNew, normalizeSettings, renamePath, renameTouches, type BaseConfig, type Effective, type Settings } from './config';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { filtersToProperties } from './filters';
import { TemplatePickModal, SetupModal } from './modals';
import { BasesNoteTemplatesSettingTab } from './settings';
import { makeFileName, newButtonProps, planNewNote, renderVariables, splitFrontmatter, uniquePath, type Props, type VarContext } from './template';
import { runTemplater } from './templater';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** After New, the app writes the filter values about 100 ms after it creates the file. Fallback if no write comes. */
const NEW_FALLBACK_MS = 1500;
const PRO_NOTICE = 'This is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.';

export interface BaseContext {
	file: TFile;
	view: string;
}

interface BaseView {
	name: string;
	filters?: unknown;
	order: string[];
}

interface BaseData {
	filters?: unknown;
	views: BaseView[];
	/** Hidden base keys the app reads for New (1.13.4 and later; not in the help). */
	newItemFolder?: string;
	newItemTemplate?: string;
}

interface Template {
	path: string;
	name: string;
	props: Props;
	text: string;
}

interface Pending {
	ctx: BaseContext;
	eff: Effective;
	timer: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reads the parts of a .base file this plugin needs: the filters and each view's name, filters and columns. */
export function readBaseData(text: string): BaseData {
	let raw: unknown;
	try {
		raw = parseYaml(text);
	} catch {
		return { views: [] };
	}
	if (!isRecord(raw)) return { views: [] };
	const views = Array.isArray(raw.views) ? raw.views.filter(isRecord) : [];
	return {
		filters: raw.filters,
		newItemFolder: typeof raw.newItemFolder === 'string' ? raw.newItemFolder : undefined,
		newItemTemplate: typeof raw.newItemTemplate === 'string' ? raw.newItemTemplate : undefined,
		views: views.map((v, i) => ({
			name: typeof v.name === 'string' ? v.name : `View ${i + 1}`,
			filters: v.filters,
			order: Array.isArray(v.order) ? v.order.filter((o): o is string => typeof o === 'string') : [],
		})),
	};
}

/** Properties from YAML text, or an empty object for missing or broken YAML. */
function propsFromYaml(yaml: string | null): Props {
	if (!yaml) return {};
	try {
		const parsed: unknown = parseYaml(yaml);
		return isRecord(parsed) ? (parsed as Props) : {};
	} catch {
		return {};
	}
}

/** Note text from properties and a body. No properties = no frontmatter block. */
export function composeNote(props: Props, body: string): string {
	if (Object.keys(props).length === 0) return body;
	return `---\n${stringifyYaml(props)}---\n${body}`;
}

export default class BasesNoteTemplatesPlugin extends Plugin {
	settings: Settings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: BasesNoteTemplatesSettingTab | null = null;
	private pending = new Map<string, Pending>();
	private buttons = new Map<View, HTMLElement>();

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(onProChange(() => this.settingTab?.update()));
		this.settingTab = new BasesNoteTemplatesSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addCommands();
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => this.onFileMenu(menu, file, source)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onRename(file, oldPath)));
		this.app.workspace.onLayoutReady(() => {
			// Registered after the vault is indexed, so the create events of the first scan never count.
			this.registerEvent(this.app.vault.on('create', (file) => this.onCreate(file)));
			this.registerEvent(this.app.vault.on('modify', (file) => this.onModify(file)));
			this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshButtons()));
			this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshButtons()));
			this.refreshButtons();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		for (const p of this.pending.values()) window.clearTimeout(p.timer);
		this.pending.clear();
		for (const el of this.buttons.values()) el.remove();
		this.buttons.clear();
		resetPro();
	}

	private addCommands(): void {
		this.addCommand({
			id: 'new-from-template',
			name: 'New note from template in this base',
			checkCallback: (checking) => {
				const ctx = this.activeBase();
				if (!ctx) return false;
				if (!checking) void this.newFromCommand(ctx);
				return true;
			},
		});
		this.addCommand({
			id: 'set-up-base',
			name: 'Set up templates for this base',
			checkCallback: (checking) => {
				const ctx = this.activeBase();
				if (!ctx) return false;
				if (!checking) void this.openSetup(ctx);
				return true;
			},
		});
		this.addCommand({
			id: 'duplicate-note',
			name: 'Duplicate the current note as a new note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) void this.duplicate(file);
				return true;
			},
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		this.settings = normalizeSettings(this.settings);
		await this.saveData(this.settings);
	}

	/** The base open in the active tab, with the name of the view it shows. */
	activeBase(): BaseContext | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		return leaf ? this.baseOfLeaf(leaf) : null;
	}

	private baseOfLeaf(leaf: WorkspaceLeaf): BaseContext | null {
		const view = leaf.view;
		if (view.getViewType() !== 'bases' || !(view instanceof FileView)) return null;
		const file = view.file;
		if (!file || file.extension !== 'base') return null;
		const state: unknown = leaf.getViewState().state;
		const name = isRecord(state) && typeof state.viewName === 'string' ? state.viewName : '';
		return { file, view: name };
	}

	async saveBase(path: string, cfg: BaseConfig | null): Promise<void> {
		const bases = { ...this.settings.bases };
		if (cfg) bases[path] = normalizeBase(cfg);
		else delete bases[path];
		this.settings = { ...this.settings, bases };
		await this.saveSettings();
		this.refreshButtons();
		this.settingTab?.update();
	}

	private async openSetup(ctx: BaseContext): Promise<void> {
		const data = readBaseData(await this.app.vault.cachedRead(ctx.file));
		const cfg = this.settings.bases[ctx.file.path] ?? { ...DEFAULT_BASE, views: {} };
		new SetupModal(this.app, { ctx, cfg, views: data.views.map((v) => v.name), pro: isPro(), onSave: (next) => void this.saveBase(ctx.file.path, next) }).open();
	}

	/** Adds a "New note from template" button to the header of each base tab that has a setup. Public view API. */
	refreshButtons(): void {
		const seen = new Set<View>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const ctx = this.baseOfLeaf(leaf);
			if (!ctx || !this.settings.bases[ctx.file.path]) return;
			const view = leaf.view;
			seen.add(view);
			if (this.buttons.has(view) || !(view instanceof FileView)) return;
			const el = view.addAction('file-plus-2', 'New note from template', () => {
				const now = this.baseOfLeaf(leaf);
				if (now) void this.newFromCommand(now);
			});
			el.addClass('bnt-new-button');
			this.buttons.set(view, el);
		});
		for (const [view, el] of this.buttons) {
			if (seen.has(view)) continue;
			el.remove();
			this.buttons.delete(view);
		}
	}

	private async readTemplate(path: string): Promise<Template | null> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice(`Template not found: ${path}`);
			return null;
		}
		const text = await this.app.vault.cachedRead(file);
		return { path, name: file.basename, props: propsFromYaml(splitFrontmatter(text).yaml), text };
	}

	private async readTypes(): Promise<Record<string, string>> {
		try {
			const raw: unknown = JSON.parse(await this.app.vault.adapter.read(normalizePath(`${this.app.vault.configDir}/types.json`)));
			const types = isRecord(raw) && isRecord(raw.types) ? raw.types : {};
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(types)) if (typeof v === 'string') out[k] = v;
			return out;
		} catch {
			return {};
		}
	}

	/** Lets the user pick when there is more than one template (Pro), else returns the only one. */
	private pick(templates: string[]): Promise<string | null> {
		if (templates.length <= 1) return Promise.resolve(templates[0] ?? null);
		return new Promise((resolve) => new TemplatePickModal(this.app, templates, resolve).open());
	}

	/** Command and header button: a new note from the template, the filter values, the folder and the name pattern. */
	async newFromCommand(ctx: BaseContext): Promise<TFile | null> {
		const eff = effectiveFor(this.settings, ctx.file.path, ctx.view, isPro()) ?? { templates: [], folder: '', pattern: '', onNew: false, extraProps: {}, locked: [] };
		const chosen = await this.pick(eff.templates);
		if (eff.templates.length > 1 && !chosen) return null;
		const template = chosen ? await this.readTemplate(chosen) : null;
		if (chosen && !template) return null;
		const data = readBaseData(await this.app.vault.cachedRead(ctx.file));
		const view = data.views.find((v) => v.name === ctx.view) ?? data.views[0];
		const plan = planNewNote(
			{ baseFilters: data.filters, viewFilters: view?.filters, order: view?.order, template: template?.text, templateName: template?.name, pattern: eff.pattern, folder: eff.folder, base: ctx.file.basename, view: view?.name ?? '', now: new Date().toISOString(), dateFormat: this.settings.dateFormat, timeFormat: this.settings.timeFormat, types: await this.readTypes(), extraProps: eff.extraProps },
			template?.props ?? {},
			(target) => this.linkText(target, ctx.file.path),
		);
		const folder = plan.folder || this.app.fileManager.getNewFileParent(ctx.file.path).path;
		await this.ensureFolder(folder);
		const path = uniquePath(folder === '/' ? '' : folder, plan.name, (p) => this.app.vault.getAbstractFileByPath(p) !== null);
		const file = await this.app.vault.create(path, composeNote(plan.properties, plan.body));
		await this.app.workspace.getLeaf('tab').openFile(file, { active: true });
		await this.afterCreate(file);
		return file;
	}

	/** The app's link text for a link() target: the shortest path that still finds the note. */
	private linkText(target: string, sourcePath: string): string {
		const dest = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
		return dest ? this.app.metadataCache.fileToLinktext(dest, sourcePath) : target;
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!folder || folder === '/') return;
		const existing = this.app.vault.getAbstractFileByPath(folder);
		if (existing instanceof TFolder) return;
		if (existing) throw new Error(`${folder} is a file, not a folder`);
		await this.app.vault.createFolder(folder);
	}

	private async afterCreate(file: TFile): Promise<void> {
		if (!isPro() || !this.settings.templater) return;
		const result = await runTemplater(this.app, file);
		if (result === 'missing') new Notice('Templater tags are left in the note because the templater plugin is not on.');
	}

	/** New button: an empty note created while a base with a setup is the active tab. */
	private onCreate(file: TAbstractFile): void {
		if (!this.settings.hookNew || !(file instanceof TFile) || file.extension !== 'md' || file.stat.size !== 0) return;
		const ctx = this.activeBase();
		if (!ctx) return;
		const eff = effectiveFor(this.settings, ctx.file.path, ctx.view, isPro());
		if (!eff || !usesNew(eff)) return;
		const timer = window.setTimeout(() => this.firePending(file), NEW_FALLBACK_MS);
		this.pending.set(file.path, { ctx, eff, timer });
	}

	/** The app's own write of the filter values is the signal that its New step is done. */
	private onModify(file: TAbstractFile): void {
		if (file instanceof TFile && this.pending.has(file.path)) this.firePending(file);
	}

	private firePending(file: TFile): void {
		const p = this.pending.get(file.path);
		if (!p) return;
		window.clearTimeout(p.timer);
		this.pending.delete(file.path);
		void this.applyToNew(file, p.ctx, p.eff).catch((e: unknown) => new Notice(`Bases Note Templates: ${e instanceof Error ? e.message : String(e)}`));
	}

	/** Merges the template into the note the New button made, then renames it with the name pattern. */
	async applyToNew(file: TFile, ctx: BaseContext, eff: Effective): Promise<void> {
		if (!(await this.madeByNew(file, ctx))) return;
		const chosen = await this.pick(eff.templates);
		const template = chosen ? await this.readTemplate(chosen) : null;
		if (chosen && !template) return;
		if (eff.templates.length > 1 && !chosen) return;
		const vars: VarContext = { title: file.basename, now: new Date(), dateFormat: this.settings.dateFormat, timeFormat: this.settings.timeFormat, base: ctx.file.basename, view: ctx.view, template: template?.name ?? '', props: {} };
		let name = file.basename;
		await this.app.vault.process(file, (text) => {
			const { yaml, body } = splitFrontmatter(text);
			const current = propsFromYaml(yaml);
			if (eff.pattern) name = makeFileName(eff.pattern, { ...vars, props: current });
			const withTitle = { ...vars, title: name, props: current };
			if (!template && Object.keys(eff.extraProps).length === 0) return text;
			const merged = newButtonProps(current, template?.props ?? {}, eff.extraProps, withTitle);
			if (!template) return composeNote(merged, body);
			const tBody = renderVariables(splitFrontmatter(template.text).body, withTitle);
			return composeNote(merged, body.trim() ? `${tBody}${tBody.endsWith('\n') ? '' : '\n'}${body}` : tBody);
		});
		const here = file.parent && file.parent.path !== '/' ? file.parent.path : '';
		const dir = eff.folder || here;
		if (name !== file.basename || dir !== here) {
			await this.ensureFolder(dir);
			const path = uniquePath(dir, name, (p) => p !== file.path && this.app.vault.getAbstractFileByPath(p) !== null);
			await this.app.fileManager.renameFile(file, path);
		}
		await this.afterCreate(file);
	}

	/**
	 * Fail closed: true only when the empty note is where the app's New button of this base puts notes (hidden
	 * newItemFolder key, the template folder of newItemTemplate, the filter folder, else the default location).
	 * An empty note that another plugin makes elsewhere while the base is open is left alone.
	 */
	private async madeByNew(file: TFile, ctx: BaseContext): Promise<boolean> {
		const data = readBaseData(await this.app.vault.cachedRead(ctx.file));
		const view = data.views.find((v) => v.name === ctx.view) ?? data.views[0];
		const templateDir = data.newItemTemplate ? this.app.vault.getFileByPath(data.newItemTemplate)?.parent?.path : undefined;
		const folder = data.newItemFolder || templateDir || filtersToProperties(data.filters, view?.filters).folder || this.app.fileManager.getNewFileParent(ctx.file.path).path;
		const norm = (p: string) => p.replace(/^\/+|\/+$/g, '');
		return norm(file.parent?.path ?? '') === norm(folder);
	}

	/** Pro: a copy of a note (a row of a base) in the same folder, opened in a new tab. */
	async duplicate(file: TFile): Promise<TFile | null> {
		if (!isPro()) {
			new Notice(PRO_NOTICE);
			return null;
		}
		const text = await this.app.vault.read(file);
		const dir = file.parent && file.parent.path !== '/' ? file.parent.path : '';
		const copy = await this.app.vault.create(
			uniquePath(dir, file.basename, (p) => this.app.vault.getAbstractFileByPath(p) !== null),
			text,
		);
		await this.app.workspace.getLeaf('tab').openFile(copy, { active: true });
		return copy;
	}

	private onFileMenu(menu: Menu, file: TAbstractFile, source: string): void {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (source !== 'bases-context-menu' && source !== 'file-explorer-context-menu') return;
		menu.addItem((item) =>
			item
				.setTitle('Duplicate as new note')
				.setIcon('copy-plus')
				.onClick(() => void this.duplicate(file)),
		);
	}

	private async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
		// The user can rename a new note in the app's popover before the fallback timer fires; keep it pending.
		const pending = this.pending.get(oldPath);
		if (pending) {
			this.pending.delete(oldPath);
			this.pending.set(file.path, pending);
		}
		if (!renameTouches(this.settings, oldPath)) return;
		this.settings = renamePath(this.settings, oldPath, file.path);
		await this.saveSettings();
		this.refreshButtons();
	}
}
