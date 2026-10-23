import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ParagraphEnterPlugin, { TOGGLE_COMMAND, WELCOME } from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

const notices: string[] = [];
vi.spyOn(ParagraphEnterPlugin.prototype, 'notify').mockImplementation((m: string) => { notices.push(m); });

async function load(saved: unknown = null) {
	const app = App.createConfigured__({ files: { 'notes/a.md': 'Hello' } });
	const plugin = new ParagraphEnterPlugin(app as never, manifest as never);
	let data: unknown = saved;
	plugin.loadData = async () => data;
	plugin.saveData = async (d: unknown) => { data = JSON.parse(JSON.stringify(d)); };
	await plugin.onload();
	return { plugin, saved: () => data as Record<string, unknown> };
}

describe('ParagraphEnterPlugin', () => {
	it('is on after install, shows the undo command once and saves that it did', async () => {
		const { plugin, saved } = await load();
		expect(plugin.settings.enabled).toBe(true);
		expect(saved().welcomed).toBe(true);
		expect(WELCOME).toContain(`"${TOGGLE_COMMAND}"`);
		expect(notices).toEqual([WELCOME]);
		const again = await load(saved());
		expect(again.plugin.settings.welcomed).toBe(true);
		expect(notices).toEqual([WELCOME]);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ enabled: 'yes' as never, lineBreakStyle: 'tab' as never, welcomed: 1 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ enabled: false, lineBreakStyle: 'html', welcomed: true })).toEqual({ enabled: false, lineBreakStyle: 'html', welcomed: true });
	});

	it('toggle switches the mode, saves it and updates the status bar mark', async () => {
		const { plugin, saved } = await load({ welcomed: true });
		expect(plugin.statusEl?.textContent).toBe('¶');
		expect(plugin.statusEl?.hasClass('is-off')).toBe(false);
		await plugin.toggle();
		expect(plugin.settings.enabled).toBe(false);
		expect(saved().enabled).toBe(false);
		expect(plugin.statusEl?.hasClass('is-off')).toBe(true);
		plugin.statusEl?.click();
		await vi.waitFor(() => expect(plugin.settings.enabled).toBe(true));
	});

	it('Insert line break uses the chosen style', async () => {
		const { plugin } = await load({ welcomed: true, lineBreakStyle: 'spaces' });
		const editor = { replaceSelection: vi.fn() };
		plugin.insertLineBreak(editor as never);
		expect(editor.replaceSelection).toHaveBeenCalledWith('  \n');
	});
});
