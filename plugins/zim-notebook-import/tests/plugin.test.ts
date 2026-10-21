import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { compareZimSources, planZimImport, resolveZimLink } from '../src/core/index';
import ZimNotebookImportPlugin from '../src/main';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';
afterEach(() => resetPro());
function fixture() {
	const app = App.createConfigured__({ files: { 'Source/Page.txt': 'Content-Type: text/x-zim-wiki\nWiki-Format: zim 0.4\nCreation-Date: 2020-05-02\n\n====== Title ======\n[[+Child]]', 'Source/Page/Child.txt': 'child' } });
	return { app, plugin: new ZimNotebookImportPlugin(app as never, manifest as never) };
}
describe('vault writes', () => {
	it('writes notes with properties and report while source stays unchanged', async () => {
		const { app, plugin } = fixture();
		const prepared = await plugin.prepare('Source', 'Output');
		const result = await plugin.writeImport(prepared);
		expect(result.created).toBe(2);
		const note = app.vault.getAbstractFileByPath('Output/Page.md');
		expect(await app.vault.read(note as never)).toContain('zim_created:');
		expect(await app.vault.read(note as never)).toContain('[[Output/Page/Child]]');
		expect(await app.vault.read(app.vault.getAbstractFileByPath('Source/Page.txt') as never)).toContain('====== Title ======');
		expect(app.vault.getAbstractFileByPath(result.report)).toBeTruthy();
	});
	it('writes checkbox lines as tasks without a report entry', async () => {
		const { app, plugin } = fixture(); await app.vault.create('Source/Tasks.txt', '[ ] Open\n\t[*] Done\n[x] Dismissed');
		const result = await plugin.writeImport(await plugin.prepare('Source', 'Output'));
		expect(await app.vault.read(app.vault.getAbstractFileByPath('Output/Tasks.md') as never)).toContain('- [ ] Open\n\t- [x] Done\n- [c] Dismissed');
		expect(await app.vault.read(app.vault.getAbstractFileByPath(result.report) as never)).not.toContain('Tasks.txt');
	});
	it('blocks existing output before the first write', async () => {
		const { app, plugin } = fixture();
		await app.vault.createFolder('Output');
		await app.vault.create('Output/Page.md', 'keep');
		await expect(plugin.writeImport(await plugin.prepare('Source', 'Output'))).rejects.toThrow('Destination exists');
		expect(await app.vault.read(app.vault.getAbstractFileByPath('Output/Page.md') as never)).toBe('keep');
		expect(app.vault.getAbstractFileByPath('Output/Page/Child.md')).toBeNull();
	});
	it('rejects a source change after review', async () => {
		const { app, plugin } = fixture(); const p = await plugin.prepare('Source', 'Output');
		await app.vault.modify(app.vault.getAbstractFileByPath('Source/Page.txt') as never, 'changed');
		await expect(plugin.writeImport(p)).rejects.toThrow('source changed');
		expect(app.vault.getAbstractFileByPath('Output')).toBeNull();
	});
	it('rejects collisions without creating the destination', async () => {
		const { app, plugin } = fixture(); await app.vault.create('Source/page.txt', 'second');
		await expect(plugin.writeImport(await plugin.prepare('Source', 'Output'))).rejects.toThrow('collision');
		expect(app.vault.getAbstractFileByPath('Output')).toBeNull();
	});
	it('rejects a reserved report name', async () => {
		const { app, plugin } = fixture(); await app.vault.create('Source/Zim_import_report.txt', 'report page');
		expect((await plugin.prepare('Source', 'Output')).plan.conflicts).toContain('Reserved output name: Zim import report.md');
	});
	it('rejects parent path input and overlapping folders', async () => {
		const { plugin } = fixture(); await expect(plugin.prepare('Source', '../Output')).rejects.toThrow('valid vault');
		expect(planZimImport([{ path:'Source/Page.txt', text:'x' }], 'Source', 'Source/Output').conflicts.length).toBeGreaterThan(0);
	});
	it('reports partial writes without deleting output', async () => {
		const { app, plugin } = fixture(); const prepared = await plugin.prepare('Source', 'Output');
		const original = app.vault.create.bind(app.vault); let calls = 0;
		vi.spyOn(app.vault, 'create').mockImplementation(async (...args) => { if (++calls === 2) throw new Error('disk failure'); return original(...args); });
		await expect(plugin.writeImport(prepared)).rejects.toThrow('after 1 notes');
		expect(app.vault.getAbstractFileByPath(prepared.plan.notes[0]!.path)).toBeTruthy();
	});
});
describe('Pro guards and later preview', () => {
	it('keeps saving rules and later preview off when signed out', async () => {
		const { plugin } = fixture(); expect(isPro()).toBe(false);
		expect(await plugin.saveRules('Source', 'Output', { folders:'tree', names:'spaces' })).toBe(false);
		expect(plugin.settings.saved).toBeNull(); expect(await plugin.laterPreview()).toBeNull();
	});
	it('saves rules and compares source after a sponsored state', async () => {
		bindPro({ isPro: () => true, onChange: () => () => {} } as never);
		const { app, plugin } = fixture();
		expect(await plugin.saveRules('Source', 'Output', { folders:'flat', names:'hyphens' })).toBe(true);
		await plugin.writeImport(await plugin.prepare('Source', 'Output'));
		await app.vault.modify(app.vault.getAbstractFileByPath('Source/Page.txt') as never, 'changed');
		expect(await plugin.laterPreview()).toEqual({ added:[], changed:['Source/Page.txt'], removed:[], unchanged:1 });
	});
	it('compares added changed removed and unchanged source text', () => {
		expect(compareZimSources([{path:'a.txt',text:'a'},{path:'b.txt',text:'b'},{path:'c.txt',text:'c'}], [{path:'a.txt',text:'new'},{path:'c.txt',text:'c'},{path:'d.txt',text:'d'}])).toEqual({added:['d.txt'],changed:['a.txt'],removed:['b.txt'],unchanged:1});
	});
	it('uses the supplied sponsor terms', () => expect(SPONSORS).toMatchObject({clientId:'Ov23lic5UPGPZqhBlBGg',minMonthlyUsd:5,oneTimeUsd:15,oneTimeMonths:0,scope:'read:user'}));
	it('repairs corrupt saved data', () => {
		expect(normalizeSettings(null)).toEqual({saved:null,snapshot:null});
		expect(normalizeSettings({saved:{source:5},snapshot:{pages:[null]}})).toEqual({saved:null,snapshot:null});
	});
	it('does not fall through when a closer namespace exists but its child is missing', () => {
		expect(resolveZimLink('Area/Page', 'Topic:Child', ['Area/Topic', 'Topic/Child'])).toBeNull();
	});
});

