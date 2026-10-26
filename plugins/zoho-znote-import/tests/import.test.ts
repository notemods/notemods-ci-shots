import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ZohoZnoteImportPlugin, { parseIndex } from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { readTar, readZip } from '../src/archive';
import { validateProfile } from '../src/importer';
import { strToU8, zipSync } from 'fflate';
import { fixture, tar } from './helpers';
import manifest from '../manifest.json';

function plugin() {
	const app = App.createConfigured__({ files: { 'Existing/Keep.md': 'Keep this note.' } });
	return new ZohoZnoteImportPlugin(app as never, manifest as never);
}
function pro() { bindPro({ isPro: () => true, onChange: () => () => undefined } as never); }
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { resetPro(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('vault import and Pro boundaries', () => {
	it('creates notes and exact binary assets through Vault and keeps file dates', async () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'create'); const binary = vi.spyOn(p.app.vault, 'createBinary');
		const bytes = fixture([{ html: '<znresource relative-path="photo.png" type="image/png"/>', extra: [{ name: 'card1/photo.png', text: 'PNG bytes' }] }]);
		const result = await p.importBytes(bytes, 'Output');
		expect(result).toMatchObject({ notes: 1, assets: 1, warnings: [], report: 'Output/Import report.md' });
		expect(create).toHaveBeenCalledWith('Output/Notebook/Mine.md', expect.stringContaining('![[Output/assets/card1/photo.png]]'), { ctime: 1713025319000, mtime: 1713025724000 });
		expect(new Uint8Array(binary.mock.calls[0]![1])).toEqual(strToU8('PNG bytes'));
		expect(parseIndex(create.mock.calls.find(c => c[0] === 'Output/Card index.json')![1]).cards.card1?.digest).toMatch(/^[a-f0-9]{64}$/);
	});
	it('with network disabled a folder conflict causes zero writes and zero requests', async () => {
		const p = plugin(); const request = vi.fn(() => { throw new Error('Network disabled.'); }); vi.stubGlobal('fetch', request);
		const create = vi.spyOn(p.app.vault, 'create'); const folder = vi.spyOn(p.app.vault, 'createFolder'); const binary = vi.spyOn(p.app.vault, 'createBinary');
		await expect(p.importBytes(fixture([{}]), 'Existing')).rejects.toThrow('Output folder exists');
		expect(create).not.toHaveBeenCalled(); expect(folder).not.toHaveBeenCalled(); expect(binary).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
	});
	it('a free import makes no fetch request', async () => {
		const p = plugin(); const request = vi.fn(() => { throw new Error('Network disabled.'); }); vi.stubGlobal('fetch', request);
		await p.importBytes(fixture([{}]), 'Offline'); expect(request).not.toHaveBeenCalled();
	});
	it('free access cannot apply a profile or save one', async () => {
		const p = plugin(); const profile = { name: 'Work', notebookFolders: { Notebook: 'Projects' }, fields: { color: 'card_color' } };
		await expect(p.saveProfile(profile)).rejects.toThrow('Pro');
		await expect(p.importBytes(fixture([{}]), 'Mapped', profile)).rejects.toThrow('Pro');
		expect(p.app.vault.getAbstractFileByPath('Mapped')).toBeNull();
	});
	it('free access cannot create a review folder', async () => {
		const p = plugin(); await expect(p.importBytes(fixture([{}]), 'Review', null, 'Existing')).rejects.toThrow('Pro');
		expect(p.app.vault.getAbstractFileByPath('Review')).toBeNull();
	});
	it('Pro saves a local profile and maps notebook and field names', async () => {
		const p = plugin(); pro(); const save = vi.spyOn(p, 'saveSettings').mockResolvedValue();
		const profile = { name: 'Work', notebookFolders: { Notebook: 'Projects' }, fields: { color: 'card_color' } };
		await p.saveProfile(profile); expect(save).toHaveBeenCalledOnce(); expect(p.settings.profiles).toEqual([profile]);
		await p.importBytes(fixture([{}]), 'Mapped', profile);
		expect(p.app.vault.getAbstractFileByPath('Mapped/Projects/Mine.md')).not.toBeNull();
	});
	it('Pro compares later TAR bytes by ID and writes changed and new cards in a separate folder', async () => {
		const p = plugin(); pro();
		await p.importBytes(fixture([{ id: 'same', title: 'Same' }, { id: 'change', title: 'Before' }, { id: 'gone', title: 'Gone' }]), 'Baseline');
		const create = vi.spyOn(p.app.vault, 'create');
		const result = await p.importBytes(fixture([{ id: 'same', title: 'Same' }, { id: 'change', title: 'After' }, { id: 'new', title: 'New' }]), 'Review', null, 'Baseline');
		expect(result.notes).toBe(2);
		expect(p.app.vault.getAbstractFileByPath('Review/Notebook/Same.md')).toBeNull();
		expect(create.mock.calls.find(c => c[0] === 'Review/Import report.md')![1]).toContain('Absent from readable cards in this export: gone');
		expect(p.app.vault.getAbstractFileByPath('Baseline/Notebook/Before.md')).not.toBeNull();
		expect(p.app.vault.getAbstractFileByPath('Review/Notebook/After.md')).not.toBeNull();
	});
	it('rejects malformed baseline data before output writes', async () => {
		const p = plugin(); pro(); await p.app.vault.create('Existing/Card index.json', '{broken');
		await expect(p.importBytes(fixture([{}]), 'Review', null, 'Existing')).rejects.toThrow();
		expect(p.app.vault.getAbstractFileByPath('Review')).toBeNull();
	});
	it('a failed file write leaves existing files intact and releases the import guard', async () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'create').mockRejectedValueOnce(new Error('Disk full.'));
		await expect(p.importBytes(fixture([{}]), 'Attempt')).rejects.toThrow('Disk full');
		create.mockRestore(); await expect(p.importBytes(fixture([{}]), 'Retry')).resolves.toMatchObject({ notes: 1 });
	});
});
describe('archive and profile rejection', () => {
	it('rejects an outer ZIP path outside the archive', () => expect(() => readZip(zipSync({ '../outside': strToU8('x') }))).toThrow('Unsafe ZIP path'));
	it('rejects a broken TAR checksum and incomplete TAR', () => {
		const bytes = tar([{ name: 'card/Note.znel', text: 'x' }]); bytes[0] = 1;
		expect(() => readTar(bytes)).toThrow('checksum'); expect(() => readTar(new Uint8Array(20))).toThrow('Incomplete');
	});
	it('rejects an absolute TAR path and a device member', () => {
		expect(() => readTar(tar([{ name: '/outside' }]))).toThrow('Unsafe'); expect(() => readTar(tar([{ name: 'device', type: '3' }]))).toThrow('member type');
	});
	it('rejects profile paths and field collisions', () => {
		expect(() => validateProfile({ name: 'Bad', notebookFolders: { Notebook: '../outside' }, fields: {} })).toThrow();
		expect(() => validateProfile({ name: 'Bad', notebookFolders: {}, fields: { title: 'created' } })).toThrow();
	});
});
describe('review fixes', () => {
	it('a long title cut keeps whole characters and no trailing space or dot', async () => {
		const { safeName } = await import('../src/importer');
		expect(safeName(`${'a'.repeat(99)} bcd`)).toBe('a'.repeat(99));
		expect(safeName(`${'a'.repeat(99)}.x`)).toBe('a'.repeat(99));
		const emoji = safeName(`${'a'.repeat(99)}\u{1F600}x`);
		expect(emoji).toBe(`${'a'.repeat(99)}\u{1F600}`);
		expect(/[\uD800-\uDBFF]$/.test(emoji)).toBe(false);
	});
	it('a field name that matches an Object prototype member maps like any other name', async () => {
		const { planImport, readExport } = await import('../src/importer');
		const plan = planImport(readExport(fixture([{}])), 'Mapped', { name: 'p', notebookFolders: {}, fields: { color: 'toString' } });
		expect(plan.notes[0]!.content).toContain('toString: "#D4E0E3"');
	});
});
