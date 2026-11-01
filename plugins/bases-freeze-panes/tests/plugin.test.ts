import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesFreezePanesPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/scope';
import { choiceRows, describeViewChoice } from '../src/settings';
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

describe('view choices in the app DOM', () => {
	/** A tab for a file with one Bases view element that shows the named view. */
	async function setup(path: string, viewName: string | null) {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# A', 'Books.base': 'views: []' } });
		const plugin = new BasesFreezePanesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const pro = vi.spyOn(plugin, 'isPro').mockReturnValue(true);
		const root = createDiv('workspace-leaf-content');
		const viewEl = root.createDiv('bases-view');
		if (viewName !== null) viewEl.setAttribute('data-view-name', viewName);
		const head = viewEl.createDiv('bases-thead');
		const file = app.vault.getAbstractFileByPath(path);
		const leaf = { view: { containerEl: root, file } };
		vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((callback) => callback(leaf as never));
		return { app, plugin, pro, root, viewEl, head, file, leaf };
	}

	it('AC1, AC2 and AC4: each view of a base gets its own columns; Pro is needed for the count', async () => {
		const { plugin, pro, viewEl, head } = await setup('Books.base', 'Wide');
		plugin.settings.files = { 'Books.base': { views: { Wide: { columns: 3 }, Narrow: { off: true } } } };
		plugin.refresh();
		expect(plugin.columnsFor(viewEl)).toBe(3);
		expect(plugin.columnsFor(head)).toBe(3);
		viewEl.setAttribute('data-view-name', 'Narrow');
		expect(plugin.columnsFor(viewEl)).toBe(0);
		expect(plugin.pinLastFor(viewEl)).toBe(false);
		viewEl.setAttribute('data-view-name', 'Other');
		expect(plugin.columnsFor(viewEl)).toBe(1);
		pro.mockReturnValue(false);
		viewEl.setAttribute('data-view-name', 'Wide');
		expect(plugin.columnsFor(viewEl)).toBe(1);
	});

	it('AC6: without a view name the file choice applies', async () => {
		const { plugin, viewEl } = await setup('Books.base', null);
		plugin.settings.files = { 'Books.base': { columns: 2, views: { Wide: { columns: 3 } } } };
		plugin.refresh();
		expect(plugin.columnsFor(viewEl)).toBe(2);
		viewEl.setAttribute('data-view-name', '');
		expect(plugin.columnsFor(viewEl)).toBe(2);
	});

	it('AC3: the header choice of a view is a class on the view element, and a view switch updates it', async () => {
		const { plugin, root, viewEl } = await setup('notes/a.md', 'Embed');
		plugin.settings.files = { 'notes/a.md': { views: { Embed: { header: false } } } };
		plugin.refresh();
		expect(root.hasClass('bfp-header')).toBe(true);
		expect(viewEl.hasClass('bfp-no-header')).toBe(true);
		expect(viewEl.hasClass('bfp-view-header')).toBe(false);
		const scrolled = vi.fn();
		viewEl.addEventListener('scroll', scrolled);
		viewEl.setAttribute('data-view-name', 'Wide');
		await new Promise((r) => setTimeout(r, 0));
		expect(viewEl.hasClass('bfp-no-header')).toBe(false);
		expect(scrolled).toHaveBeenCalled();
		// The core writes the same name again on each update: no redraw for that.
		scrolled.mockClear();
		viewEl.setAttribute('data-view-name', 'Wide');
		await new Promise((r) => setTimeout(r, 0));
		expect(scrolled).not.toHaveBeenCalled();
		plugin.settings.freezeHeader = false;
		plugin.settings.files = { 'notes/a.md': { views: { Wide: { header: true } } } };
		plugin.refresh();
		expect(root.hasClass('bfp-header')).toBe(false);
		expect(viewEl.hasClass('bfp-view-header')).toBe(true);
		plugin.onunload();
		expect(viewEl.hasClass('bfp-view-header')).toBe(false);
		expect(root.hasAttribute('data-bfp-path')).toBe(false);
	});

	it('redraws only the views whose choice changed', async () => {
		const { plugin, viewEl } = await setup('Books.base', 'Wide');
		plugin.refresh();
		const scrolled = vi.fn();
		viewEl.addEventListener('scroll', scrolled);
		plugin.refresh();
		expect(scrolled).not.toHaveBeenCalled();
		plugin.settings.files = { 'Books.base': { views: { Wide: { columns: 2 } } } };
		plugin.refresh();
		expect(scrolled).toHaveBeenCalled();
	});

	it('a view that is off pins no property', async () => {
		const { plugin, viewEl } = await setup('Books.base', 'Narrow');
		plugin.settings.pinProperty = 'score';
		plugin.refresh();
		expect(plugin.pinPropertyFor(viewEl)).toBe('note.score');
		plugin.settings.files = { 'Books.base': { views: { Narrow: { off: true } } } };
		plugin.refresh();
		expect(plugin.pinPropertyFor(viewEl)).toBeNull();
	});

	it('AC12: view choices do not change rendered Markdown or Dataview tables', async () => {
		const { plugin, root } = await setup('notes/a.md', 'Embed');
		const table = root.createDiv('markdown-rendered').createEl('table');
		plugin.settings.freezeNoteTables = true;
		plugin.settings.files = { 'notes/a.md': { views: { Embed: { off: true, header: false } } } };
		plugin.refresh();
		expect(table.parentElement?.classList.contains('bfp-note-table')).toBe(true);
		expect(table.parentElement?.classList.contains('bfp-note-header')).toBe(true);
		plugin.onunload();
	});

	it('the view command needs a base tab or a note with one named view', async () => {
		const { app, plugin, root, viewEl, file, leaf } = await setup('notes/a.md', 'Embed');
		vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(file as never);
		const recent = vi.spyOn(app.workspace, 'getMostRecentLeaf').mockReturnValue(leaf as never);
		expect(plugin.currentViewTarget()).toEqual({ file, view: 'Embed' });
		// The same view twice (live preview and reading view) is still one view.
		root.createDiv('bases-view').setAttribute('data-view-name', 'Embed');
		expect(plugin.currentViewTarget()?.view).toBe('Embed');
		root.createDiv('bases-view').setAttribute('data-view-name', 'Other');
		expect(plugin.currentViewTarget()).toBeNull();
		root.empty();
		expect(plugin.currentViewTarget()).toBeNull();
		root.appendChild(viewEl);
		recent.mockReturnValue(null);
		expect(plugin.currentViewTarget()).toBeNull();
	});

	it('saves a view choice and refuses the 51st view of a file', async () => {
		const { plugin } = await setup('Books.base', 'Wide');
		const save = vi.spyOn(plugin, 'saveData').mockResolvedValue();
		expect(await plugin.setViewChoice('Books.base', 'Wide', { columns: 3 })).toBe(true);
		expect(plugin.settings.files['Books.base']).toEqual({ views: { Wide: { columns: 3 } } });
		expect(save).toHaveBeenCalled();
		for (let i = 1; i < 50; i++) await plugin.setViewChoice('Books.base', `V${i}`, { off: true });
		expect(await plugin.setViewChoice('Books.base', 'One more', { off: true })).toBe(false);
		expect(Object.keys(plugin.settings.files['Books.base']?.views ?? {})).toHaveLength(50);
		await plugin.forgetViewChoice('Books.base', 'Wide');
		expect(plugin.settings.files['Books.base']?.views?.Wide).toBeUndefined();
	});

	it('deleting the file row keeps the view choices, and the file command keeps them too', async () => {
		const { plugin } = await setup('Books.base', 'Wide');
		vi.spyOn(plugin, 'saveData').mockResolvedValue();
		plugin.settings.files = { 'Books.base': { off: true, columns: 2, views: { Wide: { header: false } } } };
		await plugin.forgetFileChoice('Books.base');
		expect(plugin.settings.files).toEqual({ 'Books.base': { views: { Wide: { header: false } } } });
	});
});

describe('the list of single-file choices', () => {
	it('lists each view as "file > view" after its file, and keeps a view that the base no longer has', () => {
		const rows = choiceRows(
			{ ...DEFAULT_SETTINGS, files: { 'b.base': { views: { Old: { header: false } } }, 'a.base': { off: true, views: { Wide: { columns: 3 }, Narrow: { off: true } } } } },
			false,
		);
		expect(rows.map((r) => r.name)).toEqual(['a.base', 'a.base > Narrow', 'a.base > Wide', 'b.base > Old']);
		expect(rows.map((r) => r.view)).toEqual([null, 'Narrow', 'Wide', 'Old']);
		expect(rows[1]?.desc).toBe('Frozen panes off for this view.');
		expect(rows[2]?.desc).toBe('3 frozen columns. Needs pro; the file choice applies until pro is on.');
		expect(rows[3]?.desc).toBe('Header row not frozen.');
		expect(describeViewChoice({ header: true, columns: 1 }, true)).toBe('Header row frozen. 1 frozen column.');
	});
});
