import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { freeDocxPath, planExport, writeExport } from '../src/export';

/** A small vault: path to text or bytes. Records each write. */
function fakeApp(files: Record<string, string | Uint8Array>) {
	const store = new Map(Object.entries(files));
	const writes: string[] = [];
	const fileOf = (path: string) => {
		const name = path.split('/').pop()!;
		const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/';
		return { path, name, basename: name.replace(/\.[^.]+$/, ''), extension: name.split('.').pop(), parent: { path: dir } };
	};
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (store.has(p) ? fileOf(p) : null),
			readBinary: async (f: { path: string }) => {
				const v = store.get(f.path);
				return (v instanceof Uint8Array ? v : new TextEncoder().encode(v ?? '')).slice().buffer;
			},
			createBinary: async (p: string, data: ArrayBuffer) => {
				if (store.has(p)) throw new Error('File already exists.');
				store.set(p, new Uint8Array(data));
				writes.push(p);
				return fileOf(p);
			},
		},
		metadataCache: {
			getFirstLinkpathDest: (link: string, _src: string) => {
				const hit = [...store.keys()].find((k) => k === link || k.endsWith(`/${link}`));
				return hit ? fileOf(hit) : null;
			},
		},
	};
	return { app: app as never, store, writes, fileOf };
}

const opts = { author: 'Lee', pro: false, labels: false };

describe('file names', () => {
	it('case 9: Draft.docx exists, so the export writes Draft (2).docx and changes nothing else', async () => {
		const note = 'We need evidence %% add a source %%.';
		const old = new Uint8Array([1, 2, 3]);
		const v = fakeApp({ 'Notes/Draft.md': note, 'Notes/Draft.docx': old });
		const plan = await planExport(v.app, [{ file: v.fileOf('Notes/Draft.md') as never, text: note }], opts);
		expect(plan.path).toBe('Notes/Draft (2).docx');
		const file = await writeExport(v.app, plan);
		expect(file.path).toBe('Notes/Draft (2).docx');
		expect(v.writes).toEqual(['Notes/Draft (2).docx']);
		expect(v.store.get('Notes/Draft.docx')).toBe(old);
		expect(v.store.get('Notes/Draft.md')).toBe(note);
		const zip = unzipSync(v.store.get('Notes/Draft (2).docx') as Uint8Array);
		expect(strFromU8(zip['word/comments.xml']!)).toContain('add a source');
	});

	it('counts up past (2) and works in the vault root', () => {
		const v = fakeApp({ 'Draft.docx': '', 'Draft (2).docx': '' });
		expect(freeDocxPath(v.app, '/', 'Draft')).toBe('Draft (3).docx');
		expect(freeDocxPath(v.app, '', 'New')).toBe('New.docx');
	});

	it('picks a new name when a file appears while the preview is open', async () => {
		const v = fakeApp({ 'Draft.md': 'A %% b %%.' });
		const plan = await planExport(v.app, [{ file: v.fileOf('Draft.md') as never, text: 'A %% b %%.' }], opts);
		v.store.set('Draft.docx', new Uint8Array([9]));
		const file = await writeExport(v.app, plan);
		expect(file.path).toBe('Draft (2).docx');
		expect(v.store.get('Draft.docx')).toEqual(new Uint8Array([9]));
	});
});

describe('stops on problems', () => {
	for (const [name, text] of [
		['case 5: no previous word', '%% first %% Word.'],
		['case 6: comment crosses a paragraph', 'Word %% first\n\nsecond %%.'],
		['case 7: empty comment', 'Word %% %%.'],
		['case 8: fenced code block', 'A %% b %%.\n\n```\nx\n```'],
	] as const) {
		it(`${name}: no output file, note unchanged`, async () => {
			const v = fakeApp({ 'Draft.md': text });
			const plan = await planExport(v.app, [{ file: v.fileOf('Draft.md') as never, text }], opts);
			expect(plan.problems.length).toBeGreaterThan(0);
			expect(plan.problems[0]).toMatch(/^Draft\.md line \d+: /);
			await expect(writeExport(v.app, plan)).rejects.toThrow('problems');
			expect(v.writes).toEqual([]);
			expect(v.store.get('Draft.md')).toBe(text);
		});
	}
});

describe('Pro plans', () => {
	it('joins notes with continuing comment ids and names the file after the folder', async () => {
		const v = fakeApp({ 'Book/One.md': 'A %% x %%.', 'Book/Two.md': 'B %% y %%.' });
		const plan = await planExport(
			v.app,
			[
				{ file: v.fileOf('Book/One.md') as never, text: 'A %% x %%.' },
				{ file: v.fileOf('Book/Two.md') as never, text: 'B %% y %%.' },
			],
			{ ...opts, pro: true },
			'Book',
		);
		expect(plan.comments.map((c) => [c.id, c.anchor])).toEqual([
			[0, 'A'],
			[1, 'B'],
		]);
		expect(plan.notes).toHaveLength(2);
		expect(plan.path).toBe('Book/Book.docx');
	});

	it('loads a local image and reports a missing one', async () => {
		const png = new Uint8Array(33);
		png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
		new DataView(png.buffer).setUint32(16, 40);
		new DataView(png.buffer).setUint32(20, 20);
		const text = '![[pic.png]]\n\n![[gone.png]]';
		const v = fakeApp({ 'N.md': text, 'img/pic.png': png });
		const plan = await planExport(v.app, [{ file: v.fileOf('N.md') as never, text }], { ...opts, pro: true });
		expect(plan.images.get('pic.png')).toMatchObject({ type: 'png', width: 40, height: 20 });
		expect(plan.problems).toEqual(['N.md: image gone.png is not in the vault']);
	});
});
