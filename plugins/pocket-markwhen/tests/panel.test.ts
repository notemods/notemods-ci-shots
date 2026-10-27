import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import type PocketMarkwhenPlugin from '../src/main';
import { TimelinePanel } from '../src/panel';
import { bindPro, resetPro, SPONSORS } from '../src/pro';
import { normalizeSettings } from '../src/settings';

const panels: TimelinePanel[] = [];
afterEach(() => { for (const p of panels.splice(0)) p.unload(); resetPro(); document.body.empty(); });
function manager(pro: boolean) {
	let active = pro;
	const listeners = new Set<() => void>();
	const m = { isPro: () => active, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' }, onChange: (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); }, set(value: boolean) { active = value; for (const cb of listeners) cb(); } };
	bindPro(m as never); return m;
}
function panel(source = '2026-03-01: A\n\n# Later\n2027: Year event') {
	const app = App.createConfigured__({ files: { 'trip.mw': source, 'extra.mw': '2026-03-02: Rome #italy' } });
	const plugin = { app, settings: { savedFilters: [] }, saveSettings: vi.fn(async () => {}) } as unknown as PocketMarkwhenPlugin;
	const el = document.body.createDiv();
	const p = new TimelinePanel(el, plugin, [{ source, path: 'trip.mw' }]); panels.push(p); p.load();
	return { p, el, plugin, app };
}
describe('timeline panel', () => {
	it('renders rows and collapsible heading groups', () => {
		const { el } = panel();
		expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(2);
		expect(el.querySelector('summary')?.textContent).toContain('Pro');
		expect(el.querySelector('.pocket-markwhen-group summary')?.textContent).toBe('Later');
	});
	it('filters ranges that overlap a boundary', () => {
		const { p, el } = panel('2026-03-01: A\n2026-03-02 / 2026-03-05: Rome #italy\n2026-04: B');
		p.applyFilter({ from: '2026-03-05', to: '2026-03-31', tag: '' });
		expect(el.querySelectorAll('.pocket-markwhen-text')).toHaveLength(1);
		expect(el.querySelector('.pocket-markwhen-text')?.textContent).toBe('Rome');
	});
	it('reports an invalid range', () => {
		const { p, el } = panel(); p.applyFilter({ from: '2027-01-01', to: '2026-01-01', tag: '' });
		expect(el.querySelector('[role="status"]')?.textContent).toBe('From must be on or before to.');
	});
	it('does not execute HTML in event text', () => {
		const { el } = panel('2026-03-01: <img src=x onerror=bad()>');
		expect(el.querySelector('img')).toBeNull();
		expect(el.querySelector('.pocket-markwhen-text')?.textContent).toBe('<img src=x onerror=bad()>');
	});
	it('opens a collapsed group and highlights the first future event', () => {
		const { p, el } = panel();
		const details = el.querySelector<HTMLDetailsElement>('.pocket-markwhen-group')!; details.open = false;
		vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
		expect(p.goToday('2026-10-12')).toBe(true);
		expect(details.open).toBe(true);
		expect(el.querySelector('.pocket-markwhen-today')?.textContent).toContain('Year event');
	});
	it('shows a message when Today has no target', () => {
		const { p, el } = panel('2026-03-01: A'); expect(p.goToday('2026-10-12')).toBe(false);
		expect(el.querySelector('[role="status"]')?.textContent).toContain('No event starts');
	});
	it('keeps empty and undated blocks quiet', () => {
		const error = vi.spyOn(console, 'error'); const { el } = panel('hello\nworld');
		expect(el.querySelector('[role="status"]')?.textContent).toBe('No dated events'); expect(error).not.toHaveBeenCalled();
	});
	it('blocks the three Pro operations when signed out', async () => {
		manager(false); const { p, plugin, app } = panel();
		const read = vi.spyOn(app.vault, 'read'); const create = vi.spyOn(app.vault, 'create');
		expect(await p.combine(['extra.mw'])).toBe(false); expect(await p.saveFilter('Trip')).toBe(false); expect(await p.exportMarkdown()).toBeNull();
		expect(read).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
	it('combines vault files with source labels then removes them on sign out', async () => {
		const m = manager(true); const { p, el } = panel();
		expect(await p.combine(['extra.mw', 'extra.mw', 'missing.mw'])).toBe(true);
		expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(3);
		expect(el.textContent).toContain('extra.mw'); m.set(false);
		expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(2);
	});
	it('saves a named filter and replaces its previous value', async () => {
		manager(true); const { p, plugin } = panel(); p.applyFilter({ from: '2026-03-01', to: '', tag: 'italy' });
		await p.saveFilter('Trip'); await p.saveFilter(' Trip ');
		expect(plugin.settings.savedFilters).toEqual([{ name: 'Trip', from: '2026-03-01', to: '', tag: 'italy' }]);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
	});
	it('exports only the filtered events to a new file', async () => {
		manager(true); const { p, app } = panel('2026-03-01: A\n2026-03-02: Rome #italy');
		p.applyFilter({ from: '', to: '', tag: 'italy' });
		const first = await p.exportMarkdown(); const second = await p.exportMarkdown();
		expect(first).not.toBe(second);
		const file = app.vault.getFileByPath(first!)!;
		expect(await app.vault.read(file)).toBe('- 2026-03-02: Rome #italy (trip.mw)\n');
	});
	it('uses a singular status for one event', () => {
		const { el } = panel('2026-03-01: A');
		expect(el.querySelector('[role="status"]')?.textContent).toBe('1 dated event');
	});
	it('matches a tag without regard to case', () => {
		const { p, el } = panel('2026-03-01: A #Work\n2026-03-02: B #home');
		p.applyFilter({ from: '', to: '', tag: '#work' });
		expect(el.querySelector('.pocket-markwhen-text')?.textContent).toBe('A');
		expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(1);
	});
	it('removes a combined file from the view after the file is deleted', async () => {
		manager(true); const { p, el, app } = panel();
		expect(await p.combine(['extra.mw'])).toBe(true);
		expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(3);
		await app.vault.delete(app.vault.getFileByPath('extra.mw')!);
		await vi.waitFor(() => expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(2));
		expect(el.querySelector('.pocket-markwhen-rows')?.textContent).not.toContain('extra.mw');
	});
	it('removes a combined file from the view after the file is renamed', async () => {
		manager(true); const { p, el, app } = panel();
		expect(await p.combine(['extra.mw'])).toBe(true);
		await app.vault.rename(app.vault.getFileByPath('extra.mw')!, 'moved.mw');
		await vi.waitFor(() => expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(2));
	});
	it('uses the reference Sponsors terms', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
	it('drops malformed saved filters', () => expect(normalizeSettings({ savedFilters: [null, { name: 4 }] as never })).toEqual({ savedFilters: [] }));
});
