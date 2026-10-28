import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, PluginSettingTab } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import TagPropertiesPlugin from '../src/main';
import { TagPropertiesSettingTab } from '../src/settings';
import { PRO_CORE, PRO_SEVERAL, bindPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user who selects Include core tags, or saves more than one tag property, gets the shared Pro notice with
// the "Sponsor on GitHub" button. The toggle is not saved and shows off. The first tag property still saves (free).
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'tag-properties' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new TagPropertiesPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	bindPro(fakePro(pro));
	plugin.refresh = vi.fn();
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
		// A shown notice is in the document until it hides.
		document.body.append(this.messageEl);
	});
	// The Obsidian base setControlValue writes plugin.settings and saves; the mock does not, so record the calls.
	const base = vi.spyOn(PluginSettingTab.prototype, 'setControlValue').mockResolvedValue(undefined);
	const tab = new TagPropertiesSettingTab(app as never, plugin);
	const update = vi.spyOn(tab, 'update').mockImplementation(() => undefined);
	return { plugin, tab, shown, base, update };
}

describe('Pro settings', () => {
	afterEach(() => { bindPro(null); vi.restoreAllMocks(); document.body.empty(); });

	it('a free user who selects Include core tags gets the Pro notice with a Sponsor button, nothing is saved, and the toggle shows off', async () => {
		const { plugin, tab, shown, base, update } = await setup(false);
		plugin.settings.includeCore = true;
		expect(tab.getControlValue('includeCore')).toBe(false);
		await tab.setControlValue('includeCore', true);
		expect(shown).toEqual([{ text: `${PRO_CORE} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
		expect(base).not.toHaveBeenCalled();
		expect(update).toHaveBeenCalledOnce();
	});

	it('a free user who saves several tag properties keeps the first one and gets the Pro notice once while it shows', async () => {
		const { tab, shown, base } = await setup(false);
		await tab.setControlValue('properties', 'topics');
		expect(shown).toEqual([]);
		await tab.setControlValue('properties', 'topics,');
		await tab.setControlValue('properties', 'topics,c');
		await tab.setControlValue('properties', 'topics,co');
		expect(base.mock.calls.map((c) => c[1])).toEqual(['topics', 'topics,', 'topics,c', 'topics,co']);
		expect(shown).toEqual([{ text: `${PRO_SEVERAL} ${PITCH}Sponsor on GitHub`, buttons: 1 }]);
	});

	it('a Pro user who selects Include core tags and saves several properties gets them, with no Pro notice', async () => {
		const { tab, shown, base } = await setup(true);
		await tab.setControlValue('includeCore', true);
		await tab.setControlValue('properties', 'topics,company');
		expect(base.mock.calls).toEqual([['includeCore', true], ['properties', 'topics,company']]);
		expect(shown).toEqual([]);
	});
});
