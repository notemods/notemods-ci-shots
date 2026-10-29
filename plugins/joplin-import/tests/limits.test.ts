// Release self-audit regressions (s1028): long names, large archives and unload during a write.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import JoplinImportPlugin from '../src/main';
import manifest from '../manifest.json';
import { auditArchives } from '../src/audit';
import { MAX_NAME_BYTES, planImport, safeName } from '../src/convert';
import { STOPPED, applyResync, prepareImport, resyncPreview, writeImport } from '../src/importer';
import type { Archive, Note } from '../src/joplin';
import { resetPro } from '../src/pro';

const id = (n: number) => n.toString(16).padStart(32, '0');
const enc = new TextEncoder();
const note = (n: number, title: string, body = 'Text'): Note => ({ id: id(n), parentId: '', title, body, markup: 'markdown', created: null, updated: null, todo: false, todoDone: false });
const archive = (notes: Note[]): Archive => ({ notes, folders: [], tags: [], noteTags: new Map(), resources: new Map(), unsupported: [] });
const fileName = (path: string) => path.split('/').pop()!;

afterEach(() => { vi.restoreAllMocks(); resetPro(); });

describe('long names', () => {
	it('a 100-character CJK title gives a note file name below 255 UTF-8 bytes', () => {
		const a = archive([note(1, '漢'.repeat(100))]);
		a.folders = [{ id: id(9), parentId: '', title: '漢'.repeat(100) }];
		a.notes[0]!.parentId = id(9);
		const plan = planImport(a, 'Out', () => false);
		const path = plan.notes[0]!.path;
		expect(enc.encode(fileName(path)).length).toBeLessThanOrEqual(255);
		expect(enc.encode(path.split('/')[1]!).length).toBeLessThanOrEqual(MAX_NAME_BYTES);
		expect(fileName(path)).toBe(`${'漢'.repeat(66)}--${id(1)}.md`);
	});

	it('the cut does not split an emoji into a lone surrogate', () => {
		const name = safeName(`${'a'.repeat(79)}😀b`);
		expect(name).toBe('a'.repeat(79) + '😀');
		expect(/[\uD800-\uDFFF]/.test(name.replace(/😀/g, ''))).toBe(false);
		expect(safeName('😀'.repeat(60))).toBe('😀'.repeat(50));
	});

	it('an ASCII title keeps the first 80 characters as before', () => {
		expect(safeName('x'.repeat(120))).toBe('x'.repeat(80));
	});
});

describe('large archives', () => {
	it('plans 20000 notes with 60000 missing links in less than 5 seconds', () => {
		const notes = Array.from({ length: 20_000 }, (_, i) => note(i + 1, `Note ${i}`, `[a](:/${id(900_000 + i)}) [b](:/${id(950_000 + i)}) [c](:/${id(990_000 + i)})`));
		const started = performance.now();
		const plan = planImport(archive(notes), 'Out', () => false);
		expect(performance.now() - started).toBeLessThan(5000);
		expect(plan.report.missingResources).toHaveLength(60_000);
	});

	it('audits two archives that share 40000 notes in less than 3 seconds', () => {
		const notes = Array.from({ length: 40_000 }, (_, i) => note(i + 1, `N${i}`, `[x](:/${id(((i + 1) % 40_000) + 1)})`));
		const started = performance.now();
		const r = auditArchives([{ name: 'a.jex', archive: archive(notes) }, { name: 'b.jex', archive: archive(notes) }]);
		expect(performance.now() - started).toBeLessThan(3000);
		expect(r.sharedNotes).toHaveLength(40_000);
	});
});

describe('unload during a write', () => {
	it('writes no file and no report after the plugin unloads during an import', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new JoplinImportPlugin(app as never, manifest as never);
		await plugin.onload();
		const plan = plugin.prepare(archive(Array.from({ length: 50 }, (_, i) => note(i + 1, `T${i}`))), 'Out');
		const create = app.vault.create.bind(app.vault);
		let calls = 0;
		let afterUnload = 0;
		let unloaded = false;
		vi.spyOn(app.vault, 'create').mockImplementation(async (path, text, options) => {
			calls++;
			if (unloaded) afterUnload++;
			const file = await create(path, text, options);
			if (calls === 5) { plugin.onunload(); unloaded = true; }
			return file;
		});
		const r = await plugin.importPlan(plan, 'source.jex');
		expect(afterUnload).toBe(0);
		expect(r.created).toBe(5);
		expect(r.report).toBeNull();
		expect(r.errors).toEqual([STOPPED]);
	});

	it('updates no note after the plugin unloads during a resync', async () => {
		const app = App.createConfigured__({ files: {} });
		const first = archive([note(1, 'A', 'One'), note(2, 'B', 'One')]);
		await writeImport(app.vault, prepareImport(app.vault, first, 'Out'), 'source.jex', { report: false });
		const later = archive([note(1, 'A', 'Two'), note(2, 'B', 'Two')]);
		const preview = await resyncPreview(app.vault, prepareImport(app.vault, later, 'Out'));
		expect(preview.changed).toHaveLength(2);
		let stop = false;
		const process = app.vault.process.bind(app.vault);
		vi.spyOn(app.vault, 'process').mockImplementation(async (f, fn, options) => {
			const out = await process(f, fn, options);
			stop = true;
			return out;
		});
		const r = await applyResync(app.vault, preview, () => stop);
		expect(r.updated).toBe(1);
		expect(r.skipped).toEqual([preview.changed[1]!.path]);
		expect(await app.vault.read(app.vault.getFileByPath(preview.changed[1]!.path)!)).toBe(preview.changed[1]!.previousText);
	});
});
