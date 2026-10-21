import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian-test-mocks/obsidian';
import Zkn3ArchiveImportPlugin from '../src/main';
import { readArchive } from '../src/archive';
import { BATCH, prepareImport, writeImport } from '../src/importer';
import { DEFAULT_RULES, type Rules } from '../src/model';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, resetPro, SPONSORS } from '../src/pro';
// @ts-expect-error plain JS fixture builder
import { archive as build, demo } from './fixtures/zkn3.mjs';
import manifest from '../manifest.json';

const file = (name: string) => readArchive(new Uint8Array(readFileSync(`tests/fixtures/${name}`)));
function setup(files: Record<string, string> = {}) {
	const app = App.createConfigured__({ files });
	const plugin = new Zkn3ArchiveImportPlugin(app as never, manifest as never);
	return { app, plugin };
}
function pro(value: boolean) { bindPro({ isPro: () => value, onChange: () => () => undefined } as never); }
const read = async (app: ReturnType<typeof setup>['app'], path: string) => app.vault.read(app.vault.getAbstractFileByPath(path) as TFile);
const TITLE_RULES: Rules = { fileName: 'number-title', keywordProperty: 'zkn_keywords', keywordTags: true };
afterEach(() => resetPro());

describe('vault import', () => {
	it('loads and repairs saved settings', async () => {
		const { plugin } = setup();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ folder: '../x', rules: { fileName: 'x', keywordProperty: 'tags' } })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it('previews without writes, then creates 75 source-numbered notes in the selected folder', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare(file('sample-75.zkn3'), 'Cards');
		expect(app.vault.getFiles()).toHaveLength(0);
		expect(plan.notes.filter((n) => n.status === 'new')).toHaveLength(75);
		const r = await plugin.importPlan(plan);
		expect(r).toEqual({ created: 75, skipped: 0, errors: [], cancelled: false, remaining: 0 });
		const paths = app.vault.getMarkdownFiles().map((f) => f.path);
		expect(paths).toHaveLength(75);
		for (let i = 1; i <= 75; i++) expect(paths).toContain(`Cards/${i}.md`);
	});
	it('creates 1.md and 3.md for a deleted slot, with links to note 3', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare(file('deleted-slot.zkn3'), 'Z');
		await plugin.importPlan(plan);
		expect(app.vault.getMarkdownFiles().map((f) => f.path).sort()).toEqual(['Z/1.md', 'Z/3.md']);
		const one = await read(app, 'Z/1.md');
		expect(one).toContain('Read [[3|Other]] first.');
		expect(one).toContain('## Cross-references\n\n- [[3|Other]]');
		expect(one).toContain('## Note sequence\n\n1. [[3|Other]]');
		expect(one).toContain('keywords:\n  - two words\n  - two-words');
		expect(await read(app, 'Z/3.md')).toContain('[z 2]Gone[/z]');
		expect(plan.missing).toEqual(['Note 3: missing target 2.']);
	});
	it('converts h1 and q markup and reports other markup', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare(file('tricky.zkn3'), 'T');
		await plugin.importPlan(plan);
		const text = await read(app, 'T/1.md');
		expect(text).toContain('# Main idea\nSome *Markdown* and a [list](https://example.com) link.');
		expect(text).toContain('> A short quote.\n> Second line.');
		expect(plan.unsupported).toEqual(['Note 1: [u]']);
	});
	it('imports all heading levels, bold and italic aliases, remarks and source time stamps', async () => {
		const { app, plugin } = setup();
		const archive = readArchive(build([{
			content: '[h1]One[/h1][h2]Two[/h2][h3]Three[/h3][h4]Four[/h4][h5]Five[/h5][h6]Six[/h6][b]Bold[/b] and [i]italic[/i].',
			misc: '[f]Remark[/f] with [k]emphasis[/k].', created: '2601020304', edited: '2601020405',
		}]));
		await plugin.importPlan(await plugin.prepare(archive, 'Markup'));
		const text = await read(app, 'Markup/1.md');
		for (const heading of ['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six']) expect(text.split('\n')).toContain(heading);
		expect(text).toContain('**Bold** and *italic*.');
		expect(text).toContain('## Remarks\n\n**Remark** with *emphasis*.');
		expect(text).toContain('zkn3_created: "2601020304"');
		expect(text).toContain('zkn3_edited: "2601020405"');
	});
	it('a second run skips existing notes and keeps local edits', async () => {
		const { app, plugin } = setup();
		await plugin.importPlan(await plugin.prepare(file('deleted-slot.zkn3'), 'Z'));
		const f = app.vault.getAbstractFileByPath('Z/1.md') as TFile;
		await app.vault.modify(f, `${await app.vault.read(f)}\nMy edit.`);
		const next = await plugin.prepare(file('deleted-slot.zkn3'), 'Z');
		expect(next.notes.map((n) => n.status)).toEqual(['existing', 'existing']);
		expect(await plugin.importPlan(next)).toMatchObject({ created: 0, skipped: 2 });
		expect(await app.vault.read(f)).toContain('My edit.');
	});
	it('a renamed earlier note with the same position is not created again', async () => {
		const { app, plugin } = setup({ 'Z/My card.md': '---\nzkn3_position: 1\n---\nText' });
		const plan = await plugin.prepare(file('deleted-slot.zkn3'), 'Z');
		expect(plan.notes.map((n) => n.status)).toEqual(['existing', 'new']);
		expect((await plugin.importPlan(plan)).created).toBe(1);
		expect(app.vault.getAbstractFileByPath('Z/1.md')).toBeNull();
	});
	it('an unrelated file at a note path is a conflict and stays unchanged', async () => {
		const { app, plugin } = setup({ 'Z/3.md': 'Keep me' });
		const plan = await plugin.prepare(file('deleted-slot.zkn3'), 'Z');
		expect(plan.notes.map((n) => n.status)).toEqual(['new', 'conflict']);
		expect(await plugin.importPlan(plan)).toMatchObject({ created: 1, skipped: 1 });
		expect(await read(app, 'Z/3.md')).toBe('Keep me');
	});
	it('a file that blocks the folder stops all writes', async () => {
		const { app, plugin } = setup({ Z: 'Keep me' });
		const plan = await plugin.prepare(file('deleted-slot.zkn3'), 'Z');
		expect(plan.notes.every((n) => n.status === 'conflict')).toBe(true);
		const r = await writeImport(app.vault as never, plan);
		expect(r.created).toBe(0);
		expect(app.vault.getFiles()).toHaveLength(1);
	});
	it('rejects unsafe folders before writes', async () => {
		const { app, plugin } = setup();
		for (const folder of ['../x', '/x', '.hidden', 'a/../b', '']) await expect(plugin.prepare(file('deleted-slot.zkn3'), folder)).rejects.toThrow('relative vault folder');
		expect(app.vault.getFiles()).toHaveLength(0);
	});
	it('stops between write batches on cancel and reports the partial write', async () => {
		const { app } = setup();
		const notes = Array.from({ length: BATCH * 3 }, (_, i) => ({ title: `N${i}`, content: 'x' }));
		const plan = await prepareImport(app.vault as never, readArchive(build(notes)), 'Big', DEFAULT_RULES);
		const token = { cancelled: false };
		const r = await writeImport(app.vault as never, plan, token, (done) => { if (done >= BATCH) token.cancelled = true; });
		expect(r).toEqual({ created: BATCH, skipped: 0, errors: [], cancelled: true, remaining: BATCH * 2 });
		expect(app.vault.getMarkdownFiles()).toHaveLength(BATCH);
	});
	it('reports write errors with counts, and a later run creates the rest', async () => {
		const { app, plugin } = setup();
		const plan = await plugin.prepare(file('deleted-slot.zkn3'), 'Z');
		const spy = vi.spyOn(app.vault, 'create').mockRejectedValueOnce(new Error('Disk full'));
		const r = await plugin.importPlan(plan);
		expect(r.errors).toEqual(['Note 1: Disk full']);
		expect(r.created).toBe(1);
		spy.mockRestore();
		expect((await plugin.importPlan(await plugin.prepare(file('deleted-slot.zkn3'), 'Z'))).created).toBe(1);
	});
});

