import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import Plugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { HEADER, readRecords, type Change } from '../src/ledger';
import manifest from '../manifest.json';
afterEach(resetPro);
function setup(files: Record<string, string> = {}) { const app = App.createConfigured__({ files }); return { app, plugin: new Plugin(app as never, manifest as never) }; }
const record: Change = { time: '2026-10-13T09:00:00.000Z', path: 'Notes/A.md', key: 'status', old: { value: 'draft' }, new: { value: 'done' } };
describe('plugin integration with vault mocks', () => {
	it('loads defaults and repairs bad settings', async () => {
		const { plugin } = setup(); await plugin.loadSettings(); expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ keys: 4, profiles: [null], ledger: 42 })).toEqual(DEFAULT_SETTINGS);
	});
	it('appends two batches through Vault.process', async () => {
		const { plugin, app } = setup({ 'Property history.md': HEADER });
		await Promise.all([plugin.append([record]), plugin.append([{ ...record, path: 'Notes/B.md' }])]);
		const file = app.vault.getFileByPath('Property history.md')!;
		expect(readRecords(await app.vault.read(file))).toHaveLength(2);
	});
	it('creates a new ledger with its header', async () => {
		const { plugin } = setup(); await plugin.append([record]); expect(await plugin.history()).toEqual([record]);
	});
	it('retains writes when the selected ledger is an unrelated note', async () => {
		const { plugin, app } = setup({ 'Property history.md': '# Personal note' });
		await plugin.append([record]); expect(plugin.writer.pending).toBe(1);
		expect(await app.vault.read(app.vault.getFileByPath('Property history.md')!)).toBe('# Personal note');
	});
	it('guards profiles and export while core append stays free', async () => {
		const { plugin } = setup(); const spy = vi.spyOn(plugin, 'saveSettings');
		expect(isPro()).toBe(false); expect(await plugin.saveProfile('Review')).toBe(false);
		expect(await plugin.loadProfile('Review')).toBe(false); expect(await plugin.exportCsv('', '')).toBeNull();
		expect(spy).not.toHaveBeenCalled(); await plugin.append([record]); expect(await plugin.history()).toEqual([record]);
	});
	it('saves and loads profiles and exports with a cached Pro answer', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const { plugin, app } = setup(); await plugin.saveProfile('Review');
		expect(plugin.settings.profiles[0]?.keys).toBe('status, due');
		plugin.settings.folder = 'Other'; await plugin.loadProfile('Review'); expect(plugin.settings.folder).toBe('Notes');
		await plugin.append([record]); const path = await plugin.exportCsv('A', 'status');
		expect(path).toMatch(/\.csv$/); expect(await app.vault.read(app.vault.getFileByPath(path!)!)).toContain('draft');
	});
	it('keeps the reference sponsor terms', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0 }));
});
