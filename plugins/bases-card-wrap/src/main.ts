import { FileView, Plugin, TFile, TFolder, parseYaml, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, BasesCardWrapSettingTab, normalizeSettings, type BasesCardWrapSettings } from './settings';
import { RuleModal } from './modal';
import { effectiveRule, embedLinkPath, isEmptyRule, isPlanClass, propId, renameKeys, renameView, viewKey, viewPlan, type ViewPlan, type ViewRule } from './rules';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
/** The largest .base file that the plugin parses for the property order. */
const MAX_BASE_BYTES = 1_000_000;
const CARDS_VIEW = '.bases-view[data-view-type="cards"]';

interface BaseInfo {
	/** The views of the base file in file order, with the property order of each. */
	views: { name: string; order: string[] | null }[];
	/** displayName of each property id from the properties section. */
	labels: Record<string, string>;
}

interface ViewContext {
	/** The base file path, or null for a base code block. */
	basePath: string | null;
	viewName: string;
}

export default class BasesCardWrapPlugin extends Plugin {
	settings: BasesCardWrapSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: BasesCardWrapSettingTab | null = null;
	/** Parsed .base files. A missing key means "not read yet". */
	private bases = new Map<string, BaseInfo | null>();
	private reading = new Set<string>();
	/** The plan signature applied to each view element. */
	private applied = new WeakMap<HTMLElement, string>();
	private touched = new Set<HTMLElement>();
	private observers: MutationObserver[] = [];
	private frame: number | null = null;
	private unloaded = false;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.register(onProChange(() => this.refresh()));
		this.settingTab = new BasesCardWrapSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'set-view-rule',
			name: 'Set card wrap for this view',
			checkCallback: (checking) => {
				const target = this.activeCardsView();
				if (!target) return false;
				if (!checking) this.openRuleModal(target.basePath, target.viewName);
				return true;
			},
		});

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const next = renameKeys(this.settings.views, oldPath, file.path);
				if (next !== this.settings.views) {
					this.settings.views = next;
					void this.saveSettings();
				}
				if (file instanceof TFolder || oldPath.endsWith('.base')) this.forgetBases(oldPath);
				this.schedule();
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'base') void this.reloadBase(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.forgetBases(file.path);
				this.schedule();
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
			this.observe(document);
			this.registerEvent(this.app.workspace.on('window-open', (_w, win) => this.observe(win.document)));
			this.schedule();
		});
	}

	onunload(): void {
		this.unloaded = true;
		for (const o of this.observers) o.disconnect();
		this.observers = [];
		if (this.frame !== null) window.cancelAnimationFrame(this.frame);
		this.frame = null;
		let changed = false;
		for (const el of this.touched) changed = this.applyPlan(el, null) || changed;
		this.touched.clear();
		resetPro();
		// The core cards view measures its test card again on css-change: the core card height comes back.
		if (changed) this.app.workspace.trigger('css-change');
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<BasesCardWrapSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// The settings tab builds its rows from the settings: build them again.
		this.settingTab?.update();
	}

	/** Sets or removes the rule of one view and redraws. */
	async setViewRule(key: string, rule: ViewRule | null): Promise<void> {
		const views = { ...this.settings.views };
		if (rule && !isEmptyRule(rule)) views[key] = rule;
		else delete views[key];
		this.settings.views = views;
		await this.saveSettings();
		this.refresh();
	}

	/** Applies the rules again to every cards view. */
	refresh(): void {
		this.applied = new WeakMap();
		this.schedule();
	}

	/** The display name of a property id, from the .base files read so far. */
	propLabel(prop: string): string {
		for (const info of this.bases.values()) {
			const name = info?.labels[prop];
			if (name) return name;
		}
		if (prop === 'file.name') return 'file name';
		return prop.startsWith('note.') ? prop.slice(5) : prop;
	}

	openRuleModal(basePath: string, viewName: string): void {
		const file = this.app.vault.getFileByPath(basePath);
		void (async () => {
			const info = file ? await this.readBase(file) : null;
			const order = info?.views.find((v) => v.name === viewName)?.order ?? [];
			const ids = order.map(propId);
			const label = (p: string): string => {
				const name = info?.labels[p] ?? this.propLabel(p);
				return ids[0] === p ? `${name} (title)` : name;
			};
			const key = viewKey(basePath, viewName);
			new RuleModal(this.app, {
				title: `Card wrap: ${viewName}`,
				props: ids,
				label,
				initial: this.settings.views[key] ?? null,
				onChange: async (rule) => {
					await this.setViewRule(key, rule);
				},
			}).open();
		})();
	}

	/** Pro: edits the vault default rule. */
	openDefaultModal(): void {
		if (!isPro()) return;
		new RuleModal(this.app, {
			title: 'Card wrap: vault default',
			props: [],
			label: (p) => p,
			initial: this.settings.vaultDefault,
			onChange: async (rule) => {
				this.settings.vaultDefault = isEmptyRule(rule) ? null : rule;
				await this.saveSettings();
				this.refresh();
			},
		}).open();
	}

	/** The cards view of the active tab: a base tab, or the first embedded base of a note. */
	private activeCardsView(): { basePath: string; viewName: string } | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return null;
		for (const el of Array.from(leaf.view.containerEl.querySelectorAll<HTMLElement>(CARDS_VIEW))) {
			if (!el.isShown()) continue;
			const ctx = this.contextOf(el, leaf);
			if (ctx?.basePath) return { basePath: ctx.basePath, viewName: ctx.viewName };
		}
		return null;
	}

	private observe(doc: Document): void {
		const observer = new MutationObserver((records) => {
			for (const r of records) {
				const t = r.target.instanceOf(Element) ? r.target : r.target.parentElement;
				// Cards come and go on each scroll. Only changes outside the card containers can add or change a view.
				if (t && t.closest('.bases-cards-container')) continue;
				this.schedule();
				return;
			}
		});
		observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-view-name', 'data-view-type', 'src'] });
		this.observers.push(observer);
	}

	private schedule(): void {
		if (this.frame !== null || this.unloaded) return;
		this.frame = window.requestAnimationFrame(() => {
			this.frame = null;
			this.scan();
		});
	}

	/** Applies the plan of each cards view in each window. One css-change when a plan changed. */
	private scan(): void {
		if (this.unloaded) return;
		// No rule and nothing styled: skip the DOM queries (each key press in an editor can schedule a scan).
		if (this.touched.size === 0 && Object.keys(this.settings.views).length === 0 && !(isPro() && this.settings.vaultDefault)) return;
		const docs = new Set<Document>([document]);
		this.app.workspace.iterateAllLeaves((leaf) => {
			docs.add(leaf.view.containerEl.doc);
		});
		let changed = false;
		const seen = new Set<HTMLElement>();
		for (const doc of docs) {
			for (const el of Array.from(doc.querySelectorAll<HTMLElement>(CARDS_VIEW))) {
				seen.add(el);
				changed = this.applyPlan(el, this.planFor(el)) || changed;
			}
			// A view element that is now a table or list view loses its classes.
			for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.bases-view.bcw-on'))) {
				if (!seen.has(el)) changed = this.applyPlan(el, null) || changed;
			}
		}
		for (const el of this.touched) if (!el.isConnected) this.touched.delete(el);
		if (changed) this.app.workspace.trigger('css-change');
	}

	private planFor(el: HTMLElement): ViewPlan | null {
		const ctx = this.contextOf(el);
		if (!ctx) return null;
		const rule = effectiveRule(this.settings.views, this.settings.vaultDefault, ctx.basePath, ctx.viewName, isPro());
		if (!rule) return null;
		if (ctx.basePath === null) return viewPlan(rule, null);
		const file = this.app.vault.getFileByPath(ctx.basePath);
		if (!file) return viewPlan(rule, null);
		if (!this.bases.has(file.path)) {
			// Read the property order first. The scan runs again when it is known.
			void this.readBase(file).then(() => this.schedule());
			return this.applied.has(el) ? this.currentPlan(el) : null;
		}
		const info = this.bases.get(file.path) ?? null;
		const order = info?.views.find((v) => v.name === ctx.viewName)?.order ?? null;
		return viewPlan(rule, order);
	}

	/** Keeps the plan that is on the element while the base file is read again. */
	private currentPlan(el: HTMLElement): ViewPlan | null {
		const sig = this.applied.get(el);
		return sig ? (JSON.parse(sig) as ViewPlan) : null;
	}

	/** Finds the base file and the view name of a cards view element. */
	private contextOf(el: HTMLElement, knownLeaf?: WorkspaceLeaf): ViewContext | null {
		const viewName = el.getAttribute('data-view-name') ?? '';
		const embed = el.closest<HTMLElement>('.internal-embed');
		if (embed) {
			const src = embed.getAttribute('src');
			if (!src) return { basePath: null, viewName };
			const leaf = knownLeaf ?? this.leafOf(el);
			const sourcePath = leaf?.view instanceof FileView ? (leaf.view.file?.path ?? '') : '';
			const file = this.app.metadataCache.getFirstLinkpathDest(embedLinkPath(src), sourcePath);
			return { basePath: file && file.extension === 'base' ? file.path : null, viewName };
		}
		const leaf = knownLeaf ?? this.leafOf(el);
		if (leaf && leaf.view.getViewType() === 'bases' && leaf.view instanceof FileView && leaf.view.file) {
			return { basePath: leaf.view.file.path, viewName };
		}
		// A base code block in a note: no base file.
		return { basePath: null, viewName };
	}

	private leafOf(el: HTMLElement): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!found && leaf.view.containerEl.contains(el)) found = leaf;
		});
		return found;
	}

	/** Puts the plan on the element, or removes it (plan null). Returns true when something changed. */
	private applyPlan(el: HTMLElement, plan: ViewPlan | null): boolean {
		const sig = plan ? JSON.stringify(plan) : '';
		const old = this.applied.get(el) ?? (el.hasClass('bcw-on') ? '?' : '');
		if (sig === old) return false;
		for (const cls of Array.from(el.classList)) if (isPlanClass(cls)) el.removeClass(cls);
		for (let i = el.style.length - 1; i >= 0; i--) {
			const name = el.style.item(i);
			if (name.startsWith('--bcw-')) el.style.removeProperty(name);
		}
		if (plan) {
			el.addClasses(plan.classes);
			el.setCssProps(plan.vars);
			this.applied.set(el, sig);
			this.touched.add(el);
		} else {
			this.applied.delete(el);
			this.touched.delete(el);
		}
		return true;
	}

	private async readBase(file: TFile): Promise<BaseInfo | null> {
		if (this.bases.has(file.path)) return this.bases.get(file.path) ?? null;
		if (this.reading.has(file.path)) return null;
		this.reading.add(file.path);
		try {
			const info = file.stat.size > MAX_BASE_BYTES ? null : parseBase(await this.app.vault.cachedRead(file));
			this.bases.set(file.path, info);
			return info;
		} catch {
			this.bases.set(file.path, null);
			return null;
		} finally {
			this.reading.delete(file.path);
		}
	}

	/** A .base file changed: read it again, and move the rule of a view that has a new name. */
	private async reloadBase(file: TFile): Promise<void> {
		const before = this.bases.get(file.path);
		this.bases.delete(file.path);
		const after = await this.readBase(file);
		if (before && after && before.views.length === after.views.length) {
			let views = this.settings.views;
			const oldNames = new Set(before.views.map((v) => v.name));
			for (let i = 0; i < after.views.length; i++) {
				const o = before.views[i]!.name;
				const n = after.views[i]!.name;
				if (o !== n && !oldNames.has(n)) views = renameView(views, file.path, o, n);
			}
			if (views !== this.settings.views) {
				this.settings.views = views;
				await this.saveSettings();
			}
		}
		this.refresh();
	}

	private forgetBases(path: string): void {
		for (const key of Array.from(this.bases.keys())) if (key === path || key.startsWith(`${path}/`)) this.bases.delete(key);
	}
}

/** Reads the view names, the property order of each view and the display names from .base text. */
export function parseBase(text: string): BaseInfo | null {
	const data = parseYaml(text) as unknown;
	if (!data || typeof data !== 'object') return { views: [], labels: {} };
	const d = data as { views?: unknown; properties?: unknown };
	const views: BaseInfo['views'] = [];
	if (Array.isArray(d.views)) {
		for (const v of d.views as unknown[]) {
			if (!v || typeof v !== 'object') continue;
			const name = (v as { name?: unknown }).name;
			const order = (v as { order?: unknown }).order;
			views.push({
				name: typeof name === 'string' ? name : '',
				order: Array.isArray(order) ? order.filter((x): x is string => typeof x === 'string') : null,
			});
		}
	}
	const labels: Record<string, string> = {};
	if (d.properties && typeof d.properties === 'object') {
		for (const [k, v] of Object.entries(d.properties as Record<string, unknown>)) {
			const name = v && typeof v === 'object' ? (v as { displayName?: unknown }).displayName : undefined;
			if (typeof name === 'string' && name.trim() !== '') labels[propId(k)] = name;
		}
	}
	return { views, labels };
}
