import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesFreezePanesPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/scope';
import manifest from '../manifest.json';

function makePlugin() {
	const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
	return new BasesFreezePanesPlugin(app as never, manifest as never);
}

describe('BasesFreezePanesPlugin', () => {
	it('note tables are off by default and respect the file and main switches when on', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		const root = createDiv('markdown-rendered');
		const table = root.createEl('table');
		const file = plugin.app.vault.getAbstractFileByPath('notes/a.md');
		const leaf = { view: { containerEl: root, file } };
		vi.spyOn(plugin.app.workspace, 'iterateAllLeaves').mockImplementation((callback) => callback(leaf as never));
		plugin.refresh();
		expect(table.parentElement).toBe(root);
		plugin.settings.freezeNoteTables = true;
		plugin.refresh();
		expect(table.parentElement?.classList.contains('bfp-note-table')).toBe(true);
		plugin.settings.files = { 'notes/a.md': { off: true } };
		plugin.refresh();
		expect(table.parentElement).toBe(root);
		plugin.settings.files = {};
		plugin.settings.columns = 0;
		plugin.refresh();
		expect(table.parentElement?.classList.contains('bfp-note-column')).toBe(false);
		plugin.settings.enabled = false;
		plugin.refresh();
		expect(table.parentElement).toBe(root);
		plugin.settings.enabled = true;
		plugin.settings.columns = 3;
		plugin.columnsSupported = false;
		plugin.refresh();
		expect(table.parentElement?.classList.contains('bfp-note-column')).toBe(true);
		plugin.settings.freezeNoteTables = false;
		plugin.refresh();
		expect(table.parentElement).toBe(root);
	});

	it('note tables change only note tabs, not canvas tabs or views without a file', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# A', 'boards/b.canvas': '{}' } });
		const plugin = new BasesFreezePanesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		plugin.settings.freezeNoteTables = true;
		const roots = [createDiv('markdown-rendered'), createDiv('markdown-rendered'), createDiv('markdown-rendered')];
		const tables = roots.map((root) => root.createEl('table'));
		const leaves = [
			{ view: { containerEl: roots[0], file: app.vault.getAbstractFileByPath('notes/a.md') } },
			{ view: { containerEl: roots[1], file: app.vault.getAbstractFileByPath('boards/b.canvas') } },
			{ view: { containerEl: roots[2] } },
		];
		vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((callback) => leaves.forEach((leaf) => callback(leaf as never)));
		plugin.refresh();
		expect(tables.map((table) => table.parentElement?.classList.contains('bfp-note-table'))).toEqual([true, false, false]);
		plugin.onunload();
		expect(tables[0]!.parentElement).toBe(roots[0]);
	});

	it('loads default settings from an empty data.json', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('uses the default column count for a table outside any tab', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		expect(plugin.columnsFor(document.createElement('div'))).toBe(1);
	});

	it('reads the column count that refresh wrote on the tab element', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		const tab = document.createElement('div');
		tab.setAttribute('data-bfp-columns', '3');
		const view = tab.appendChild(document.createElement('div'));
		expect(plugin.columnsFor(view)).toBe(3);
	});

	it('without Pro caps the default at 1 column and never pins the last column', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		plugin.settings = { ...plugin.settings, columns: 3, freezeLast: true };
		expect(plugin.isPro()).toBe(false);
		expect(plugin.columnsFor(document.createElement('div'))).toBe(1);
		expect(plugin.pinLastFor(document.createElement('div'))).toBe(false);
	});

	it('does not keep the elements of closed tabs after a refresh', async () => {
		const plugin = makePlugin();
		await plugin.loadSettings();
		const open = createDiv();
		const closed = createDiv();
		let leaves = [{ view: { containerEl: open } }, { view: { containerEl: closed } }];
		vi.spyOn(plugin.app.workspace, 'iterateAllLeaves').mockImplementation((callback) => leaves.forEach((leaf) => callback(leaf as never)));
		plugin.refresh();
		expect(closed.getAttribute('data-bfp-columns')).toBe('1');
		leaves = [{ view: { containerEl: open } }];
		plugin.refresh();
		expect((plugin as unknown as { marked: Set<HTMLElement> }).marked).toEqual(new Set([open]));
		expect(closed.hasAttribute('data-bfp-columns')).toBe(false);
		expect(open.getAttribute('data-bfp-columns')).toBe('1');
	});
});

describe('property pin rights and scope', () => {
	it('keeps the choice but does not pin a property without Pro', async () => {
		const p = makePlugin();
		await p.loadSettings();
		p.settings.pinProperty = 'score';
		expect(p.pinPropertyFor(createDiv())).toBeNull();
		expect(p.settings.pinProperty).toBe('score');
	});
	it('honors the main switch and the file switch, also with 0 leading columns and no header', async () => {
		const p = makePlugin();
		await p.loadSettings();
		vi.spyOn(p, 'isPro').mockReturnValue(true);
		p.settings.pinProperty = 'score';
		p.settings.columns = 0;
		p.settings.freezeHeader = false;
		const root = createDiv();
		const file = p.app.vault.getAbstractFileByPath('notes/a.md');
		vi.spyOn(p.app.workspace, 'iterateAllLeaves').mockImplementation((fn) => fn({ view: { containerEl: root, file } } as never));
		p.refresh();
		expect(p.pinPropertyFor(root)).toBe('note.score');
		p.settings.files = { 'notes/a.md': { off: true } };
		p.refresh();
		expect(p.pinPropertyFor(root)).toBeNull();
		p.settings.files = {};
		p.settings.enabled = false;
		p.refresh();
		expect(p.pinPropertyFor(root)).toBeNull();
		p.onunload();
		expect(root.hasAttribute('data-bfp-property')).toBe(false);
	});
});
