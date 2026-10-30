import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesNoteTemplatesPlugin, { type BaseContext } from '../src/main';
import { normalizeSettings } from '../src/config';
import { EMBED_CLICK_MS, OneShot, embedView, findEmbedNew, parseEmbedSrc } from '../src/embed';
import { fillBlank, filtersToProperties, parseValue, thisProperties, type SelfRef } from '../src/filters';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => {
	resetPro();
	document.body.empty();
});

interface Inner {
	pending: Map<string, unknown>;
	onCreate(file: unknown): void;
}

/** A plugin on a mock vault with a setup for Books.base. The active tab is a note, not a base. */
async function makePlugin(hookNew = true) {
	const app = App.createConfigured__({ files: { 'Books.base': 'views:\n  - type: table\n    name: Unread\n', 'Reading list.md': '![[Books.base]]', 'Books/Untitled.md': '', 'Books/Untitled 1.md': '', 'Other/Empty.md': '' } });
	const plugin = new BasesNoteTemplatesPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.settings = normalizeSettings({ hookNew, bases: { 'Books.base': { templates: ['Templates/Book.md'], folder: 'Books', pattern: '{{date}} book' } } });
	vi.spyOn(plugin, 'activeBase').mockReturnValue(null);
	const file = (p: string) => app.vault.getFileByPath(p)!;
	const ctx: BaseContext = { file: file('Books.base') as never, view: 'Unread', host: file('Reading list.md') as never };
	const inner = plugin as unknown as Inner;
	return { app, plugin, inner, ctx, file };
}

describe('the click record of an embedded New button', () => {
	it('is used within 2 seconds and only once', () => {
		const shot = new OneShot<string>(EMBED_CLICK_MS);
		shot.record('Books', 1000);
		expect(shot.take(3000)).toBe('Books');
		expect(shot.take(3000)).toBeNull();
	});

	it('is ignored when it is older than 2 seconds', () => {
		const shot = new OneShot<string>();
		shot.record('Books', 1000);
		expect(shot.take(3001)).toBeNull();
	});
});

describe('onCreate with an embedded base', () => {
	it('a click on New in the embed makes the first empty note pending; a second empty note in the same 2 seconds is ignored', async () => {
		const { plugin, inner, ctx, file } = await makePlugin();
		plugin.recordEmbedClick(ctx);
		inner.onCreate(file('Books/Untitled.md'));
		inner.onCreate(file('Books/Untitled 1.md'));
		expect([...inner.pending.keys()]).toEqual(['Books/Untitled.md']);
		plugin.onunload();
	});

	it('a click that is older than 2 seconds is ignored', async () => {
		const { plugin, inner, ctx, file } = await makePlugin();
		plugin.recordEmbedClick(ctx, Date.now() - EMBED_CLICK_MS - 1);
		inner.onCreate(file('Books/Untitled.md'));
		expect(inner.pending.size).toBe(0);
		plugin.onunload();
	});

	it('a note that another plugin makes while the host note is active, with no click, is not changed', async () => {
		const { plugin, inner, file } = await makePlugin();
		inner.onCreate(file('Other/Empty.md'));
		inner.onCreate(file('Books/Untitled.md'));
		expect(inner.pending.size).toBe(0);
		plugin.onunload();
	});

	it('does nothing when "Use templates with the New button" is off', async () => {
		const { plugin, inner, ctx, file } = await makePlugin(false);
		plugin.recordEmbedClick(ctx);
		inner.onCreate(file('Books/Untitled.md'));
		expect(inner.pending.size).toBe(0);
		plugin.onunload();
	});

	it('does nothing for an embedded base without a setup', async () => {
		const { plugin, inner, ctx, file } = await makePlugin();
		plugin.settings = normalizeSettings({ bases: {} });
		plugin.recordEmbedClick(ctx);
		inner.onCreate(file('Books/Untitled.md'));
		expect(inner.pending.size).toBe(0);
		plugin.onunload();
	});

	it('resolves the base from the src of the embed and the host note', async () => {
		const { plugin, file } = await makePlugin();
		const el = document.body.createDiv();
		vi.spyOn(plugin.app.workspace, 'getActiveFile').mockReturnValue(file('Reading list.md') as never);
		const got = plugin.embedContext({ src: 'Books.base#Unread', shownView: '', el });
		expect(got && { file: got.file.path, view: got.view, host: got.host?.path }).toEqual({ file: 'Books.base', view: 'Unread', host: 'Reading list.md' });
		expect(plugin.embedContext({ src: 'Reading list', shownView: '', el })).toBeNull();
	});
});

