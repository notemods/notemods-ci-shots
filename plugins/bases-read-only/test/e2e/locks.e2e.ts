import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { writeFileSync } from 'node:fs';
import { pluginId, reloadPlugin } from './load';
import type { LockSettings } from '../../src/policy';

const BASE = 'Bases Read Only/Projects.base';
const OTHER = 'Bases Read Only/Other.base';
const ATLAS = 'Bases Read Only/Notes/Atlas.md';
const VIEW = '.workspace-leaf.mod-active [data-type="bases"]';
const CELL = `${VIEW} .bases-tbody .bases-tr:first-child [data-property="note.project"]`;
const CHECK = `${VIEW} .bases-tbody .bases-tr:first-child [data-property="note.done"] input`;
interface TestPro {
	opts: { http: unknown };
	refreshNow(): Promise<void>;
	signOut(): void;
}
interface TestPlugin {
	settings: LockSettings;
	pro: TestPro;
	locked(path: string): boolean;
	saveAndRefresh(): Promise<void>;
	toggle(path: string): Promise<void>;
	setKiosk(on: boolean): Promise<void>;
}
async function configure(locked: string[], pro = false, extra: Partial<LockSettings> = {}): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, paths, premium, more) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!;
		p.pro.signOut();
		if (premium) {
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		}
		p.settings = { locked: paths, rules: [], editable: [], kiosk: false, ...more };
		await p.saveAndRefresh();
	}, pluginId, locked, pro, extra);
}
async function openBase(path = BASE): Promise<void> {
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => browser.execute((selector, cell) => document.querySelectorAll(selector).length === 6 && document.querySelector(cell)?.textContent?.trim() === 'Launch website', `${VIEW} .bases-tbody .bases-tr`, CELL), { timeout: 15000, timeoutMsg: 'six sample rows and Atlas project metadata did not render' });
}
async function dispatch(selector: string, type: string, init: Record<string, unknown> = {}): Promise<boolean> {
	return browser.execute((sel, eventType, options) => {
		const el = document.querySelector(sel);
		if (!el) throw new Error(`Missing event target ${sel}`);
		let e: Event;
		const opts = { bubbles: true, cancelable: true, ...options };
		if (eventType === 'keydown') e = new KeyboardEvent(eventType, opts);
		else if (eventType === 'pointerdown') e = new PointerEvent(eventType, opts);
		else if (['click', 'mousedown', 'dblclick', 'contextmenu'].includes(eventType)) e = new MouseEvent(eventType, opts);
		else e = new Event(eventType, opts);
		let reached = false;
		const witness = () => { reached = true; };
		el.addEventListener(eventType, witness, {capture: true, once: true});
		el.dispatchEvent(e);
		el.removeEventListener(eventType, witness, true);
		return e.defaultPrevented && !reached;
	}, selector, type, init);
}
async function baseLocked(path = BASE): Promise<boolean> {
	return browser.executeObsidian(({ app }, id, path) => (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!.locked(path), pluginId, path);
}

describe('Bases path locks in the real app', function () {
	beforeEach(async function () { await configure([BASE]); await openBase(); });

	it('blocks a text double click before the cell handler and keeps the note text', async function () {
		const before = await obsidianPage.read(ATLAS);
		const result = await browser.execute((selector) => {
			const el = document.querySelector(selector)!;
			let reached = false;
			el.addEventListener('dblclick', () => { reached = true; }, { once: true });
			const e = new MouseEvent('dblclick', { bubbles: true, cancelable: true }); el.dispatchEvent(e);
			return { cancelled: e.defaultPrevented, reached };
		}, CELL);
		expect(result).toEqual({ cancelled: true, reached: false });
		await browser.$(`${CELL} .metadata-input-longtext`).doubleClick();
		expect(await obsidianPage.read(ATLAS)).toBe(before);
	});

	it('a real checkbox click keeps done false', async function () {
		const before = await obsidianPage.read(ATLAS);
		expect(await browser.$(CHECK).isSelected()).toBe(false);
		await browser.$(CHECK).click();
		expect(await browser.$(CHECK).isSelected()).toBe(false);
		expect(await obsidianPage.read(ATLAS)).toBe(before);
	});

	it('real typing and paste keys do not change the text cell', async function () {
		const before = await obsidianPage.read(ATLAS);
		await browser.$(`${CELL} .metadata-input-longtext`).click();
		await browser.keys(['a', 'Enter']);
		for (const options of [{ key: 'a' }, { key: 'Enter' }, { key: 'v', ctrlKey: true }, { key: 'v', metaKey: true }]) expect(await dispatch(CELL, 'keydown', options)).toBe(true);
		for (const type of ['paste', 'beforeinput', 'cut']) expect(await dispatch(CELL, type)).toBe(true);
		expect(await browser.$(`${CELL} .metadata-input-longtext`).getText()).toBe('Launch website');
		expect(await obsidianPage.read(ATLAS)).toBe(before);
	});

	it('the file link stays clickable and opens Atlas', async function () {
		const sel = `${VIEW} .bases-tbody .bases-tr:first-child [data-property="file.name"] .internal-link`;
		expect(await dispatch(sel, 'mousedown')).toBe(false);
		await browser.$(sel).click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, ATLAS), { timeout: 10000, timeoutMsg: 'Atlas link did not open' });
	});

	it('hides mutable toolbar controls and keeps the view menu visible', async function () {
		const state = await browser.execute((sel) => {
			const root = document.querySelector(sel)!;
			const cls = ['.bases-toolbar-results-menu', '.bases-toolbar-sort-menu', '.bases-toolbar-group-menu', '.bases-toolbar-filter-menu', '.bases-toolbar-properties-menu', '.bases-toolbar-new-item-menu'];
			return { locked: root.classList.contains('brl-locked'), hidden: cls.map((s) => { const el = root.querySelector(s); return el === null || getComputedStyle(el).display === 'none'; }), switchVisible: getComputedStyle(root.querySelector('.bases-toolbar-views-menu')!).display !== 'none' };
		}, VIEW);
		expect(state.locked).toBe(true); expect(state.hidden).toEqual([true, true, true, true, true, true]); expect(state.switchVisible).toBe(true);
	});

	it('allows copy and navigation but blocks drag and context edits', async function () {
		for (const options of [{ key: 'c', ctrlKey: true }, { key: 'a', metaKey: true }, { key: 'ArrowDown' }, { key: 'Tab' }]) expect(await dispatch(CELL, 'keydown', options)).toBe(false);
		expect(await dispatch(CELL, 'wheel')).toBe(false);
		expect(await dispatch(CELL, 'mousedown')).toBe(false);
		for (const type of ['dragstart', 'drop', 'contextmenu']) expect(await dispatch(CELL, type)).toBe(true);
		expect(await dispatch(`${VIEW} .bases-thead .bases-td:first-child`, 'pointerdown')).toBe(true);
	});

	it('the command saves a lock across reload and removes it on a second toggle', async function () {
		await configure([]); await browser.executeObsidianCommand(`${pluginId}:toggle-lock`);
		await browser.waitUntil(async () => baseLocked(), { timeout: 10000 });
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		await browser.waitUntil(async () => baseLocked(), { timeout: 10000 });
		const data = await browser.executeObsidian(async ({ app }, id) => JSON.parse(await app.vault.adapter.read(`.obsidian/plugins/${id}/data.json`)) as LockSettings, pluginId);
		expect(data.locked).toEqual([BASE]);
		await browser.executeObsidianCommand(`${pluginId}:toggle-lock`);
		await browser.waitUntil(async () => !(await baseLocked()), { timeout: 10000 });
		expect(await dispatch(CELL, 'dblclick')).toBe(false);
	});

	it('the status badge toggles the current base', async function () {
		expect(await browser.$('.brl-status').getText()).toBe('Base locked');
		await browser.$('.brl-status').click(); await browser.waitUntil(async () => !(await baseLocked()), { timeout: 10000 });
		await browser.$('.brl-status').click(); await browser.waitUntil(async () => baseLocked(), { timeout: 10000 });
	});

	it('the base file menu can remove a manual lock', async function () {
		await browser.executeObsidian(({ app, obsidian }, path) => {
			const menu = new obsidian.Menu();
			menu.setUseNativeMenu(false);
			app.workspace.trigger('file-menu', menu, app.vault.getFileByPath(path), 'file-explorer');
			menu.showAtPosition({ x: 200, y: 200 });
		}, BASE);
		await browser.waitUntil(async () => browser.execute(() => Array.from(document.querySelectorAll('.menu-item-title')).some((el) => el.textContent === 'Unlock base')), { timeout: 5000 });
		await browser.execute(() => {
			const title = Array.from(document.querySelectorAll('.menu-item-title')).find((el) => el.textContent === 'Unlock base');
			(title?.closest('.menu-item') as HTMLElement | null)?.click();
		});
		await browser.waitUntil(async () => !(await baseLocked()), { timeout: 10000 });
	});

	it('a file move keeps the lock at the new path', async function () {
		const moved = 'Bases Read Only/Moved.base';
		await browser.executeObsidian(async ({ app }, from, to) => { const f = app.vault.getFileByPath(from)!; await app.vault.rename(f, to); }, BASE, moved);
		try { await browser.waitUntil(async () => baseLocked(moved), { timeout: 10000 }); expect(await baseLocked(BASE)).toBe(false); }
		finally { await browser.executeObsidian(async ({ app }, from, to) => { const f = app.vault.getFileByPath(from); if (f) await app.vault.rename(f, to); }, moved, BASE); }
	});

	it('an unlocked base accepts edits', async function () {
		await openBase(OTHER);
		expect(await dispatch(CELL, 'dblclick')).toBe(false);
		expect(await dispatch(CHECK, 'click')).toBe(false);
		// Restore the sample checkbox after this proof of the unlocked click handler.
		await browser.executeObsidian(async ({ app }, path) => { const f = app.vault.getFileByPath(path)!; await app.fileManager.processFrontMatter(f, (fm) => { fm.done = false; }); }, ATLAS);
	});

	it('marks two embeds separately in the same reading view', async function () {
		await obsidianPage.openFile('Bases Read Only/Review.md');
		await browser.executeObsidian(async ({ app }) => { const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getState().file === 'Bases Read Only/Review.md'); if (leaf) await leaf.setViewState({ type: 'markdown', state: { file: 'Bases Read Only/Review.md', mode: 'preview' } }); });
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .markdown-preview-view .internal-embed[src$=".base"]').length === 2), { timeout: 15000, timeoutMsg: 'two base embed containers did not render' });
		const prefixes = ['Projects.base', 'Other.base'];
		for (let i = 0; i < prefixes.length; i++) {
			const sel = `.workspace-leaf.mod-active .markdown-preview-view .internal-embed[src="${prefixes[i]}"]`;
			await browser.$(sel).scrollIntoView();
			await browser.waitUntil(async () => browser.execute((s) => Boolean(document.querySelector(s)?.querySelector('[data-property="note.project"]')), sel), { timeout: 15000, timeoutMsg: 'visible embed cell did not render' });
			expect(await browser.execute((s) => document.querySelector(s)?.classList.contains('brl-locked'), sel)).toBe(i === 0);
			expect(await dispatch(`${sel} [data-property="note.project"]`, 'dblclick')).toBe(i === 0);
		}
	});

	it('Pro can allow the done property while the project text stays locked', async function () {
		await configure([BASE], true, { editable: ['done'] });
		expect(await dispatch(CELL, 'dblclick')).toBe(true);
		await browser.$(CHECK).click();
		await browser.waitUntil(async () => (await obsidianPage.read(ATLAS)).includes('done: true'), { timeout: 10000 });
		expect(await dispatch(CHECK, 'dragstart')).toBe(true);
		await browser.executeObsidian(async ({ app }, path) => { await app.fileManager.processFrontMatter(app.vault.getFileByPath(path)!, (fm) => { fm.done = false; }); }, ATLAS);
		await configure([BASE], false, { editable: ['done'] });
		expect(await dispatch(CHECK, 'click')).toBe(true);
	});

	it('Pro rules and kiosk mode turn off on sign out; manual locks stay on', async function () {
		await configure([OTHER], true, { rules: ['Bases Read Only/**.base'] }); expect(await baseLocked(BASE)).toBe(true);
		await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, TestPlugin> } }).plugins.plugins[id]!.pro.signOut(), pluginId);
		expect(await baseLocked(BASE)).toBe(false); expect(await baseLocked(OTHER)).toBe(true);
		await configure([], true); await browser.executeObsidianCommand(`${pluginId}:lock-all`); expect(await baseLocked(BASE)).toBe(true); expect(await baseLocked(OTHER)).toBe(true);
		await browser.executeObsidianCommand(`${pluginId}:stop-kiosk`); expect(await baseLocked(BASE)).toBe(false);
	});

	it('locks native Kanban cards and column controls on versions that provide it', async function () {
		const available = await browser.executeObsidian(({ obsidian }) => obsidian.requireApiVersion('1.14.0'));
		if (!available) return; // 1.13.4 has no native Kanban view.
		const board = 'Bases Read Only/Board.base';
		await configure([board]);
		await obsidianPage.openFile(board);
		const html = await browser.execute(() => document.querySelector('.workspace-leaf.mod-active')?.outerHTML ?? '');
		writeFileSync('/tmp/brl-e2e-kanban.html', html);
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .bases-kanban-card').length > 0), { timeout: 15000, timeoutMsg: 'native Kanban did not render a visible card' });
		const card = '.workspace-leaf.mod-active .bases-kanban-card';
		const before = await obsidianPage.read(ATLAS);
		for (const type of ['dragstart', 'drop', 'pointerdown']) expect(await dispatch(card, type)).toBe(true);
		expect(await dispatch('.workspace-leaf.mod-active .bases-kanban-column-header', 'pointerdown')).toBe(true);
		const hidden = await browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .bases-kanban-column-create, .workspace-leaf.mod-active .bases-kanban-column-footer')).every((el) => getComputedStyle(el).display === 'none'));
		expect(hidden).toBe(true);
		expect(await obsidianPage.read(ATLAS)).toBe(before);
	});

	it('switches to saved cards and list views without exposing view changes', async function () {
		const before = await obsidianPage.read(BASE);
		await browser.$(`${VIEW} .bases-toolbar-views-menu .text-icon-button`).click();
		await browser.waitUntil(async () => browser.execute(() => document.querySelector('.bases-toolbar-menu')?.classList.contains('brl-locked')), { timeout: 5000 });
		const dom = await browser.execute(() => Array.from(document.querySelectorAll('.menu, .popover')).map((el) => el.outerHTML));
		writeFileSync(`/tmp/brl-menu-${browser.capabilities.browserVersion}.json`, JSON.stringify(dom, null, 2));
		const styles = await browser.execute(() => {
			const menu = document.querySelector('.bases-toolbar-menu')!;
			return { actions: getComputedStyle(menu.querySelector('[data-group="actions"]')!).display, edit: getComputedStyle(menu.querySelector('[data-group="views"] .clickable-icon')!).display };
		});
		expect(styles).toEqual({ actions: 'none', edit: 'none' });
		expect(await dispatch('.bases-toolbar-menu [data-group="views"] .clickable-icon', 'click')).toBe(true);
		expect(await dispatch('.bases-toolbar-menu [data-group="views"] .bases-toolbar-menu-item-info-icon', 'pointerdown')).toBe(true);
		await browser.$('.bases-toolbar-menu [data-group="views"] .bases-toolbar-menu-item:nth-child(2) .bases-toolbar-menu-item-name').click();
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .bases-cards-item').length > 0), { timeout: 10000 });
		expect(await dispatch('.workspace-leaf.mod-active .bases-cards-item', 'dragstart')).toBe(true);
		expect(await dispatch('.workspace-leaf.mod-active .bases-cards-item', 'pointerdown')).toBe(true);
		await browser.executeObsidian(async ({ app }, path) => { await app.workspace.openLinkText(path + '#List', '', false); }, BASE);
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .bases-list-item').length > 0), { timeout: 10000 });
		expect(await dispatch('.workspace-leaf.mod-active .bases-list-item', 'dragstart')).toBe(true);
		expect(await obsidianPage.read(BASE)).toBe(before);
	});
});
