import { afterEach, describe, expect, it } from 'vitest';
import { NoteTables, type NoteTableScope } from '../src/note-tables';

const controllers: NoteTables[] = [];

function fixture(cls = 'markdown-rendered') {
	const root = createDiv(cls);
	const table = root.createEl('table');
	const head = table.createEl('thead').createEl('tr');
	head.createEl('th', { text: 'Name' });
	head.createEl('th', { text: 'Status' });
	const cell = table.createEl('tbody').createEl('tr').createEl('td');
	const link = cell.createEl('a', { text: 'Project', href: 'Project.md' });
	const tables = new NoteTables();
	controllers.push(tables);
	const scope: NoteTableScope = { root, header: true, column: true, height: 500 };
	return { root, table, link, tables, scope };
}

afterEach(() => controllers.splice(0).forEach((tables) => tables.clear()));

describe('rendered note tables', () => {
	it('uses the existing editor wrapper and restores its classes on cleanup', () => {
		const { root, table, tables, scope } = fixture('cm-table-widget');
		const wrapper = root.createDiv('table-wrapper');
		wrapper.appendChild(table);
		const button = wrapper.createEl('button', { text: 'Add row' });
		tables.sync([scope]);
		expect(table.parentElement).toBe(wrapper);
		expect(root.querySelectorAll('.bfp-note-table')).toHaveLength(1);
		tables.clear();
		expect(table.parentElement).toBe(wrapper);
		expect(wrapper.className).toBe('table-wrapper');
		expect(button.parentElement).toBe(wrapper);
		expect(wrapper.style.getPropertyValue('--bfp-note-height')).toBe('');
	});

	it('keeps the same cell nodes and makes only one box on repeated refresh', () => {
		const { root, table, link, tables, scope } = fixture();
		tables.sync([scope]);
		tables.sync([scope]);
		expect(root.querySelectorAll('.bfp-note-table')).toHaveLength(1);
		expect(table.querySelector('a')).toBe(link);
		expect(table.parentElement?.classList.contains('bfp-note-header')).toBe(true);
		expect(table.parentElement?.classList.contains('bfp-note-column')).toBe(true);
	});

	it('keeps header and column switches separate and updates the height', () => {
		const { table, tables, scope } = fixture();
		tables.sync([{ ...scope, header: false, height: 700 }]);
		expect(table.parentElement?.classList.contains('bfp-note-header')).toBe(false);
		expect(table.parentElement?.classList.contains('bfp-note-column')).toBe(true);
		expect(table.parentElement?.style.getPropertyValue('--bfp-note-height')).toBe('700px');
		tables.sync([{ ...scope, column: false }]);
		expect(table.parentElement?.classList.contains('bfp-note-header')).toBe(true);
		expect(table.parentElement?.classList.contains('bfp-note-column')).toBe(false);
	});

	it('gives each table its own box and handles a later Dataview render', async () => {
		const { root, tables, scope } = fixture();
		tables.sync([scope]);
		const block = root.createDiv('block-language-dataview');
		const table = block.createEl('table');
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(root.querySelectorAll('.bfp-note-table')).toHaveLength(2);
		expect(table.parentElement?.classList.contains('bfp-note-table')).toBe(true);
	});

	it.each(['cm-table-widget', 'block-language-dataview', 'block-language-dataviewjs'])('finds a table in %s', (cls) => {
		const { table, tables, scope } = fixture(cls);
		tables.sync([scope]);
		expect(table.parentElement?.classList.contains('bfp-note-table')).toBe(true);
	});

	it('removes boxes when a tab closes and cannot wrap later tables in that tab', async () => {
		const { root, table, tables, scope } = fixture();
		tables.sync([scope]);
		tables.sync([]);
		expect(table.parentElement).toBe(root);
		root.createEl('table');
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(root.querySelectorAll('.bfp-note-table')).toHaveLength(0);
	});

	it('clears a queued render on unload and preserves table order', async () => {
		const { root, table, link, tables, scope } = fixture();
		const after = root.createEl('p', { text: 'After the table' });
		tables.sync([scope]);
		root.createDiv('block-language-dataview').createEl('table');
		tables.clear();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(root.firstElementChild).toBe(table);
		expect(table.nextElementSibling).toBe(after);
		expect(table.querySelector('a')).toBe(link);
		expect(root.querySelectorAll('.bfp-note-table')).toHaveLength(0);
	});

	it('does not wrap nested tables or tables in Bases cells', () => {
		const { root, table, tables, scope } = fixture();
		const nested = table.querySelector('td')!.createEl('table');
		const bases = root.createDiv('bases-view').createEl('table');
		tables.sync([scope]);
		expect(root.querySelectorAll('.bfp-note-table')).toHaveLength(1);
		expect(nested.parentElement?.tagName).toBe('TD');
		expect(bases.parentElement?.classList.contains('bases-view')).toBe(true);
	});

	it('drops boxes and references after a rendered table is replaced', async () => {
		const { root, table, tables, scope } = fixture();
		tables.sync([scope]);
		table.remove();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(root.querySelectorAll('.bfp-note-table')).toHaveLength(0);
	});
});
