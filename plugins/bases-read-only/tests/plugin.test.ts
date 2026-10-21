import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesReadOnlyPlugin from '../src/main';
import { normalizeSettings, removeLocked, renameLocked, shouldBlock } from '../src/policy';
import { attemptOf, propertyOf } from '../src/guard';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import { BasesReadOnlySettingTab } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); document.body.empty(); });
function plugin(): BasesReadOnlyPlugin {
	const app = App.createConfigured__({ files: { 'Projects.base': 'views: []', 'Atlas.md': '---\ndone: false\n---' } });
	return new BasesReadOnlyPlugin(app as never, manifest as never);
}

describe('saved locks and Pro', () => {
	it('loads the free default without Pro', async () => { const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual(normalizeSettings(null)); expect(isPro()).toBe(false); });
	it('repairs damaged saved data without discarding valid base paths', () => {
		expect(normalizeSettings({ locked: ['Projects.base', 2, 'Atlas.md', 'Projects.base'], editable: ['note.done'], rules: null, kiosk: 'yes' })).toEqual({ locked: ['Projects.base'], editable: ['done'], rules: [], kiosk: false });
	});
	it('serializes two saves so the second state wins', async () => {
		const p = plugin(); const writes: unknown[] = []; let finish: (() => void) | undefined;
		vi.spyOn(p, 'saveData').mockImplementation(async (data: unknown) => { writes.push(data); if (writes.length === 1) await new Promise<void>((r) => { finish = r; }); });
		p.settings.locked = ['Projects.base']; const first = p.saveSettings();
		await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
		p.settings = normalizeSettings(null); const second = p.saveSettings(); finish!(); await Promise.all([first, second]);
		expect(writes).toEqual([normalizeSettings({ locked: ['Projects.base'] }), normalizeSettings(null)]);
	});
	it('turns off the Pro facade on a negative answer and unload', () => {
		let active = true; let listener: (() => void) | undefined;
		bindPro({ isPro: () => active, onChange: (fn: () => void) => { listener = fn; return () => { listener = undefined; }; } } as never);
		const cb = vi.fn(); onProChange(cb); expect(isPro()).toBe(true); active = false; listener!(); expect(cb).toHaveBeenCalledTimes(1); expect(isPro()).toBe(false); resetPro(); expect(listener).toBeUndefined();
	});
	it('uses the reference sponsor terms', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
});

describe('DOM event adapter', () => {
	function table() {
		const root = document.body.createDiv({ attr: { 'data-brl-path': 'Projects.base' }, cls: 'brl-locked' });
		const view = root.createDiv({ cls: 'bases-view' });
		const head = view.createDiv({ cls: 'bases-thead' });
		head.createDiv({ cls: 'bases-th', attr: { 'data-property': 'note.done' } });
		const row = view.createDiv({ cls: 'bases-tbody' }).createDiv({ cls: 'bases-tr' });
		const cell = row.createDiv({ cls: 'bases-td' });
		return { root, cell, view };
	}
	it('maps a property through the table header', () => { const { root, cell } = table(); expect(propertyOf(cell, root)).toBe('note.done'); });
	it('unknown headers do not infer a property from a display name', () => { const { root, cell } = table(); root.querySelector('.bases-th')!.removeAttribute('data-property'); expect(propertyOf(cell, root)).toBeUndefined(); });
	it('classifies metadata links before cells', () => { const { root, cell } = table(); const link = cell.createSpan({ cls: 'metadata-link' }); expect(attemptOf(new MouseEvent('click'), link, root).zone).toBe('link'); });
	it('blocks events in capture phase before a cell listener can change a value', () => {
		const p = plugin(); p.settings.locked = ['Projects.base']; const { cell } = table();
		const capture = (e: Event) => (p as unknown as { capture(e: Event): void }).capture(e);
		document.addEventListener('dblclick', capture, true);
		try { const edit = vi.fn(); cell.addEventListener('dblclick', edit); const e = new MouseEvent('dblclick', { bubbles: true, cancelable: true }); expect(cell.dispatchEvent(e)).toBe(false); expect(e.defaultPrevented).toBe(true); expect(edit).not.toHaveBeenCalled(); }
		finally { document.removeEventListener('dblclick', capture, true); }
	});
	it('leaves an unlocked cell listener usable', () => {
		const p = plugin(); const { cell } = table(); const edit = vi.fn(); cell.addEventListener('dblclick', edit);
		const e = new MouseEvent('dblclick', { bubbles: true, cancelable: true }); (p as unknown as { capture(e: Event): void }).capture(e); cell.dispatchEvent(e); expect(e.defaultPrevented).toBe(false); expect(edit).toHaveBeenCalledOnce();
	});
});

describe('card and column drag adapter', () => {
	it.each(['bases-card', 'bases-cards-item', 'bases-kanban-card', 'bases-table-header'])('classifies %s as a drag target', (cls) => {
		const root = document.body.createDiv(); const el = root.createDiv({ cls });
		expect(attemptOf(new Event('pointerdown'), el, root).zone).toBe('drag');
	});
	it('allows a span file link on a draggable card to open', () => {
		const root = document.body.createDiv(); const card = root.createDiv({ cls: 'bases-cards-item' });
		const link = card.createSpan({ cls: 'internal-link' });
		expect(attemptOf(new Event('click'), link, root).zone).toBe('link');
	});
});

it('a property inside a card is a cell, while its card background is a drag target', () => {
	const root = document.body.createDiv(); const card = root.createDiv({ cls: 'bases-cards-item' });
	const property = card.createDiv({ cls: 'bases-cards-property', attr: { 'data-property': 'note.done' } });
	expect(attemptOf(new Event('pointerdown'), property, root)).toMatchObject({ zone: 'cell', property: 'note.done' });
	expect(attemptOf(new Event('pointerdown'), card, root).zone).toBe('drag');
});

describe('view menu guard', () => {
	function popup() {
		const root = document.body.createDiv({ cls: 'bases-toolbar-menu' });
		const group = root.createDiv({ attr: { 'data-group': 'views' } });
		const row = group.createDiv({ cls: 'bases-toolbar-menu-item' });
		return { root, row };
	}
	it('lets a saved view row switch views', () => { const { root, row } = popup(); expect(attemptOf(new MouseEvent('click'), row, root).zone).toBe('switch'); });
	it('blocks the settings button beside a view row', () => { const { root, row } = popup(); const button = row.createDiv({ cls: 'clickable-icon' }); expect(attemptOf(new MouseEvent('click'), button, root).zone).toBe('toolbar'); });
	it('blocks a view reorder grip', () => { const { root, row } = popup(); const grip = row.createDiv({ cls: 'bases-toolbar-menu-item-info-icon' }); expect(attemptOf(new Event('pointerdown'), grip, root).zone).toBe('drag'); });
	it('blocks creation actions outside the saved view group', () => { const { root } = popup(); const action = root.createDiv({ cls: 'bases-toolbar-menu-action' }); expect(attemptOf(new MouseEvent('click'), action, root).zone).toBe('toolbar'); });
	it('allows Escape to close the menu', () => { const { root } = popup(); expect(attemptOf(new KeyboardEvent('keydown', { key: 'Escape' }), root, root).zone).toBe('switch'); });
});

it('removes its path and CSS mark on unload without clearing the saved lock', () => {
	const p = plugin(); p.settings.locked = ['Projects.base']; const root = document.body.createDiv();
	(p as unknown as { mark(el: HTMLElement, path: string): void }).mark(root, 'Projects.base');
	expect(root.classList.contains('brl-locked')).toBe(true);
	p.onunload();
	expect(root.classList.contains('brl-locked')).toBe(false);
	expect(root.hasAttribute('data-brl-path')).toBe(false);
	expect(p.settings.locked).toEqual(['Projects.base']);
});

describe('review fixes', () => {
	const locked = normalizeSettings({ locked: ['Projects.base', 'Archive/Old.base', 'Archive/Deep/Older.base', 'Archived.base'] });
	it('blocks arrow steps in a locked number or date input', () => {
		const root = document.body.createDiv({ attr: { 'data-brl-path': 'Projects.base' } });
		const cell = root.createDiv({ cls: 'bases-view' }).createDiv({ cls: 'bases-td' });
		for (const type of ['number', 'date', 'datetime-local']) {
			const input = cell.createEl('input', { type });
			const attempt = attemptOf(new KeyboardEvent('keydown', { key: 'ArrowUp' }), input, root);
			expect(shouldBlock(locked, 'Projects.base', false, attempt)).toBe(true);
			expect(shouldBlock(locked, 'Projects.base', false, { ...attempt, key: 'PageDown', alt: true })).toBe(true);
		}
		const text = cell.createEl('input', { type: 'text' });
		expect(shouldBlock(locked, 'Projects.base', false, attemptOf(new KeyboardEvent('keydown', { key: 'ArrowDown' }), text, root))).toBe(false);
	});
	it('stops a touch start on a locked card but keeps native scroll', () => {
		const p = plugin(); p.settings.locked = ['Projects.base'];
		const root = document.body.createDiv({ attr: { 'data-brl-path': 'Projects.base' } });
		const card = root.createDiv({ cls: 'bases-view' }).createDiv({ cls: 'bases-cards-item' });
		const capture = (e: Event) => (p as unknown as { capture(e: Event): void }).capture(e);
		document.addEventListener('touchstart', capture, true);
		try { const drag = vi.fn(); card.addEventListener('touchstart', drag); const e = new Event('touchstart', { bubbles: true, cancelable: true }); card.dispatchEvent(e); expect(drag).not.toHaveBeenCalled(); expect(e.defaultPrevented).toBe(false); }
		finally { document.removeEventListener('touchstart', capture, true); }
	});
	it('removes locks below a deleted folder only', () => {
		expect(removeLocked(locked, 'Archive').locked).toEqual(['Projects.base', 'Archived.base']);
		expect(removeLocked(locked, 'Notes/Atlas.md')).toBe(locked);
	});
	it('keeps the same settings object after an unrelated rename', () => {
		expect(renameLocked(locked, 'Notes/Atlas.md', 'Notes/Atlas 2.md')).toBe(locked);
		expect(renameLocked(locked, 'Archive', 'Old').locked).toEqual(['Projects.base', 'Old/Old.base', 'Old/Deep/Older.base', 'Archived.base']);
	});
});

describe('audit fixes', () => {
	type Internals = { capture(e: Event): void; markEmbed(el: HTMLElement, source: string): void; watch(doc: Document): void; docs: Map<Document, MutationObserver> };
	it('keeps the lock on a base embed in a hover preview outside a workspace leaf', () => {
		const p = plugin(); p.settings.locked = ['Projects.base']; const internals = p as unknown as Internals;
		const popover = document.body.createDiv({ cls: 'popover hover-popover' });
		const embed = popover.createSpan({ cls: 'internal-embed bases-embed', attr: { src: 'Projects.base' } });
		const cell = embed.createDiv({ cls: 'bases-view' }).createDiv({ cls: 'bases-td' });
		internals.markEmbed(embed, 'Atlas.md');
		p.refresh();
		expect(embed.classList.contains('brl-locked')).toBe(true);
		const capture = (e: Event) => internals.capture.call(p, e);
		document.addEventListener('dblclick', capture, true);
		try { const e = new MouseEvent('dblclick', { bubbles: true, cancelable: true }); cell.dispatchEvent(e); expect(e.defaultPrevented).toBe(true); }
		finally { document.removeEventListener('dblclick', capture, true); p.onunload(); }
	});
	it('keeps a comma inside one lock rule line', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const p = plugin(); vi.spyOn(p, 'saveData').mockResolvedValue();
		const tab = new BasesReadOnlySettingTab(p.app, p);
		await tab.setControlValue('rulesText', 'Clients, old/**.base\nArchive');
		expect(p.settings.rules).toEqual(['Clients, old/**.base', 'Archive']);
	});
	it('drops the observer of a closed pop-out window document', () => {
		const p = plugin(); const internals = p as unknown as Internals;
		const closed = document.implementation.createHTMLDocument('closed');
		internals.watch(closed);
		expect(internals.docs.has(closed)).toBe(true);
		p.refresh();
		expect(internals.docs.has(closed)).toBe(false);
		p.onunload();
	});
});
