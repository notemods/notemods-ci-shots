import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import VisualLineNumbersPlugin from '../src/main';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, PRO_LEADS, VisualLineNumbersSettingTab, effectiveSettings, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
	};
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new VisualLineNumbersPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ mode: 'sideways' as never, enabled: 'yes' as never, colorRelative: 'blue', colorAbsolute: '#ABCDEF' })).toEqual({ ...DEFAULT_SETTINGS, colorAbsolute: '#abcdef' });
		expect(normalizeSettings({ mode: 'hybrid', countFolded: true }).mode).toBe('hybrid');
	});

	it('applies Pro choices only while Pro is on', () => {
		const saved = normalizeSettings({ countFolded: true, highlightCurrent: true, motionHint: true, noteProperty: true });
		expect(effectiveSettings(saved, false)).toEqual({ enabled: true, mode: 'relative', countFolded: false, highlightCurrent: false, motionHint: false, noteProperty: false });
		expect(effectiveSettings(saved, true)).toEqual({ enabled: true, mode: 'relative', countFolded: true, highlightCurrent: true, motionHint: true, noteProperty: true });
	});

	it('keeps the saved dual mode after a reload and without Pro', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new VisualLineNumbersPlugin(app as never, manifest as never);
		plugin.settings = normalizeSettings({ mode: 'dual', countFolded: true });
		await plugin.saveSettings();
		const reloaded = new VisualLineNumbersPlugin(app as never, manifest as never);
		// The mock stores data on each instance. Supply the saved file to the new instance.
		vi.spyOn(reloaded, 'loadData').mockResolvedValue(structuredClone(await plugin.loadData()));
		await reloaded.loadSettings();
		expect(reloaded.settings.mode).toBe('dual');
		expect(effectiveSettings(reloaded.settings, false)).toMatchObject({ mode: 'dual', countFolded: false });
	});

	it('offers dual mode in the free number mode setting', () => {
		const app = App.createConfigured__();
		const plugin = new VisualLineNumbersPlugin(app as never, manifest as never);
		const tab = new VisualLineNumbersSettingTab(app as never, plugin);
		const modes = tab.getSettingDefinitions().find((item) => 'name' in item && item.name === 'Number mode');
		expect(modes).toMatchObject({ control: { key: 'mode', type: 'dropdown', options: { dual: 'Dual: line numbers on the left, row distances on the right' } } });
	});
});

describe('pro colors', () => {
	it('sets and clears the colors in pop-out windows as well as the main window', async () => {
		const app = App.createConfigured__();
		const plugin = new VisualLineNumbersPlugin(app as never, manifest as never);
		const popout = document.implementation.createHTMLDocument('popout');
		const opened = document.implementation.createHTMLDocument('opened');
		vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((cb) => cb({ view: { containerEl: { doc: popout } } } as never));
		await plugin.onload();
		bindPro(fakeManager(true) as never);
		plugin.settings = normalizeSettings({ colorRelative: '#112233' });
		plugin.applySettings();
		expect(document.body.style.getPropertyValue('--vln-color-relative')).toBe('#112233');
		expect(popout.body.style.getPropertyValue('--vln-color-relative')).toBe('#112233');
		app.workspace.trigger('window-open', { doc: opened }, opened.defaultView);
		expect(opened.body.style.getPropertyValue('--vln-color-relative')).toBe('#112233');
		plugin.onunload();
		expect(document.body.style.getPropertyValue('--vln-color-relative')).toBe('');
		expect(popout.body.style.getPropertyValue('--vln-color-relative')).toBe('');
	});
});

describe('pro facade', () => {
	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		expect(isPro()).toBe(false);
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		m.set(false);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(isPro()).toBe(false);
	});

	it('resetPro drops the manager and the listeners', () => {
		bindPro(fakeManager(true) as never);
		expect(isPro()).toBe(true);
		resetPro();
		expect(isPro()).toBe(false);
	});

	it('uses the seller values from product.yaml', () => {
		expect(SPONSORS.sponsorLogin).toBe('theluckystrike');
		expect(SPONSORS.minMonthlyUsd).toBe(5);
		expect(SPONSORS.oneTimeUsd).toBe(15);
	});
});

