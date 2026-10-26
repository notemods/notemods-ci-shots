import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notice, TFile, TFolder } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { strFromU8, unzipSync } from 'fflate';
import PocketMochiExportPlugin, { notesIn } from '../src/main';
import { buildArchive } from '../src/archive';
import { archivePath, ednString, parseCards } from '../src/mochi';
import { previewLines } from '../src/preview';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';
import { readEdn, type Edn } from './edn';

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function buf(u: Uint8Array): ArrayBuffer {
	return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function setup(files: Record<string, string>, images: string[] = []) {
	const dirs = Object.fromEntries(images.filter((p) => p.includes('/')).map((p) => [`${p.slice(0, p.lastIndexOf('/'))}/`, '']));
	const app = App.createConfigured__({ files: { ...dirs, ...files } });
	for (const p of images) await app.vault.createBinary(p, buf(PNG));
	const plugin = new PocketMochiExportPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	const shown: string[] = [];
	vi.spyOn(Notice.prototype as never, 'constructor__' as never).mockImplementation(((m: unknown) => {
		shown.push(String(m));
	}) as never);
	const previews: { target: string; lines: ReturnType<typeof previewLines> }[] = [];
	plugin.confirm = (plan, target) => {
		previews.push({ target, lines: previewLines(plan, target) });
		return Promise.resolve(true);
	};
	const file = (p: string) => app.vault.getFileByPath(p) as unknown as TFile;
	const zip = async (p: string) => unzipSync(new Uint8Array(await app.vault.readBinary(app.vault.getFileByPath(p)!)));
	return { app, plugin, shown, previews, file, zip };
}

function get(m: Edn, ...path: (string | number)[]): Edn {
	let v: Edn = m;
	for (const k of path) v = typeof k === 'number' ? (v as Edn[])[k]! : (v as Map<string, Edn>).get(k)!;
	return v;
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const { plugin } = await setup({ 'notes/a.md': '# Hello world' });
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS).toEqual({ tag: '#card', folder: 'Mochi exports', presets: '' });
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ tag: 5 as never, folder: '   ', presets: 1 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ tag: 'bio', folder: '/Out/Mochi/', presets: 'A | b' })).toEqual({ tag: '#bio', folder: 'Out/Mochi', presets: 'A | b' });
		expect(normalizeSettings({ tag: 'two words' }).tag).toBe('#card');
	});
});