describe('Pro access', () => {
	it('rejects a prepared Pro plan after sign out, then permits a free import', async () => {
		pro(true);
		const { app, plugin } = setup();
		const archive = file('deleted-slot.zkn3');
		const plan = await plugin.prepare(archive, 'Z', TITLE_RULES);
		pro(false);
		await expect(plugin.importPlan(plan)).rejects.toThrow('need Pro');
		expect(app.vault.getFiles()).toHaveLength(0);
		expect((await plugin.importPlan(await plugin.prepare(archive, 'Z'))).created).toBe(2);
		expect(app.vault.getAbstractFileByPath('Z/1.md')).not.toBeNull();
	});
	it('clears a Pro preview and comparison when Pro turns off', async () => {
		pro(true);
		const { plugin } = setup();
		plugin.settings.rules = TITLE_RULES;
		plugin.settings.folder = 'Z';
		const modal = plugin.openImport(readArchive(demo(true)));
		await modal.refreshPreview();
		modal.showComparison(readArchive(demo(false)));
		expect(modal.contentEl.textContent).toContain('1 added');
		pro(false);
		modal.updatePro();
		expect(modal.contentEl.querySelector('.zkn3-preview')?.textContent).toBe('');
		expect(modal.contentEl.textContent).toContain('Select Preview');
		const create = Array.from(modal.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Create notes');
		expect(create?.disabled).toBe(true);
		await modal.refreshPreview();
		expect(modal.contentEl.textContent).toContain('Z/1.md');
		expect(modal.contentEl.querySelector('select')?.value).toBe('number');
		plugin.closeImportWindows();
	});
	it('free imports cannot use other rules or the comparison', async () => {
		const { plugin } = setup();
		await expect(plugin.prepare(file('deleted-slot.zkn3'), 'Z', TITLE_RULES)).rejects.toThrow('need Pro');
		expect(await plugin.saveRules(TITLE_RULES)).toBe(false);
		expect(() => plugin.compare(readArchive(demo(false)), readArchive(demo(true)))).toThrow('needs Pro');
	});
	it('Pro saves rules and uses them for names, keyword property and tags', async () => {
		pro(true);
		const { app, plugin } = setup();
		expect(await plugin.saveRules(TITLE_RULES)).toBe(true);
		expect(plugin.activeRules()).toEqual(TITLE_RULES);
		await plugin.importPlan(await plugin.prepare(file('deleted-slot.zkn3'), 'Z'));
		const text = await read(app, 'Z/1 Start.md');
		expect(text).toContain('Read [[3 Other|Other]] first.');
		expect(text).toContain('zkn_keywords:\n  - two words\n  - two-words');
		expect(text).toContain('tags:\n  - two-words');
		pro(false);
		expect(plugin.activeRules()).toEqual(DEFAULT_RULES);
		expect(await plugin.saveRules(DEFAULT_RULES)).toBe(false);
	});
	it('Pro compares an earlier archive with a later archive without writes', () => {
		pro(true);
		const { app, plugin } = setup();
		expect(plugin.compare(readArchive(demo(false)), readArchive(demo(true)))).toEqual({ added: [8], changed: [1], removed: [], unchanged: [2, 3, 4, 5, 6] });
		expect(app.vault.getFiles()).toHaveLength(0);
	});
	it('the import window shows counts, the report and the Pro comparison', async () => {
		const { plugin } = setup();
		const later = readArchive(demo(true));
		const m = plugin.openImport(later);
		await m.refreshPreview();
		const text = () => m.contentEl.textContent ?? '';
		expect(text()).toContain('7 live notes · 1 deleted slot · 7 new · 0 existing · 0 file conflicts');
		expect(text()).toContain('Note 5: missing target 7.');
		expect(text()).toContain('Note 6: [color]');
		expect(() => m.showComparison(readArchive(demo(false)))).toThrow('needs Pro');
		pro(true);
		m.showComparison(readArchive(demo(false)));
		expect(text()).toContain('1 added · 1 changed · 0 removed · 5 unchanged');
		plugin.closeImportWindows();
	});
	it('Sponsors config matches the reference', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
});