describe('pro options for a free user', () => {
	function setup() {
		const app = App.createConfigured__();
		const plugin = new VisualLineNumbersPlugin(app as never, manifest as never);
		const tab = new VisualLineNumbersSettingTab(app as never, plugin);
		const texts: string[] = [];
		vi.spyOn(Notice.prototype, 'constructor__').mockImplementation((message: unknown) => { texts.push(String(message)); });
		const update = vi.spyOn(tab, 'update');
		// The mock base class does not write the value. Record what the tab passes on to it.
		const base = Object.getPrototypeOf(VisualLineNumbersSettingTab.prototype) as { setControlValue(key: string, value: unknown): unknown };
		const written: [string, unknown][] = [];
		vi.spyOn(base, 'setControlValue').mockImplementation((key: string, value: unknown) => { written.push([key, value]); });
		return { plugin, tab, texts, update, written };
	}

	it('keeps every Pro control enabled', () => {
		const { tab } = setup();
		const group = tab.getSettingDefinitions().find((item) => 'heading' in item && item.heading === 'Pro options') as { items: { control?: { key: string; disabled?: unknown } }[] };
		const keys = group.items.filter((i) => i.control).map((i) => i.control!.key);
		expect(keys.sort()).toEqual(Object.keys(PRO_LEADS).sort());
		for (const item of group.items) expect(item.control?.disabled).toBeUndefined();
	});

	it('shows the Pro notice for each Pro option, saves nothing and redraws the tab', async () => {
		const { plugin, tab, texts, update, written } = setup();
		const save = vi.spyOn(plugin, 'saveData');
		for (const [key, lead] of Object.entries(PRO_LEADS)) {
			await tab.setControlValue(key, key.startsWith('color') ? '#112233' : true);
			expect(texts.some((t) => t.startsWith(lead))).toBe(true);
		}
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(save).not.toHaveBeenCalled();
		expect(written).toEqual([]);
		expect(update).toHaveBeenCalledTimes(Object.keys(PRO_LEADS).length);
	});

	it('shows one notice for many changes of one color in a short time', async () => {
		const { tab, texts } = setup();
		for (const c of ['#111111', '#222222', '#333333']) await tab.setControlValue('colorRelative', c);
		expect(texts.filter((t) => t.startsWith(PRO_LEADS.colorRelative!)).length).toBe(1);
	});

	it('shows the values in effect, and a refused select moves the focus out of the tab', async () => {
		const { plugin, tab, update } = setup();
		plugin.settings = { ...DEFAULT_SETTINGS, countFolded: true, highlightCurrent: true, motionHint: true, noteProperty: true, colorAbsolute: '#112233', colorRelative: '#112233', colorHybrid: '#112233' };
		// A free user sees the free values: Pro toggles off and the theme color. The stored choice stays for the time that Pro comes back.
		for (const key of Object.keys(PRO_LEADS)) expect(tab.getControlValue(key)).toBe(key.startsWith('color') ? '' : false);
		// Obsidian does not draw a control again while it has the focus, so the refusal moves the focus out first.
		activeDocument.body.appendChild(tab.containerEl);
		const box = tab.containerEl.createEl('input');
		box.focus();
		expect(activeDocument.activeElement).toBe(box);
		await tab.setControlValue('countFolded', true);
		expect(activeDocument.activeElement).not.toBe(box);
		expect(update).toHaveBeenCalledTimes(1);
		expect(plugin.settings.countFolded).toBe(true);
		tab.containerEl.remove();
	});

	it('changes free options with no notice', async () => {
		const { tab, texts, written } = setup();
		await tab.setControlValue('mode', 'hybrid');
		expect(written).toEqual([['mode', 'hybrid']]);
		expect(texts).toEqual([]);
	});

	it('saves a Pro option for a Pro user with no notice', async () => {
		const { tab, texts, update, written } = setup();
		bindPro(fakeManager(true) as never);
		await tab.setControlValue('countFolded', true);
		await tab.setControlValue('colorHybrid', '#aabbcc');
		expect(written).toEqual([['countFolded', true], ['colorHybrid', '#aabbcc']]);
		expect(texts).toEqual([]);
		expect(update).not.toHaveBeenCalled();
	});
});