describe('export active note (free)', () => {
	it('case 1 and 10: writes Mochi exports/Bio.mochi with exactly data.edn, version 2 and one deck', async () => {
		const t = await setup({ 'Bio.md': '## Cell #card\nThe basic unit of life\n---\n' });
		const path = await t.plugin.exportNote(t.file('Bio.md'));
		expect(path).toBe('Mochi exports/Bio.mochi');
		const z = await t.zip(path!);
		expect(Object.keys(z)).toEqual(['data.edn']);
		const edn = readEdn(strFromU8(z['data.edn']!));
		expect(get(edn, 'version')).toBe(2);
		expect((get(edn, 'decks') as Edn[]).length).toBe(1);
		expect(get(edn, 'decks', 0, 'name')).toBe('Bio');
		expect(get(edn, 'decks', 0, 'cards', 0, 'content')).toBe('## Cell\n---\nThe basic unit of life');
		expect(t.shown).toEqual(['Exported 1 card to Mochi exports/Bio.mochi.']);
		expect(t.previews[0]!.lines).toEqual([
			{ label: 'Cards', items: ['1'] },
			{ label: 'Deck', items: ['Bio (1 card)'] },
			{ label: 'Images', items: ['0'] },
			{ label: 'File', items: ['Mochi exports/Bio.mochi'] },
		]);
	});

	it('case 3: the preview warns about a card with no end marker', async () => {
		const t = await setup({ 'Bio.md': 'Mitosis #card\nCell division' });
		await t.plugin.exportNote(t.file('Bio.md'));
		expect(t.previews[0]!.lines.find((l) => l.label === 'Warnings')!.items).toEqual(['card 1 has no end marker']);
	});

	it('case 4: an EDN parse of the archive gives back quotes, backslashes, Unicode and newlines', async () => {
		const back = 'He said "hi" \\ and ünïcode\nline two';
		const t = await setup({ 'Talk.md': `Quote #card\n${back}\n---` });
		const z = await t.zip((await t.plugin.exportNote(t.file('Talk.md')))!);
		expect(get(readEdn(strFromU8(z['data.edn']!)), 'decks', 0, 'cards', 0, 'content')).toBe(`Quote\n---\n${back}`);
		for (const s of ['', '\t\r\u0001', '"\\"', 'ünïcode 漢字 🙂']) expect(readEdn(ednString(s))).toBe(s);
	});

	it('case 5 and 10: adds attachments/cell.png at the root and rewrites the link', async () => {
		const t = await setup({ 'Bio.md': 'Cell #card\nSee ![[cell.png]]\n---' }, ['attachments/cell.png']);
		const z = await t.zip((await t.plugin.exportNote(t.file('Bio.md')))!);
		expect(Object.keys(z).sort()).toEqual(['cell.png', 'data.edn']);
		expect([...z['cell.png']!]).toEqual([...PNG]);
		expect(get(readEdn(strFromU8(z['data.edn']!)), 'decks', 0, 'cards', 0, 'content')).toBe('Cell\n---\nSee ![](@media/cell.png)');
	});

	it('case 6: two images named x.png become x.png and x-1.png', async () => {
		const t = await setup({ 'Bio.md': 'One #card\n![[a/x.png]]\n---\nTwo #card\n![[b/x.png]]\n---' }, ['a/x.png', 'b/x.png']);
		const z = await t.zip((await t.plugin.exportNote(t.file('Bio.md')))!);
		expect(Object.keys(z).sort()).toEqual(['data.edn', 'x-1.png', 'x.png']);
		const cards = get(readEdn(strFromU8(z['data.edn']!)), 'decks', 0, 'cards') as Edn[];
		expect(cards.map((c) => get(c, 'content'))).toEqual(['One\n---\n![](@media/x.png)', 'Two\n---\n![](@media/x-1.png)']);
	});

	it('case 7: a missing image does not stop the export; preview and notice list it', async () => {
		const t = await setup({ 'Bio.md': 'Gone #card\n![[missing.png]]\n---' });
		const path = await t.plugin.exportNote(t.file('Bio.md'));
		expect(path).toBe('Mochi exports/Bio.mochi');
		expect(t.previews[0]!.lines.find((l) => l.label === 'Missing attachments')!.items).toEqual(['missing.png']);
		expect(t.shown).toEqual(['Exported 1 card to Mochi exports/Bio.mochi. Missing: missing.png.']);
		const z = await t.zip(path!);
		expect(get(readEdn(strFromU8(z['data.edn']!)), 'decks', 0, 'cards', 0, 'content')).toBe('Gone\n---\n![[missing.png]]');
	});

	it('case 8: a note with no card line shows No cards found and writes nothing', async () => {
		const t = await setup({ 'Plain.md': '# Plain\ntext' });
		expect(await t.plugin.exportNote(t.file('Plain.md'))).toBeNull();
		expect(t.shown).toEqual(['No cards found']);
		expect(t.previews).toEqual([]);
		expect(t.app.vault.getAbstractFileByPath('Mochi exports')).toBeNull();
	});

	it('case 9: an existing Bio.mochi stays as it is and the new file is Bio 1.mochi', async () => {
		const t = await setup({ 'Bio.md': 'Q #card\nA\n---' });
		await t.app.vault.createFolder('Mochi exports');
		await t.app.vault.createBinary('Mochi exports/Bio.mochi', buf(new Uint8Array([1, 2, 3])));
		expect(await t.plugin.exportNote(t.file('Bio.md'))).toBe('Mochi exports/Bio 1.mochi');
		expect([...new Uint8Array(await t.app.vault.readBinary(t.file('Mochi exports/Bio.mochi')))]).toEqual([1, 2, 3]);
	});

	it('an existing bio.mochi with other letter case is not used as the target', async () => {
		const t = await setup({ 'Bio.md': 'Q #card\nA\n---' });
		await t.app.vault.createFolder('Mochi exports');
		await t.app.vault.createBinary('Mochi exports/bio.mochi', buf(new Uint8Array([1, 2, 3])));
		expect(await t.plugin.exportNote(t.file('Bio.md'))).toBe('Mochi exports/Bio 1.mochi');
		expect([...new Uint8Array(await t.app.vault.readBinary(t.file('Mochi exports/bio.mochi')))]).toEqual([1, 2, 3]);
	});

	it('a file made while the preview is open is not overwritten', async () => {
		const t = await setup({ 'Bio.md': 'Q #card\nA\n---' });
		t.plugin.confirm = async (_plan, target) => {
			await t.app.vault.createFolder('Mochi exports');
			await t.app.vault.createBinary(target, buf(new Uint8Array([1, 2, 3])));
			return true;
		};
		expect(await t.plugin.exportNote(t.file('Bio.md'))).toBe('Mochi exports/Bio 1.mochi');
		expect([...new Uint8Array(await t.app.vault.readBinary(t.file('Mochi exports/Bio.mochi')))]).toEqual([1, 2, 3]);
	});

	it('an empty line above the end marker gives the same card', () => {
		expect(parseCards('Q #card\nA\n\n---').cards).toEqual(parseCards('Q #card\nA\n---').cards);
	});

	it('a deck name that starts with a dot does not give a hidden file', () => {
		expect(archivePath('Mochi exports', '.Bio', () => false)).toBe('Mochi exports/Bio.mochi');
		expect(archivePath('', '..', () => false)).toBe('Mochi export.mochi');
	});

	it('Cancel in the preview writes nothing', async () => {
		const t = await setup({ 'Bio.md': 'Q #card\nA\n---' });
		t.plugin.confirm = () => Promise.resolve(false);
		expect(await t.plugin.exportNote(t.file('Bio.md'))).toBeNull();
		expect(t.app.vault.getAbstractFileByPath('Mochi exports/Bio.mochi')).toBeNull();
	});

	it('uses the card tag and output folder from the settings', async () => {
		const t = await setup({ 'Bio.md': 'Old #card\nno\n---\nNew #bio\nyes\n---' });
		t.plugin.settings = normalizeSettings({ tag: 'bio', folder: 'Out/Cards' });
		const z = await t.zip((await t.plugin.exportNote(t.file('Bio.md')))!);
		expect(t.app.vault.getAbstractFileByPath('Out/Cards/Bio.mochi')).not.toBeNull();
		const cards = get(readEdn(strFromU8(z['data.edn']!)), 'decks', 0, 'cards') as Edn[];
		expect(cards.map((c) => get(c, 'content'))).toEqual(['New\n---\nyes']);
	});

	it('a failed write shows a notice and does not reject', async () => {
		const t = await setup({ 'Bio.md': 'Q #card\nA\n---' });
		vi.spyOn(t.app.vault, 'createBinary').mockRejectedValue(new Error('disk full'));
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await expect(t.plugin.exportNote(t.file('Bio.md'))).resolves.toBeNull();
		expect(t.shown).toEqual(['Export failed: disk full']);
		err.mockRestore();
	});
});

