import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { TagPropertiesView } from '../src/view';
import { buildIndex } from '../src/tags';
import type TagPropertiesPlugin from '../src/main';

function setup() {
	const app = App.createConfigured__({ files: { 'A.md': 'a', 'B.md': 'b' } });
	const rows = buildIndex([
		{ path: 'A.md', frontmatter: { topics: ['research'] } },
		{ path: 'B.md', frontmatter: { topics: ['research/interviews'] } },
	], ['topics']);
	const host = {
		properties: () => ['topics'], includeCore: () => false, index: () => rows,
		currentNote: () => ({ path: 'A.md', frontmatter: { topics: ['research'] } }),
	};
	const view = new TagPropertiesView(app.workspace.getLeaf(true) as never, host as TagPropertiesPlugin);
	document.body.appendChild(view.containerEl);
	view.render();
	return { app, view, root: view.contentEl };
}

afterEach(() => { document.body.empty(); });

describe('clickable tag view', () => {
	it('shows the active note tags and unique-note counts', () => {
		const { root } = setup();
		expect(root.textContent).toContain('Current note');
		expect(root.textContent).toContain('#research · 1');
	});
	it('selects a tag and displays matching note links and a filter', () => {
		const { root } = setup();
		(root.querySelector('.tag-properties-chip') as HTMLButtonElement).click();
		expect(root.querySelector('.tag-properties-notes')?.textContent).toBe('A');
		expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toContain('== "research"');
	});
	it('includes child tags through the checkbox', () => {
		const { root } = setup();
		(root.querySelector('.tag-properties-chip') as HTMLButtonElement).click();
		(root.querySelector('input[type=checkbox]') as HTMLInputElement).click();
		expect(root.querySelector('.tag-properties-notes')?.textContent).toContain('B');
		expect(root.textContent).toContain('2 matching notes');
	});
	it('filters tag buttons without clearing the selection', () => {
		const { root, view } = setup();
		view.selected = 'research';
		view.render();
		const input = root.querySelector('input[type=search]') as HTMLInputElement;
		input.value = 'interviews';
		input.dispatchEvent(new Event('input'));
		expect(root.querySelectorAll('.tag-properties-chip').length).toBe(2); // current note plus matching tag
		expect(root.querySelector('.tag-properties-notes')?.textContent).toBe('A');
	});
	it('copies the exact displayed expression', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
		const { root } = setup();
		(root.querySelector('.tag-properties-chip') as HTMLButtonElement).click();
		const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Copy bases filter');
		button?.click();
		await Promise.resolve();
		expect(write).toHaveBeenCalledWith((root.querySelector('textarea') as HTMLTextAreaElement).value);
	});
	it('selects the filter if clipboard access is unavailable', async () => {
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
		const { root } = setup();
		(root.querySelector('.tag-properties-chip') as HTMLButtonElement).click();
		[...root.querySelectorAll('button')].find((b) => b.textContent === 'Copy bases filter')?.click();
		await Promise.resolve();
		const field = root.querySelector('textarea') as HTMLTextAreaElement;
		expect(field.selectionEnd).toBe(field.value.length);
		expect(document.activeElement).toBe(field);
	});
	it('renders an empty state without a chosen property', () => {
		const { view, root } = setup();
		view.query = 'not-present';
		view.render();
		expect(root.textContent).toContain('No matching tags');
	});
});
