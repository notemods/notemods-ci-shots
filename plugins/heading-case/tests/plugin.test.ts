import { describe, expect, it } from 'vitest';
import { App, Editor } from 'obsidian-test-mocks/obsidian';
import { convertHeadingText, type HeadingCaseMode } from '../src/core/index';
import vectors from './vectors/heading-case.json';
import HeadingCasePlugin from '../src/main';
import { planHeadingEdit } from '../src/apply';
import { DEFAULT_SETTINGS, keepList, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

class TestEditor extends (Editor as unknown as new () => Editor) {}

async function loadedPlugin(data?: unknown) {
	const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
	const plugin = new HeadingCasePlugin(app as never, manifest as never);
	if (data !== undefined) (plugin as unknown as { data__: unknown }).data__ = data;
	await plugin.onload();
	return plugin;
}

const NOTE = [
	'---',
	'title: Keep This As Is',
	'---',
	'# Getting Started With The API',
	'Body Text Stays.',
	'## Setting Up On macOS',
	'```md',
	'# Code Block Heading',
	'```',
	'### trip to new york ###',
].join('\n');

describe('golden vectors (packages/spec/vectors/heading-case.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [text, mode, keep] = c.args as [string, HeadingCaseMode, string[]];
			expect(convertHeadingText(text, mode, keep)).toBe(c.expected);
		});
	}
});

describe('settings', () => {
	it('defaults and repair', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ keepWords: 3, selectionOnly: 'no' })).toEqual(DEFAULT_SETTINGS);
		expect(keepList({ keepWords: 'New York\nGitHub, NASA,,', selectionOnly: true })).toEqual(['New York', 'GitHub', 'NASA']);
	});
});

describe('planHeadingEdit', () => {
	it('changes only heading lines outside frontmatter and code', () => {
		const edit = planHeadingEdit(NOTE, 'sentence', ['New York'], null);
		expect(edit.changes.map((c) => c.from.line)).toEqual([3, 5, 9]);
		expect(edit.changes.map((c) => c.text)).toEqual(['# Getting started with the API', '## Setting up on macOS', '### Trip to New York ###']);
		expect(edit.message).toBe('Changed 3 of 3 headings to sentence case.');
	});

	it('reports when nothing needs to change', () => {
		expect(planHeadingEdit('# Already fine\ntext', 'sentence', [], null).message).toBe('The heading in this note already uses sentence case.');
		expect(planHeadingEdit('no headings here', 'title', [], null).message).toBe('No headings in this note.');
	});
});

describe('commands on an editor', () => {
	it('registers both commands', async () => {
		const plugin = await loadedPlugin();
		const ids = [...(plugin as unknown as { commands__: Map<string, unknown> }).commands__.keys()].sort();
		expect(ids).toEqual(['convert-headings-sentence-case', 'convert-headings-title-case']);
	});

	it('title case over the whole note, one undo step', async () => {
		const plugin = await loadedPlugin({ keepWords: 'New York' });
		const editor = new TestEditor();
		editor.setValue(NOTE);
		plugin.convert(editor as never, 'title');
		const lines = editor.getValue().split('\n');
		expect(lines[3]).toBe('# Getting Started With the API');
		expect(lines[5]).toBe('## Setting Up on macOS');
		expect(lines[7]).toBe('# Code Block Heading');
		expect(lines[9]).toBe('### Trip to New York ###');
		expect(lines[1]).toBe('title: Keep This As Is');
		editor.undo();
		expect(editor.getValue()).toBe(NOTE);
	});

	it('with a selection, converts only the selected lines', async () => {
		const plugin = await loadedPlugin();
		const editor = new TestEditor();
		editor.setValue(NOTE);
		editor.setSelection({ line: 5, ch: 0 }, { line: 6, ch: 2 });
		const msg = plugin.convert(editor as never, 'sentence');
		expect(msg).toBe('Changed 1 of 1 heading to sentence case.');
		const lines = editor.getValue().split('\n');
		expect(lines[3]).toBe('# Getting Started With The API');
		expect(lines[5]).toBe('## Setting up on macOS');
	});
});