/** The DOM of a base in a note: an embed of a base file, or a `base` code block. */
function embedDom(kind: 'file' | 'code', src = 'Books.base#Unread', shown = 'Unread'): { newButton: HTMLElement; viewsButton: HTMLElement } {
	const host = document.body.createDiv('markdown-preview-view');
	const embed = kind === 'file' ? host.createSpan({ cls: 'internal-embed bases-embed is-loaded', attr: { src } }) : host.createDiv('block-language-base bases-embed');
	const toolbar = embed.createDiv('bases-header').createDiv('bases-toolbar');
	const views = toolbar.createDiv('bases-toolbar-item bases-toolbar-views-menu').createDiv('text-icon-button');
	views.createSpan({ cls: 'text-button-label', text: shown });
	const newButton = toolbar.createDiv('bases-toolbar-item bases-toolbar-new-item-menu').createDiv('text-icon-button');
	newButton.createSpan({ cls: 'text-button-label', text: 'New' });
	return { newButton: newButton.querySelector('.text-button-label')!, viewsButton: views };
}

describe('the New button of an embed in the DOM', () => {
	it('finds the src and the shown view of an embedded base file', () => {
		const { newButton } = embedDom('file', 'Books.base#Unread', 'All books');
		expect(findEmbedNew(newButton)).toMatchObject({ src: 'Books.base#Unread', shownView: 'All books' });
	});

	it('ignores a base code block, other buttons and other targets', () => {
		expect(findEmbedNew(embedDom('code').newButton)).toBeNull();
		expect(findEmbedNew(embedDom('file').viewsButton)).toBeNull();
		expect(findEmbedNew(document.body)).toBeNull();
		expect(findEmbedNew(null)).toBeNull();
	});

	it('reads the base path and the view of the link', () => {
		expect(parseEmbedSrc('Books.base#Unread')).toEqual({ path: 'Books.base', view: 'Unread' });
		expect(parseEmbedSrc('Work/Books.base')).toEqual({ path: 'Work/Books.base', view: '' });
		expect(parseEmbedSrc('Books.base#Unread|Shown')).toEqual({ path: 'Books.base', view: 'Unread' });
	});

	it('uses the view that the embed shows, else the view of the link', () => {
		expect(embedView({ src: 'Books.base#Unread', shownView: 'All' })).toBe('All');
		expect(embedView({ src: 'Books.base#Unread', shownView: '' })).toBe('Unread');
		expect(embedView({ src: 'Books.base', shownView: '' })).toBe('');
	});
});

describe('this in the filters of an embedded base', () => {
	const self: SelfRef = { link: 'Host note', path: 'Projects/Host note.md', name: 'Host note.md', basename: 'Host note', folder: 'Projects', props: { lead: '[[Ada]]', area: 'Ops' } };

	it('a filter project == this.file gives project: "[[Host note]]" in the new note', () => {
		const fromThis = thisProperties({ and: ['file.inFolder("Tasks")', 'status == "todo"', 'project == this.file'] }, undefined, self);
		expect(fromThis).toEqual({ project: '[[Host note]]' });
		expect(fillBlank({ status: 'todo', project: null }, fromThis)).toEqual({ status: 'todo', project: '[[Host note]]' });
	});

	it('reads this.file parts and the properties of the host note', () => {
		expect(thisProperties({ and: ['owner == this.lead', 'team == this.note.area', 'where == this.file.folder', 'title.contains(this.file.basename)'] }, undefined, self, { types: { title: 'text' } })).toEqual({ owner: '[[Ada]]', team: 'Ops', where: 'Projects', title: 'Host note' });
	});

	it('skips a this value that it cannot resolve, and every this value without a host note', () => {
		expect(thisProperties({ and: ['owner == this.missing', 'x == this.file.ctime'] }, undefined, self)).toEqual({});
		expect(filtersToProperties({ and: ['project == this.file'] }, undefined).properties).toEqual({});
		expect(parseValue('this.file')).toBeUndefined();
	});

	it('does not replace a value that the app already wrote', () => {
		const props = { project: '[[Other]]' };
		expect(fillBlank(props, { project: '[[Host note]]' })).toBe(props);
	});
});
