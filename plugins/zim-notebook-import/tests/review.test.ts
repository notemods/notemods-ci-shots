import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { planZimImport } from '../src/core/index';
import ZimNotebookImportPlugin from '../src/main';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });
const plan = (text: string) => planZimImport([{ path: 'Source/Page.txt', text }], 'Source', 'Output');
function fixture(files: Record<string, string> = { 'Source/Page.txt': 'body' }) {
	const app = App.createConfigured__({ files });
	return { app, plugin: new ZimNotebookImportPlugin(app as never, manifest as never) };
}

describe('review regression cases', () => {
	it.each(['\u00a0', '\u202f'])('checks output collisions after normalizing space %j', (space) => {
		const result = planZimImport([
			{ path: `Source/Two${space}words.txt`, text: 'one' },
			{ path: 'Source/Two_words.txt', text: 'two' },
		], 'Source', 'Output');
		expect(result.conflicts.join('\n')).toContain('Output collision');
	});
	it('maps links to the normalized output name', () => {
		const result = planZimImport([
			{ path: 'Source/Page.txt', text: '[[:Two\u00a0words]]' },
			{ path: 'Source/Two\u00a0words.txt', text: 'two' },
		], 'Source', 'Output');
		expect(result.notes[0]!.body).toBe('[[Output/Two words]]');
		expect(result.notes[1]!.path).toBe('Output/Two words.md');
	});
	it('blocks a source folder that occupies the report path before a write', async () => {
		const { app, plugin } = fixture({ 'Source/Zim_import_report.md/Child.txt': 'child' });
		const prepared = await plugin.prepare('Source', 'Output');
		expect(prepared.plan.conflicts.join('\n')).toContain('Reserved output name');
		await expect(plugin.writeImport(prepared)).rejects.toThrow('Reserved output name');
		expect(app.vault.getAbstractFileByPath('Output')).toBeNull();
	});
	it.each([true, false])('keeps a 150000-line code block without a stack error, closed=%s', (closed) => {
		const code = 'line\n'.repeat(150000);
		const result = plan("'''\n" + code + (closed ? "'''" : ''));
		expect(result.notes[0]!.body).toBe(closed ? '```\n' + code + '```' : "'''\n" + code);
	});
	it('keeps a large inline code span with many backticks', () => {
		const code = '`x'.repeat(150000);
		expect(plan("''" + code + "''").notes[0]!.body).toBe('`` ' + code + ' ``');
	});
	it('reports the actual source line of an unknown header', () => {
		expect(plan('Content-Type: text/x-zim-wiki\nWiki-Format: zim 0.4\nCustom: value\n\nbody').issues[0]!.line).toBe(3);
	});
	it('keeps inline-code markers in a link label without internal placeholders', () => {
		const result = planZimImport([
			{ path: 'Source/Page.txt', text: "[[Target|''label'']] and ''[[Target]]''" },
			{ path: 'Source/Target.txt', text: 'target' },
		], 'Source', 'Output');
		expect(result.notes[0]!.body).toBe("[[Output/Target|''label'']] and ` [[Target]] `");
	});
	it('does not start an interval after unload before layout ready', async () => {
		const { app, plugin } = fixture();
		let ready = () => {};
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((callback) => { ready = callback; });
		await plugin.onload();
		const refresh = vi.spyOn(plugin.pro!, 'refresh');
		const interval = vi.spyOn(plugin, 'registerInterval').mockImplementation((id) => { window.clearInterval(id); return id; });
		plugin.onunload(); ready();
		expect(refresh).not.toHaveBeenCalled();
		expect(interval).not.toHaveBeenCalled();
	});
	it('does not reopen the modal when a preview finishes after unload', async () => {
		const { plugin } = fixture();
		let finish!: (value: { added: string[]; changed: string[]; removed: string[]; unchanged: number }) => void;
		vi.spyOn(plugin, 'laterPreview').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
		const open = vi.spyOn(plugin, 'openImport');
		const pending = plugin.openLaterPreview(); plugin.onunload();
		finish({ added: [], changed: [], removed: [], unchanged: 0 }); await pending;
		expect(open).not.toHaveBeenCalled();
	});
	it('does not register controls when settings finish loading after unload', async () => {
		const { plugin } = fixture(); let finish!: () => void;
		vi.spyOn(plugin, 'loadSettings').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
		const add = vi.spyOn(plugin, 'addCommand');
		const pending = plugin.onload(); plugin.onunload(); finish(); await pending;
		// Only the What's new and Send feedback commands of packages/hello, which register before the settings load.
		expect(add.mock.calls.map(([command]) => command.id)).toEqual(['show-whats-new', 'send-feedback']);
	});
	it('closes an open import modal on unload', () => {
		const { plugin } = fixture(); const modal = plugin.openImport();
		const close = vi.spyOn(modal, 'close');
		plugin.onunload();
		expect(close).toHaveBeenCalledOnce();
	});
});

