import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TableRowLinksPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { dataRows, rowAnchor } from '../src/rows';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

const MARKED = '| Fruit | Count |\n|---|---|\n| Apples %%row:abc123%% | 3 |\n| Pears %%row:def456%% | 2 |';

function editor(text: string) {
	let value = text;
	return { getValue: () => value, setValue: vi.fn((s: string) => { value = s; }) };
}

function proOn(): void {
	bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
}

describe('short dividers', () => {
	it('finds data rows under a divider with one dash in each cell', () => {
		expect(dataRows(['| A | B |', '|-|-|', '| x | y |'])).toEqual([2]);
		expect(dataRows(['| A | B |', '| :- | -: |', '| x | y |'])).toEqual([2]);
		expect(rowAnchor(['| A |', '|:-:|', '| x |'], 2, 'V', 'n.md', 'aaaaaa').available).toBe(true);
	});

	it('keeps a body row of dashes as data and keeps the row numbers', () => {
		const lines = ['| A | B |', '|---|---|', '| x | 1 |', '| - | - |', '| | 3 |'];
		expect(dataRows(lines)).toEqual([2, 3, 4]);
		expect(rowAnchor(lines, 4, 'V', 'n.md', 'aaaaaa').label).toBe('Row 3');
	});
});

describe('cleanup references', () => {
	it('keeps an anchor that a wikilink with an escaped alias pipe in a table cell references', async () => {
		const app = App.createConfigured__({ files: { 'Fruit.md': MARKED, 'Review.md': '| Item |\n|---|\n| [[Fruit#^abc123\\|Apples]] |' } });
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		proOn();
		const fruit = app.vault.getAbstractFileByPath('Fruit.md');
		const e = editor(MARKED);
		await p.removeUnused(e as never, fruit as never);
		expect(e.getValue()).toContain('%%row:abc123%%');
		expect(e.getValue()).not.toContain('%%row:def456%%');
	});

	it('keeps an anchor that a Markdown internal link references', async () => {
		const app = App.createConfigured__({ files: { 'Fruit.md': MARKED, 'Review.md': 'See [Apples](Fruit.md#^abc123) and [Pears](<Fruit.md#^def456>).' } });
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		proOn();
		const fruit = app.vault.getAbstractFileByPath('Fruit.md');
		const e = editor(MARKED);
		await p.removeUnused(e as never, fruit as never);
		expect(e.setValue).not.toHaveBeenCalled();
	});

	it('uses the file of the editor, not the active file of the workspace', async () => {
		const app = App.createConfigured__({ files: { 'Fruit.md': MARKED, 'Board.md': 'x', 'Review.md': '[[Fruit#^abc123]]' } });
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		proOn();
		vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(app.vault.getAbstractFileByPath('Board.md') as never);
		const e = editor(MARKED);
		await p.removeUnused(e as never, app.vault.getAbstractFileByPath('Fruit.md') as never);
		expect(e.getValue()).toContain('%%row:abc123%%');
		expect(e.getValue()).not.toContain('%%row:def456%%');
	});
});

describe('indented code', () => {
	it('skips a table that is indented as code', () => {
		expect(dataRows(['Text', '', '    | A |', '    |---|', '    | x |', '', '\t| A |', '\t|---|', '\t| y |'])).toEqual([]);
	});
});
