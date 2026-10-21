import { FileView, Notice, Platform, Plugin, TFile, getLinkpath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from './pro';
import { isLocked, normalizeSettings, removeLocked, renameLocked, shouldBlock, toggleLocked, type LockSettings } from './policy';
import { attemptOf } from './guard';
import { DOM, LOCK_CLASS, PATH_ATTR } from './selectors';
import { BasesReadOnlySettingTab } from './settings';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

const EVENTS = ['mousedown', 'click', 'dblclick', 'keydown', 'beforeinput', 'paste', 'cut', 'dragstart', 'drop', 'pointerdown', 'contextmenu', 'touchstart'] as const;
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class BasesReadOnlyPlugin extends Plugin {
	settings: LockSettings = normalizeSettings(null);
	pro: SponsorsManager | null = null;
	private tab: BasesReadOnlySettingTab | null = null;
	private badge: HTMLElement | null = null;
	private marked = new Set<HTMLElement>();
	private docs = new Map<Document, MutationObserver>();
	private popupPaths = new Map<Document, string>();
	private stopped = false;
	private queued = false;
	private saves: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(onProChange(() => { this.refresh(); this.tab?.update(); }));
		this.tab = new BasesReadOnlySettingTab(this.app, this);
		this.addSettingTab(this.tab);
		if (!Platform.isMobile) {
			this.badge = this.addStatusBarItem();
			this.badge.addClass('brl-status');
			this.badge.setAttribute('role', 'button');
			this.badge.setAttribute('tabindex', '0');
			this.registerDomEvent(this.badge, 'click', () => void this.toggleActive());
			this.registerDomEvent(this.badge, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void this.toggleActive(); } });
		}
		this.addCommand({ id: 'toggle-lock', name: 'Toggle lock for current base', checkCallback: (checking) => { const file = this.activeBase(); if (!file) return false; if (!checking) void this.toggle(file.path); return true; } });
		this.addCommand({ id: 'lock-all', name: 'Lock all bases in kiosk mode', callback: () => void this.setKiosk(true) });
		this.addCommand({ id: 'stop-kiosk', name: 'Turn off kiosk mode', callback: () => void this.setKiosk(false) });
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file.extension !== 'base') return;
			menu.addItem((item) => item.setTitle(this.locked(file.path) ? 'Unlock base' : 'Lock base').setIcon(this.locked(file.path) ? 'lock-open' : 'lock').onClick(() => void this.toggle(file.path)));
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.refresh()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.refresh()));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			const next = renameLocked(this.settings, oldPath, file.path);
			// An embed can keep its old src until Obsidian updates the note links.
			for (const el of this.marked) {
				const path = el.getAttribute(PATH_ATTR) ?? '';
				if (path === oldPath || path.startsWith(oldPath + '/')) this.mark(el, file.path + path.slice(oldPath.length));
			}
			// A folder move sends one event for each file. Save only when a lock moves.
			if (next !== this.settings) { this.settings = next; void this.saveAndRefresh(true); }
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => { const next = removeLocked(this.settings, file.path); if (next !== this.settings) { this.settings = next; void this.saveAndRefresh(true); } }));
		this.registerMarkdownPostProcessor((el, ctx) => { for (const embed of Array.from(el.querySelectorAll<HTMLElement>(DOM.embed))) this.markEmbed(embed, ctx.sourcePath); this.schedule(); });
		this.app.workspace.onLayoutReady(() => { if (this.stopped) return; this.refresh(); void pro.refresh(); this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS)); });
	}

	onunload(): void {
		this.stopped = true;
		for (const observer of this.docs.values()) observer.disconnect();
		this.docs.clear();
		this.popupPaths.clear();
		for (const el of this.marked) { el.removeAttribute(PATH_ATTR); el.removeClass(LOCK_CLASS); }
		this.marked.clear();
		resetPro();
	}
	locked(path: string): boolean { return isLocked(this.settings, path, isPro()); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData()); }
	async saveSettings(): Promise<void> {
		const snapshot = normalizeSettings(this.settings);
		this.saves = this.saves.catch(() => undefined).then(() => this.saveData(snapshot));
		await this.saves;
	}
	async saveAndRefresh(updateTab = false): Promise<void> { this.settings = normalizeSettings(this.settings); this.refresh(); await this.saveSettings(); if (updateTab) this.tab?.update(); }
	async toggle(path: string): Promise<void> {
		if (!path.endsWith('.base')) return;
		if (this.locked(path) && !this.settings.locked.includes(path)) { new Notice('A rule or kiosk mode keeps this base locked. Change the plugin options first.'); return; }
		this.settings = toggleLocked(this.settings, path);
		await this.saveAndRefresh(true);
		new Notice(this.locked(path) ? `Locked ${path}. A rule or kiosk mode can keep a base locked.` : `Unlocked ${path}.`);
	}
	async setKiosk(on: boolean): Promise<void> {
		if (on && !isPro()) { new Notice('Kiosk mode needs pro. Sign in with GitHub in the plugin options.'); return; }
		this.settings = { ...this.settings, kiosk: on };
		await this.saveAndRefresh();
		new Notice(on ? 'Kiosk mode on.' : 'Kiosk mode off. Manual locks stay set.');
	}
	private activeBase(): TFile | null { const view = this.app.workspace.getActiveViewOfType(FileView); return view?.getViewType() === 'bases' && view.file?.extension === 'base' ? view.file : null; }
	private async toggleActive(): Promise<void> { const file = this.activeBase(); if (file) await this.toggle(file.path); }
	private schedule(): void { if (this.queued || this.stopped) return; this.queued = true; queueMicrotask(() => { this.queued = false; this.refresh(); }); }

	refresh(): void {
		if (this.stopped) return;
		const seen = new Set<HTMLElement>();
		this.watch(document);
		this.app.workspace.iterateAllLeaves((leaf) => {
			const el = leaf.view.containerEl;
			this.watch(el.ownerDocument);
			const file = leaf.view instanceof FileView ? leaf.view.file : null;
			if (leaf.view.getViewType() === 'bases' && file?.extension === 'base') { this.mark(el, file.path); seen.add(el); }
			for (const embed of Array.from(el.querySelectorAll<HTMLElement>(DOM.embed))) { this.markEmbed(embed, file?.path ?? ''); seen.add(embed); }
		});
		for (const [doc, observer] of this.docs) {
			// A closed pop-out window has no view. Drop its observer so the document can be freed.
			if (!doc.defaultView) { observer.disconnect(); this.docs.delete(doc); this.popupPaths.delete(doc); continue; }
			// A hover preview is outside each leaf. Keep the source path that the post processor gave its embeds.
			for (const embed of Array.from(doc.querySelectorAll<HTMLElement>(DOM.embed))) {
				const path = embed.getAttribute(PATH_ATTR);
				if (path && !seen.has(embed)) { this.mark(embed, path); seen.add(embed); }
			}
			const popups = Array.from(doc.querySelectorAll<HTMLElement>(DOM.popup));
			const path = this.popupPaths.get(doc) ?? this.activeBase()?.path;
			if (path) for (const popup of popups) { this.mark(popup, path); seen.add(popup); }
			if (!popups.length) this.popupPaths.delete(doc);
		}
		for (const el of this.marked) { if (!seen.has(el)) { el.removeAttribute(PATH_ATTR); el.removeClass(LOCK_CLASS); this.marked.delete(el); } }
		const file = this.activeBase();
		if (this.badge) {
			const base = file?.extension === 'base';
			const locked = base && this.locked(file.path);
			const text = base ? `Base ${locked ? 'locked' : 'unlocked'}${locked && isPro() && this.settings.editable.length ? ' · editable ' + this.settings.editable.join(', ') : ''}` : 'Base lock';
			if (this.badge.textContent !== text) this.badge.setText(text);
			this.badge.setAttribute('aria-label', base ? `${text}. Toggle lock for ${file.basename}` : 'Open a base to toggle its lock');
			this.badge.setAttribute('aria-disabled', String(!base));
			this.badge.toggleClass('brl-status-locked', locked);
		}
	}
	private mark(el: HTMLElement, path: string): void { if (el.getAttribute(PATH_ATTR) !== path) el.setAttribute(PATH_ATTR, path); el.toggleClass(LOCK_CLASS, this.locked(path)); this.marked.add(el); }
	private markEmbed(el: HTMLElement, source: string): void {
		const link = getLinkpath((el.getAttribute('src') ?? '').split('|')[0] ?? '');
		if (!link.endsWith('.base')) return;
		const file = this.app.metadataCache.getFirstLinkpathDest(link, source);
		if (file?.extension === 'base') this.mark(el, file.path);
	}
	private watch(doc: Document): void {
		if (this.docs.has(doc) || !doc.body) return;
		for (const type of EVENTS) this.registerDomEvent(doc, type, (event) => this.capture(event), { capture: true, passive: type === 'touchstart' });
		const observer = new MutationObserver(() => this.schedule());
		observer.observe(doc.body, { childList: true, subtree: true });
		this.docs.set(doc, observer);
	}
	private capture(event: Event): void {
		// The tag test also accepts elements from a popout document.
		const node = event.target as Node | null;
		const target = node?.nodeType === 1 ? node as Element : node?.parentElement;
		if (!target) return;
		const embed = target.closest<HTMLElement>(DOM.embed);
		if (embed && !embed.hasAttribute(PATH_ATTR)) { this.refresh(); }
		const root = target.closest<HTMLElement>(`[${PATH_ATTR}]`);
		const path = root?.getAttribute(PATH_ATTR);
		if (!root || !path) return;
		// A Bases tab's title bar and surrounding app controls remain usable.
		if (!embed && !target.closest(DOM.region)) return;
		const attempt = attemptOf(event, target, root);
		const blocked = shouldBlock(this.settings, path, isPro(), attempt);
		if (!blocked && (target.closest(DOM.switch) || target.closest(DOM.toolbar)) && !target.closest(DOM.popup)) this.popupPaths.set(target.ownerDocument, path);
		if (blocked) {
			// A canceled touch start also stops native scroll on mobile. Stop only the app handlers.
			if (event.type !== 'touchstart') event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		}
	}
}
