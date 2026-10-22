import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { buildOutline, filterOutline, outlineLines } from '../src/outline';
import { EmbedOutlineView } from '../src/view';
import { resetPro } from '../src/pro';
import { FREE, PRO } from './sample-expect';
import { fakeSource } from './scan';
import type EmbedOutlinePlugin from '../src/main';

afterEach(() => {
	resetPro();
	document.body.empty();
});

const files = { 'Book.md': '# Book\n![[Chapter]]\n# Other\n', 'Chapter.md': '# Chapter\n## The ferry\n## Night watch\n' };
const outline = () => buildOutline('Book.md', fakeSource(files), FREE);

describe('outline search', () => {
	it('keeps the tree, row targets, word counts and locked rows unchanged', () => {
		const source = buildOutline('Book.md', fakeSource({ ...files, 'Chapter.md': '# Chapter\n![[Locked]]', 'Locked.md': '# Inside' }), FREE);
		const before = JSON.stringify(source);
		const result = filterOutline(source.items, 'locked');
		expect(result.matches).toBe(1);
		expect(result.items[0]!.children[0]!.children[0]!.children[0]).toMatchObject({ locked: true, path: 'Locked.md', rootLine: 1 });
		expect(JSON.stringify(source)).toBe(before);
	});
	it('matches callout titles and list headings', () => {
		const source = buildOutline('N.md', fakeSource({ 'N.md': '# Top\n> [!warning] Spring tides\n- ## Open questions\n' }), FREE);
		expect(outlineLines(filterOutline(source.items, 'tides').items)).toHaveLength(2);
		expect(filterOutline(source.items, 'open q').matches).toBe(1);
	});
	it('matches composed and decomposed Unicode text', () => {
		const source = buildOutline('N.md', fakeSource({ 'N.md': '# Café\n# 港口' }), FREE);
		expect(filterOutline(source.items, 'CAFE\u0301').matches).toBe(1);
		expect(filterOutline(source.items, '港').matches).toBe(1);
	});
});

describe('search in the view', () => {
	function setup() {
		const app = App.createConfigured__({ files });
		const plugin = { jump: vi.fn(), copyOutline: vi.fn(), scheduleRefresh: vi.fn() };
		const view = new EmbedOutlineView(app.workspace.getLeaf(false) as never, plugin as unknown as EmbedOutlinePlugin);
		document.body.appendChild(view.contentEl);
		view.show(outline());
		const input = () => view.contentEl.querySelector<HTMLInputElement>('input')!;
		const search = (text: string) => {
			input().value = text;
			input().dispatchEvent(new Event('input'));
		};
		const texts = () => Array.from(view.contentEl.querySelectorAll('.embed-outline-text')).map((el) => el.textContent);
		return { view, plugin, input, search, texts };
	}

	it('opens folded paths to matches and restores folds after Escape or clear', () => {
		const { view, input, search, texts } = setup();
		view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Fold all"]')!.click();
		expect(texts()).toEqual(['Book', 'Other']);
		search(' FERRY ');
		expect(texts()).toEqual(['Book', 'Chapter', 'Chapter', 'The ferry']);
		expect(view.contentEl.querySelector('[role="status"]')?.textContent).toBe('1 match');
		input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(texts()).toEqual(['Book', 'Other']);
		search('missing');
		expect(texts()).toEqual([]);
		expect(view.contentEl.textContent).toContain('No matching rows.');
		view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Clear outline search"]')!.click();
		expect(input().value).toBe('');
		expect(texts()).toEqual(['Book', 'Other']);
		view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Fold all"]')!.click();
		expect(texts()).toHaveLength(6);
	});

	it('restores a note fold when switching back and keeps it after an inserted heading', () => {
		const { view, texts } = setup();
		view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Fold all"]')!.click();
		view.show(buildOutline('Chapter.md', fakeSource(files), FREE));
		view.show(outline());
		expect(texts()).toEqual(['Book', 'Other']);
		view.show(buildOutline('Book.md', fakeSource({ ...files, 'Book.md': '# Added\n## Child\n' + files['Book.md'] }), FREE));
		expect(texts()).toEqual(['Added', 'Child', 'Book', 'Other']);
	});

	it('keeps the input focused on refresh and clears the query on a note change', () => {
		const { view, input, search, texts } = setup();
		search('ferry');
		input().focus();
		input().setSelectionRange(2, 2);
		view.show(outline());
		expect(input().value).toBe('ferry');
		expect(document.activeElement).toBe(input());
		expect(input().selectionStart).toBe(2);
		view.show(buildOutline('Chapter.md', fakeSource(files), FREE));
		expect(input().value).toBe('');
		expect(texts()).toEqual(['Chapter', 'The ferry', 'Night watch']);
	});

	it('jumps to the matching embedded row with its original target', () => {
		const { view, plugin, search } = setup();
		search('ferry');
		const row = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.embed-outline-row')).at(-1)!;
		row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
		expect(plugin.jump).toHaveBeenCalledWith(expect.objectContaining({ text: 'The ferry', path: 'Chapter.md', line: 1, rootLine: 1, depth: 1 }), true);
		expect(outlineLines(view.current()!.items)).toHaveLength(6);
	});

	it('updates matches when an embedded heading changes', () => {
		const { view, search, texts } = setup();
		search('ferry');
		view.show(buildOutline('Book.md', fakeSource({ ...files, 'Chapter.md': '# Chapter\n## The boat' }), FREE));
		expect(texts()).toEqual([]);
		view.show(outline());
		expect(texts()).toContain('The ferry');
	});

	it('matches the row label that the panel shows', () => {
		const { view, search, texts } = setup();
		const src = fakeSource({ 'Book.md': '![[Notes/Quote#^q1]]\n![[Gone]]\n', 'Notes/Quote.md': 'Text ^q1\n' });
		view.show(buildOutline('Book.md', src, PRO));
		search('^q1');
		expect(texts()).toEqual(['Quote > ^q1']);
		search('no such note');
		expect(texts()).toEqual(['No such note: Gone']);
		search('notes');
		expect(texts()).toEqual([]);
	});

	it('shows zero matches when an empty outline is searched', () => {
		const { view, search } = setup();
		view.show(buildOutline('Empty.md', fakeSource({ 'Empty.md': '' }), FREE));
		search('ferry');
		expect(view.contentEl.querySelector('[role="status"]')?.textContent).toBe('0 matches');
	});
});
