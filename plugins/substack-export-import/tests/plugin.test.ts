import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import * as obsidian from 'obsidian';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import Plugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { DEFAULT_MAPPING, MAX_ZIP_BYTES, compareBodies, makeReport, makeSnapshot, parseSnapshot, prepareImport, readArchive, validateFolder } from '../src/importer';
import { convertBody } from '../src/convert';
import { bindPro, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());
function plugin(files: Record<string, string> = {}) { return new Plugin(App.createConfigured__({ files }) as never, manifest as never); }
function preview(body = 'First body') { return prepareImport({ 'posts.csv': 'post_id,title,post_date,is_published\n123,One,2024-01-02T10:00:00Z,false\n', 'posts/123.html': `<p>${body}</p>` }, convertBody); }
function pro() { bindPro({ isPro: () => true, onChange: () => () => undefined } as never); }

describe('local ZIP archive', () => {
	it('reads the example fixture and reports the orphan', () => {
		const bytes = new Uint8Array(readFileSync('tests/fixtures/substack-example.zip'));
		const p = plugin().prepare(bytes);
		expect(p.posts).toHaveLength(1); expect(p.unmatched).toEqual(['posts/456.second-post.html']);
	});
	it('keeps the podcast URL from the fixture', () => {
		const p = plugin().prepare(new Uint8Array(readFileSync('tests/fixtures/substack-podcast.zip')));
		expect(p.posts[0]?.properties).toMatchObject({ type: 'podcast', podcast_url: 'https://audio.example.test/episode.mp3' });
	});
	it('does not decompress subscriber files or copy their content to the report', () => {
		const bytes = zipSync({ 'posts.csv': strToU8('post_id,title\n'), 'subscribers.csv': strToU8('PRIVATE_SUBSCRIBER'), 'delivery/stats.csv': strToU8('PRIVATE_STATS') });
		const members = readArchive(bytes); expect(Object.keys(members)).toEqual(['posts.csv']);
		expect(makeReport(prepareImport(members, convertBody))).not.toContain('PRIVATE');
	});
	it('rejects unsafe ZIP paths before import', () => expect(() => readArchive(zipSync({ '../escape': strToU8('bad') }))).toThrow('Unsafe ZIP member'));
	it('rejects a damaged archive', () => expect(() => readArchive(new Uint8Array([1, 2, 3]))).toThrow());
	it('rejects an oversized archive before parsing', () => expect(() => readArchive(new Uint8Array(MAX_ZIP_BYTES + 1))).toThrow('30 MiB'));
	it('keeps remote image URLs without a plugin request', () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		const body = convertBody('<p>Text</p><img src="https://images.example.test/p.jpg" alt="Field">');
		expect(body).toContain('https://images.example.test/p.jpg'); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
	});
	it('does not pass remote image sources to the DOM converter', () => {
		const convert = vi.fn((fragment: DocumentFragment) => {
			const images = (fragment as DocumentFragment).querySelectorAll('img');
			for (const image of Array.from(images)) expect(image.getAttribute('src')).toMatch(/^data:,substack-import-image-/);
			return obsidian.htmlToMarkdown(fragment);
		});
		try {
			const body = convertBody('<img src="https://images.example.test/p.jpg"><img src="https://images.example.test/q.jpg">', convert);
			expect(body).toContain('https://images.example.test/p.jpg'); expect(body).toContain('https://images.example.test/q.jpg');
			expect(body).not.toContain('substack-import-image-'); expect(convert).toHaveBeenCalledOnce();
		} finally { convert.mockClear(); }
	});
	it('removes executable elements and dangerous URL schemes', () => {
		const body = convertBody('<script>alert(1)</script><iframe src="https://example.test"></iframe><a href="javascript:alert(1)">Safe text</a>');
		expect(body).toContain('Safe text'); expect(body).not.toMatch(/alert|iframe|javascript/);
	});
});