describe('folder case conflicts', () => {
	it('blocks case variants of planned folders before a write', async () => {
		const { app, plugin } = fixture({ 'Source/Area/One.txt': 'one', 'Source/area/Two.txt': 'two' });
		const prepared = await plugin.prepare('Source', 'Output');
		expect(prepared.plan.conflicts.join('\n')).toContain('Folder case collision');
		await expect(plugin.writeImport(prepared)).rejects.toThrow('Folder case collision');
		expect(app.vault.getAbstractFileByPath('Output')).toBeNull();
	});
	it('blocks a destination ancestor with different case', async () => {
		const { app, plugin } = fixture(); await app.vault.createFolder('Parent');
		const prepared = await plugin.prepare('Source', 'parent/Output');
		expect(prepared.plan.conflicts.join('\n')).toContain('Use the existing folder case: Parent');
		await expect(plugin.writeImport(prepared)).rejects.toThrow('existing folder case');
		expect(app.vault.getAbstractFileByPath('parent')).toBeNull();
	});
});

describe('Zim page-name spelling in links', () => {
	it.each(['Two_words', ' :Two_words ', ':Two words'])('maps the Zim link target %j', (target) => {
		const result = planZimImport([
			{ path: 'Source/Page.txt', text: `[[${target}|label]]` },
			{ path: 'Source/Two_words.txt', text: 'two' },
		], 'Source', 'Output');
		expect(result.notes[0]!.body).toBe('[[Output/Two words|label]]');
		expect(result.issues).toEqual([]);
	});
});

describe('Zim checkboxes that are not list items', () => {
	it.each(['Task [<] inline', '  [<] Task', '[<]'])('reports the left arrow checkbox in %j', (text) => {
		const result = plan(text);
		expect(result.notes[0]!.body).toBe(text);
		expect(result.issues.map((i) => i.detail)).toEqual([text]);
	});
	it('keeps an empty checkbox item as an empty task', () => {
		expect(plan('[ ] \n[*]\t').notes[0]!.body).toBe('- [ ]\n- [x]');
	});
});

describe('audit a30 regression cases', () => {
	it.each(['zim 0.5', 'zim 0.6'])('converts a page with the header that Zim writes, %s', (version) => {
		const result = plan(`Content-Type: text/x-zim-wiki\nWiki-Format: ${version}\nCreation-Date: 2021-01-02T03:04:05+01:00\n\n====== Title ======\nSome //italic// text`);
		expect(result.notes[0]!.body).toBe('# Title\nSome *italic* text');
		expect(result.notes[0]!.properties.zim_created).toBe('2021-01-02T03:04:05+01:00');
		expect(result.issues).toEqual([]);
	});
	it('plans a large notebook in a large vault without a quadratic slowdown', () => {
		const n = 2000;
		const sources = Array.from({ length: n }, (_, i) => ({ path: `Source/NS${i % 20}/Page_${i}.txt`, text: Array.from({ length: 10 }, (_, k) => `[[:NS${(i + k) % 20}:Page_${(i + k) % n}]] [[Page_${i}]]`).join('\n') }));
		const existing = Array.from({ length: 20000 }, (_, i) => `Other/Note ${i}.md`);
		const started = Date.now();
		const result = planZimImport(sources, 'Source', 'Output', existing);
		expect(Date.now() - started).toBeLessThan(20000);
		expect(result.conflicts).toEqual([]);
		expect(result.notes.find((note) => note.source === 'Source/NS1/Page_1.txt')!.body.split('\n')[0]).toBe('[[Output/NS1/Page 1]] [[Output/NS1/Page 1]]');
	}, 60000);
});
