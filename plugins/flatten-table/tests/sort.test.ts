import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flatten, nextSort, readSort, toCsv, toMarkdown, type SortRule } from '../src/flatten';
import { FlattenView, type ViewOptions } from '../src/view';
import { resetPro } from '../src/pro';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

const owner: SortRule = { column: 'owner', dir: 'asc' };
const due: SortRule = { column: 'due', dir: 'asc' };

describe('sort rules', () => {
	it('reads an old base and drops invalid or repeated rules from a new base', () => {
		expect(readSort(owner)).toEqual([owner]);
		expect(readSort(null)).toEqual([]);
		expect(readSort([owner, { column: ' OWNER ', dir: 'desc' }, { column: '', dir: 'asc' }, { column: 'due', dir: 'wrong' }, null, due])).toEqual([owner, due]);
	});
	it('adds, reverses and removes a secondary rule without changing the primary rule', () => {
		const added = nextSort(owner, 'due', true);
		expect(added).toEqual([owner, due]);
		const reversed = nextSort(added, 'due', true);
		expect(reversed).toEqual([owner, { column: 'due', dir: 'desc' }]);
		expect(nextSort(reversed, 'due', true)).toEqual([owner]);
		expect(added).toEqual([owner, due]);
	});
	it('promotes the next rule when the primary is removed and resets on a plain click', () => {
		expect(nextSort([{ ...owner, dir: 'desc' }, due], 'OWNER', true)).toEqual([due]);
		expect(nextSort([owner, due], 'hours', false)).toEqual([{ column: 'hours', dir: 'asc' }]);
		expect(nextSort({ ...owner, dir: 'desc' }, 'owner', false)).toEqual([]);
	});
	it('uses all sort rules for Markdown and CSV export', () => {
		const result = flatten([{ path: 'A.md', frontmatter: { x: [{ owner: 'Ben', hours: 2 }, { owner: 'Ana', hours: 9 }, { owner: 'Ana', hours: 2 }] } }], { property: 'x', sort: [owner, { column: 'hours', dir: 'asc' }] });
		expect(toCsv(result)).toBe('Source,owner,hours\r\nA.md,Ana,2\r\nA.md,Ana,9\r\nA.md,Ben,2\r\n');
		expect(toMarkdown(result).indexOf('Ana | 2')).toBeLessThan(toMarkdown(result).indexOf('Ana | 9'));
	});
});

describe('free view sort controls', () => {
	it('saves Shift-click rules and reads them after the view is opened again', () => {
		const saved = new Map<string, unknown>([['property', 'note.x'], ['flattenSort', owner]]);
		const view = Object.create(FlattenView.prototype) as FlattenView;
		Object.defineProperty(view, 'config', { value: { get: (key: string) => saved.get(key), set: (key: string, value: unknown) => saved.set(key, JSON.parse(JSON.stringify(value))) } });
		vi.spyOn(view, 'schedule').mockImplementation(() => undefined);
		const table = document.createElement('table');
		const draw = view as unknown as { drawHead(table: HTMLTableElement, cols: string[], opts: ViewOptions): void };
		draw.drawHead(table, ['owner', 'due'], view.options());
		table.querySelectorAll('th')[1]!.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		expect(saved.get('flattenSort')).toEqual([owner, due]);
		expect(view.options().sort).toEqual([owner, due]);
		expect(view.options().maxSources).toBe(50);
		table.replaceChildren();
		draw.drawHead(table, ['owner', 'due'], view.options());
		expect(table.querySelectorAll('th')[0]!.getAttribute('aria-sort')).toBe('ascending');
		expect(table.querySelectorAll('th')[1]!.getAttribute('aria-sort')).toBe('other');
		expect([...table.querySelectorAll('.flatten-table-sort-priority')].map((el) => el.textContent)).toEqual(['1', '2']);
		expect(table.querySelectorAll('button')[1]!.getAttribute('aria-label')).toContain('sort 2, ascending');
		table.querySelectorAll('button')[1]!.click();
		expect(saved.get('flattenSort')).toEqual([{ column: 'due', dir: 'desc' }]);
		expect(view.schedule).toHaveBeenCalledTimes(2);
	});
});

describe('header sort button style', () => {
	it('beats the app button rules, which have one class and one element', () => {
		const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const rule = css.slice(0, css.indexOf('background: transparent'));
		const selectors = rule.slice(rule.lastIndexOf('}') + 1, rule.lastIndexOf('{')).split(',').map((s) => s.trim());
		expect(selectors).toEqual(expect.arrayContaining(['.flatten-table-table .flatten-table-sort-button', '.flatten-table-table .flatten-table-sort-button:hover', '.flatten-table-table .flatten-table-sort-button.mobile-tap']));
	});
});