describe('source preservation and path conflicts', () => {
	it('keeps the body of an unsupported object block verbatim', () => {
		const text = '{{{equation:\n//not italic//\n[[Missing]]\n}}}';
		const result = planZimImport([{ path:'Source/Page.txt', text }], 'Source', 'Output');
		expect(result.notes[0]!.body).toBe(text);
		expect(result.issues).toEqual([{source:'Source/Page.txt',line:1,kind:'syntax',detail:'Unsupported object block retained verbatim'}]);
	});
	it('preserves an unknown header instead of dropping its content', () => {
		const text = 'Content-Type: text/x-zim-wiki\nWiki-Format: zim 0.4\nCustom: keep this\n\n====== Title ======';
		const result = planZimImport([{path:'Source/Page.txt',text}], 'Source', 'Output');
		expect(result.notes[0]!.body).toBe('Custom: keep this\n\n# Title');
		expect(result.issues[0]!.kind).toBe('header');
	});
	it('blocks a converted file that is also a planned parent folder', () => {
		const result = planZimImport([{path:'Source/Page.txt',text:'page'},{path:'Source/Page.md/Child.txt',text:'child'}], 'Source', 'Output');
		expect(result.conflicts.join('\n')).toContain('File and folder collision');
	});
	it('detects Unicode normalization collisions', () => {
		const result = planZimImport([{path:'Source/Café.txt',text:'one'},{path:'Source/Cafe\u0301.txt',text:'two'}], 'Source', 'Output');
		expect(result.conflicts.join('\n')).toContain('Output collision');
	});
	it('rejects a destination with a file in its ancestor path before a write', async () => {
		const { app, plugin } = fixture(); await app.vault.create('Block', 'keep');
		const prepared = await plugin.prepare('Source', 'Block/Output');
		expect(prepared.plan.conflicts).toContain('A file blocks the destination folder: Block');
		await expect(plugin.writeImport(prepared)).rejects.toThrow('blocks the destination');
		expect(await app.vault.read(app.vault.getAbstractFileByPath('Block') as never)).toBe('keep');
	});
});
