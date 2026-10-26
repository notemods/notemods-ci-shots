import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ColornoteBackupImportPlugin from '../src/main';
import { normalizeSettings } from '../src/settings';
import { bindPro, isPro, resetPro, SPONSORS, PRO_UI } from '../src/pro';
import { decodeBackup } from '../src/backup';
import { fixture, normal } from './fixture';
import manifest from '../manifest.json';
afterEach(resetPro);
function setup() {
	const app = App.createConfigured__({ files: { 'Existing.md': 'Keep this text.' } });
	const plugin = new ColornoteBackupImportPlugin(app as never, manifest as never);
	return { app, plugin };
}
function pro(on: boolean) { bindPro({ isPro: () => on, onChange: () => () => undefined } as never); }

describe('local import', () => {
	it('writes two duplicate titles with UUID paths and source dates', async () => {
		const { app, plugin } = setup(); const create = vi.spyOn(app.vault, 'create');
		const root = await plugin.importBackup(decodeBackup(fixture([normal, { ...normal, uuid: 'demo-002', note: '[ ] Item 1\n[V] Item 2' }]), '1234'));
		expect(create).toHaveBeenCalledTimes(3);
		expect(create.mock.calls[0]?.[0]).toBe(`${root}/Travel plan demo-001.md`);
		expect(create.mock.calls[1]?.[0]).toBe(`${root}/Travel plan demo-002.md`);
		expect(create.mock.calls[0]?.[2]).toEqual({ ctime: normal.created_date, mtime: normal.modified_date });
		expect(create.mock.calls[0]?.[1]).toContain('source_uuid: demo-001');
		expect(create.mock.calls[1]?.[1]).toContain('- [ ] Item 1\n- [x] Item 2');
		expect(create.mock.calls[2]?.[1]).toContain('Header count: 7');
		expect(create.mock.calls[2]?.[1]).toContain('Decoded records: 2');
		expect(JSON.stringify(plugin.settings)).not.toContain('1234');
	});
	it('reports the five omitted classes without note bodies', async () => {
		const { app, plugin } = setup(); const create = vi.spyOn(app.vault, 'create');
		const records = [{ ...normal, title: 'syncable_settings' }, { ...normal, encrypted: true }, { ...normal, active_state: 16 }, { ...normal, space: 16 }, { ...normal, type: 999 }];
		await plugin.importBackup(decodeBackup(fixture(records), '1234'));
		expect(create).toHaveBeenCalledTimes(1);
		const report = create.mock.calls[0]![1];
		for (const k of ['system', 'locked', 'trash', 'archive', 'unsupported']) expect(report).toContain(`${k}: 1`);
		expect(report).toContain('source ID 1'); expect(report).not.toContain(normal.note!);
	});
	it('rejects wrong passwords before a vault operation', () => {
		const { app } = setup(); const create = vi.spyOn(app.vault, 'create'); const folder = vi.spyOn(app.vault, 'createFolder');
		expect(() => decodeBackup(fixture(), 'wrong')).toThrow(); expect(create).not.toHaveBeenCalled(); expect(folder).not.toHaveBeenCalled();
	});
	it('uses a new folder on a repeated import', async () => {
		const { plugin } = setup(); const backup = decodeBackup(fixture(), '1234');
		const first = await plugin.importBackup(backup); const second = await plugin.importBackup(backup);
		expect(first).not.toBe(second);
	});
	it('keeps sanitized filename collisions separate', async () => {
		const { app, plugin } = setup(); const create = vi.spyOn(app.vault, 'create');
		await plugin.importBackup({ headerCount: 2, records: [normal, { ...normal, uuid: 'demo/001' }, { ...normal, uuid: 'demo:001' }] });
		const paths = create.mock.calls.map((v) => v[0]); expect(new Set(paths).size).toBe(4);
	});
	it('writes a title with a leading dot as a visible note', async () => {
		const { app, plugin } = setup(); const create = vi.spyOn(app.vault, 'create');
		const root = await plugin.importBackup({ headerCount: 1, records: [{ ...normal, title: '.env tips' }] });
		expect(create.mock.calls[0]?.[0]).toBe(`${root}/env tips demo-001.md`);
	});
	it('rejects unsafe destination folders before writes', async () => {
		const { app, plugin } = setup(); const create = vi.spyOn(app.vault, 'createFolder');
		await expect(plugin.importBackup({ headerCount: 1, records: [normal] }, '../outside')).rejects.toThrow('relative folder'); expect(create).not.toHaveBeenCalled();
	});
	it('reports a write error and the completed note count', async () => {
		const { app, plugin } = setup(); vi.spyOn(app.vault, 'create').mockRejectedValue(new Error('Disk full'));
		await expect(plugin.importBackup({ headerCount: 1, records: [normal] })).rejects.toThrow('Disk full Notes written: 0.');
	});
});

describe('Pro guards and profiles', () => {
	it('does not save a profile while signed out', async () => {
		const { plugin } = setup(); const save = vi.spyOn(plugin, 'saveData');
		expect(isPro()).toBe(false); expect(await plugin.saveProfile({ name: 'Travel', folder: 'Travel', colors: {} })).toBe(false); expect(save).not.toHaveBeenCalled();
	});
	it('saves and replaces a profile while Pro is on', async () => {
		pro(true); const { plugin } = setup(); const save = vi.spyOn(plugin, 'saveData').mockResolvedValue();
		await plugin.saveProfile({ name: 'Travel', folder: 'Trips', colors: { '0': 'Yellow' } });
		await plugin.saveProfile({ name: 'Travel', folder: 'Trips/Notes', colors: { '0': 'Green' } });
		expect(plugin.settings.profiles).toEqual([{ name: 'Travel', folder: 'Trips/Notes', colors: { '0': 'Green' } }]); expect(save).toHaveBeenCalledTimes(2);
	});
	it('adds mapped labels only with Pro', async () => {
		const { app, plugin } = setup(); const create = vi.spyOn(app.vault, 'create');
		await plugin.importBackup({ headerCount: 1, records: [normal] }, 'Imports', { '0': 'Yellow' }); expect(create.mock.calls[0]![1]).not.toContain('color_label');
		pro(true); await plugin.importBackup({ headerCount: 1, records: [normal] }, 'Imports', { '0': 'Yellow' }); expect(create.mock.calls[2]![1]).toContain('color_label: Yellow');
	});
	it('drops password and unknown saved settings fields', () => {
		expect(normalizeSettings({ password: 'secret', profiles: [{ name: 'Safe', folder: 'Notes', colors: {} }, { name: 'Bad', folder: '../bad', colors: {} }] })).toEqual({ profiles: [{ name: 'Safe', folder: 'Notes', colors: {} }] });
		expect(normalizeSettings(null)).toEqual({ profiles: [] });
	});
	it('uses the reference sponsorship terms', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, sponsorLogin: 'theluckystrike', scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});