describe('archive', () => {
	it('gives the same bytes for the same input', () => {
		const a = buildArchive('{:version 2}', [{ name: 'x.png', data: PNG }]);
		const b = buildArchive('{:version 2}', [{ name: 'x.png', data: PNG }]);
		expect([...a]).toEqual([...b]);
		expect(Object.keys(unzipSync(a))).toEqual(['data.edn', 'x.png']);
	});
});

const folderFiles = {
	'Bio/Cell.md': 'A #card\n1\n---',
	'Bio/Empty.md': 'nothing',
	'Bio/Deep/Plant.md': 'B #card\n![[leaf.png]]\n---',
	'Other/Skip.md': 'C #card\n3\n---',
};

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

describe('Pro features', () => {
	it('folder export without Pro shows the Pro notice and writes nothing', async () => {
		const t = await setup(folderFiles);
		const folder = t.app.vault.getFolderByPath('Bio') as unknown as TFolder;
		expect(await t.plugin.exportFolder(folder, 'one-deck-per-note')).toBeNull();
		expect(await t.plugin.exportFolder(folder, 'sub-decks')).toBeNull();
		expect(await t.plugin.exportWithPreset(t.file('Bio/Cell.md'), { name: 'P', tag: '', folder: '', deck: '' })).toBeNull();
		expect(t.shown).toEqual([
			'Folder export is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.',
			'Folder export with sub-decks is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.',
			'Presets is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.',
		]);
		expect(t.app.vault.getAbstractFileByPath('Mochi exports')).toBeNull();
	});

	it('lists the notes of a folder and its subfolders in path order', async () => {
		const t = await setup(folderFiles);
		expect(notesIn(t.app.vault.getFolderByPath('Bio') as unknown as TFolder).map((f) => f.path)).toEqual(['Bio/Cell.md', 'Bio/Deep/Plant.md', 'Bio/Empty.md']);
	});

	it('folder export gives one deck for each note with cards', async () => {
		const t = await setup(folderFiles, ['img/leaf.png']);
		bindPro(fakeManager(true) as never);
		const path = await t.plugin.exportFolder(t.app.vault.getFolderByPath('Bio') as unknown as TFolder, 'one-deck-per-note');
		expect(path).toBe('Mochi exports/Bio.mochi');
		const z = await t.zip(path!);
		expect(Object.keys(z).sort()).toEqual(['data.edn', 'leaf.png']);
		const decks = get(readEdn(strFromU8(z['data.edn']!)), 'decks') as Edn[];
		expect(decks.map((d) => [get(d, 'name'), (get(d, 'parent-id') as Edn) ?? null])).toEqual([
			['Cell', null],
			['Plant', null],
		]);
	});

	it('folder export with sub-decks gives one parent deck and a sub-deck for each note', async () => {
		const t = await setup(folderFiles, ['img/leaf.png']);
		bindPro(fakeManager(true) as never);
		const z = await t.zip((await t.plugin.exportFolder(t.app.vault.getFolderByPath('Bio') as unknown as TFolder, 'sub-decks'))!);
		expect(t.previews[0]!.lines.find((l) => l.label === 'Parent deck')!.items).toEqual(['Bio']);
		const decks = get(readEdn(strFromU8(z['data.edn']!)), 'decks') as Edn[];
		expect(decks.map((d) => [get(d, 'id'), get(d, 'name'), (get(d, 'parent-id') as Edn) ?? null, (get(d, 'cards') as Edn[]).length])).toEqual([
			['deck-1', 'Bio', null, 0],
			['deck-2', 'Cell', 'deck-1', 1],
			['deck-3', 'Plant', 'deck-1', 1],
		]);
	});

	it('a preset sets the tag, the output folder and the deck name', async () => {
		const t = await setup({ 'Bio.md': 'Old #card\nno\n---\nNew #bio\nyes\n---' });
		bindPro(fakeManager(true) as never);
		const path = await t.plugin.exportWithPreset(t.file('Bio.md'), { name: 'Biology', tag: 'bio', folder: 'Decks/Bio', deck: 'Biology 101' });
		expect(path).toBe('Decks/Bio/Biology 101.mochi');
		const edn = readEdn(strFromU8((await t.zip(path!))['data.edn']!));
		expect(get(edn, 'decks', 0, 'name')).toBe('Biology 101');
		expect((get(edn, 'decks', 0, 'cards') as Edn[]).length).toBe(1);
	});

	it('the facade follows the GitHub Sponsors manager', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		resetPro();
		expect(isPro()).toBe(false);
	});

	it('uses the same GitHub Sponsors values as the reference product', () => {
		expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});
