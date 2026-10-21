// Real settings and report controls. The sponsorship response is local test data.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type FountainReferencePanelPlugin from '../../src/main';
import { pluginId } from './load';

type PluginApp = { plugins: { plugins: Record<string, FountainReferencePanelPlugin> } };
type SettingsApp = { setting: { open(): void; close(): void; openTabById(id: string): void } };
const ROOT = 'Fountain Reference Panel';

async function mockPro(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		const plugin = (app as unknown as PluginApp).plugins.plugins[id]!;
		plugin.pro!.opts.http = async () => ({ status: 200, json: {
			data: {
				viewer: { login: 'demo-reader' },
				user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } },
			},
		} });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await plugin.pro!.refreshNow();
	}, pluginId);
}

describe(`${pluginId} Pro controls`, function () {
	before(async function () {
		await browser.executeObsidian(({ app }) => {
			(app.vault as unknown as { setConfig(key: string, value: boolean): void }).setConfig('settingsPopoutWindow', false);
		});
	});

	afterEach(async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			(app as unknown as SettingsApp).setting.close();
			const plugin = (app as unknown as PluginApp).plugins.plugins[id]!;
			plugin.settings.folders = '';
			await plugin.saveSettings();
			plugin.pro!.signOut();
		}, pluginId);
	});

	it('disables the folder control without Pro', async function () {
		await browser.executeObsidian(({ app }, id) => {
			const settings = (app as unknown as SettingsApp).setting;
			settings.open();
			settings.openTabById(id);
		}, pluginId);
		const folders = await browser.$('textarea[placeholder="Scripts/Feature film"]');
		await folders.waitForDisplayed({ timeout: 20000 });
		expect(await folders.isEnabled()).toBe(false);
	});

	it('saves the project folders and uses them after Refresh', async function () {
		await mockPro();
		await browser.executeObsidian(({ app }, id) => {
			const settings = (app as unknown as SettingsApp).setting;
			settings.open();
			settings.openTabById(id);
		}, pluginId);
		const folders = await browser.$('textarea[placeholder="Scripts/Feature film"]');
		await folders.waitForDisplayed({ timeout: 20000 });
		expect(await folders.isEnabled()).toBe(true);
		await folders.setValue(`${ROOT}/Scripts`);
		await browser.waitUntil(async () => browser.executeObsidian(async ({ app }, id) => {
			const plugin = (app as unknown as PluginApp).plugins.plugins[id]!;
			const data = await plugin.loadData() as { folders?: string };
			return data.folders === 'Fountain Reference Panel/Scripts';
		}, pluginId), { timeout: 20000 });
		await browser.executeObsidian(({ app }) => (app as unknown as SettingsApp).setting.close());
		await obsidianPage.openFile(`${ROOT}/Characters/Ada.md`);
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const plugin = (app as unknown as PluginApp).plugins.plugins[id]!;
			await plugin.loadSettings();
			await plugin.openPanel();
			await plugin.refresh();
			return { scripts: plugin.scan!.scripts, sources: plugin.views()[0]!.rows.map((r) => r.source) };
		}, pluginId);
		expect(result.scripts).toBe(2);
		expect(result.sources).toEqual([`${ROOT}/Scripts/Episode 2.fountain`, `${ROOT}/Scripts/Pilot.fountain`, `${ROOT}/Scripts/Pilot.fountain`]);
		expect(await browser.$('.fountain-reference-panel-status').getText()).toContain('scanned in the project folders');
	});

	it('exports only the notes selected in the report modal', async function () {
		await mockPro();
		await browser.executeObsidian(async ({ app }, id) => {
			const plugin = (app as unknown as PluginApp).plugins.plugins[id]!;
			await plugin.refresh();
			await plugin.openReport();
		}, pluginId);
		const items = await browser.$$('.fountain-reference-panel-report .setting-item');
		expect(await items.length).toBe(4);
		await items[0]!.$('.checkbox-container').click();
		await items[1]!.$('.checkbox-container').click();
		await browser.$('.fountain-reference-panel-report button').click();
		await browser.waitUntil(async () => !(await browser.$('.fountain-reference-panel-report').isExisting()), { timeout: 20000 });
		const report = await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getMarkdownFiles().find((f) => f.basename.startsWith('Fountain reference report '))!;
			return { path: file.path, text: await app.vault.read(file) };
		});
		try {
			expect(report.text).toContain(`## ${ROOT}/Characters/Ada.md`);
			expect(report.text).toContain(`## ${ROOT}/Characters/Ben.md`);
			expect(report.text).not.toContain(`## ${ROOT}/Locations/Lighthouse.md`);
			expect(report.text).toContain('3 scripts, 1 unresolved target, 0 read failures.');
			expect(report.text).toContain(`| ${ROOT}/Scripts/Pilot.fountain | 22 | INT. RADIO ROOM - LATER | Ada picks up the handset. Ada smiles. |`);
		} finally {
			await obsidianPage.delete(report.path);
		}
	});
});