describe('new folder writes', () => {
	it('writes body, properties, dates, report and snapshot', async () => {
		const p = plugin(); await p.writeImport(preview(), 'Writer export');
		const file = p.app.vault.getFileByPath('Writer export/123.md'); expect(file).not.toBeNull();
		const text = await p.app.vault.read(file!); expect(text).toContain('published: false'); expect(text).toContain('First body');
		expect(file?.stat.ctime).toBe(1704189600000); expect(file?.stat.mtime).toBe(1704189600000);
		expect(p.app.vault.getFileByPath('Writer export/Import report.md')).not.toBeNull();
		expect(p.app.vault.getFileByPath('Writer export/_substack-snapshot.json')).not.toBeNull();
	});
	it('keeps existing files unchanged', async () => {
		const p = plugin({ 'Writer export/keep.md': 'Original' }); const create = vi.spyOn(p.app.vault, 'create');
		await expect(p.writeImport(preview(), 'Writer export')).rejects.toThrow('folder exists');
		expect(create).not.toHaveBeenCalled(); expect(await p.app.vault.read(p.app.vault.getFileByPath('Writer export/keep.md')!)).toBe('Original');
	});
	it('rejects unsafe output folders before writes', async () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'createFolder');
		for (const folder of ['../escape', '/absolute', '.obsidian/import', 'new/../escape', 'CON', 'new/', 'trailing.']) await expect(p.writeImport(preview(), folder)).rejects.toThrow('safe new folder');
		expect(create).not.toHaveBeenCalled();
	});
	it('requires an existing parent folder', () => expect(() => plugin().checkFolder('missing/new')).toThrow('parent folder'));
	it('permits a new child of an existing folder', async () => { const p = plugin({ 'Archive/keep.md': 'Original' }); await expect(p.writeImport(preview(), 'Archive/October')).resolves.toBe('Archive/October'); });
	it('does not create a body note for missing HTML', async () => {
		const p = plugin(); await p.writeImport(prepareImport({ 'posts.csv': 'post_id,title\n456,Missing\n' }, convertBody), 'Missing');
		expect(p.app.vault.getFileByPath('Missing/456.md')).toBeNull();
		const report = await p.app.vault.read(p.app.vault.getFileByPath('Missing/Import report.md')!); expect(report).toContain('posts/456.html');
	});
	it('releases the write guard after an error', async () => {
		const p = plugin(); const create = vi.spyOn(p.app.vault, 'createFolder').mockRejectedValueOnce(new Error('disk full'));
		await expect(p.writeImport(preview(), 'Failed')).rejects.toThrow('disk full');
		await expect(p.writeImport(preview(), 'Retry')).resolves.toBe('Retry'); expect(create).toHaveBeenCalledTimes(2);
	});
	it('rejects a second import while the first write is pending', async () => {
		const p = plugin(); const original = p.app.vault.createFolder.bind(p.app.vault); let release!: () => void;
		const held = new Promise<void>((r) => { release = r; }); vi.spyOn(p.app.vault, 'createFolder').mockImplementation(async (path) => { await held; return original(path); });
		const first = p.writeImport(preview(), 'First'); await expect(p.writeImport(preview(), 'Second')).rejects.toThrow('in progress'); release(); await first;
	});
});

describe('Pro features and settings', () => {
	it('loads and repairs local settings', async () => { const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS); expect(normalizeSettings({ profiles: [null, { name: 'bad', folder: '../x', mapping: DEFAULT_MAPPING }] })).toEqual(DEFAULT_SETTINGS); });
	it('uses the reference GitHub Sponsors price and client', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
	it('guards saved profile writes and reads without Pro', async () => {
		const p = plugin(); const save = vi.spyOn(p, 'saveData'); await expect(p.saveProfile({ name: 'Writer', folder: 'Archive', mapping: DEFAULT_MAPPING })).rejects.toThrow('need Pro'); expect(save).not.toHaveBeenCalled(); expect(() => p.loadProfile('Writer')).toThrow('need Pro');
	});
	it('saves and reloads a Pro profile', async () => {
		pro(); const p = plugin(); await p.saveProfile({ name: 'Writer', folder: 'Archive', mapping: { ...DEFAULT_MAPPING, title: 'headline' } });
		await p.loadSettings(); expect(p.loadProfile('Writer').mapping.title).toBe('headline');
	});
	it('guards comparison before it reads a snapshot', async () => {
		const p = plugin(); const read = vi.spyOn(p.app.vault, 'read'); await expect(p.compareImport('Old', preview())).rejects.toThrow('needs Pro'); expect(read).not.toHaveBeenCalled();
	});
	it('compares a local import by ID and shows changed bodies', async () => {
		pro(); const p = plugin(); await p.writeImport(preview(), 'Old');
		expect(await p.compareImport('Old', preview('Changed body'))).toEqual([{ id: '123', status: 'changed', before: 'First body', after: 'Changed body' }]);
	});
	it('reports added, removed and unchanged IDs', () => {
		const old = { version: 1 as const, bodies: { gone: 'Removed', '123': 'First body' } };
		const next = preview(); next.posts.push({ id: 'new', source: 'posts/new.html', body: 'Added', properties: {} });
		expect(compareBodies(old, next).map((c) => [c.id, c.status])).toEqual([['123', 'same'], ['gone', 'removed'], ['new', 'added']]);
	});
	it('validates saved snapshots', () => {
		expect(parseSnapshot(JSON.stringify(makeSnapshot(preview())))).toEqual({ version: 1, bodies: { '123': 'First body' } });
		for (const text of ['null', '{"version":2,"bodies":{}}', '{"version":1,"bodies":{"../bad":"x"}}', '{"version":1,"bodies":{"123":7}}']) expect(() => parseSnapshot(text)).toThrow();
	});
	it('rejects hidden and traversal profile folders', () => { expect(() => validateFolder('.obsidian')).toThrow(); expect(() => validateFolder('a/../b')).toThrow(); });
});
