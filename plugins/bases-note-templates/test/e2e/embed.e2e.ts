// The New button of a base embedded in a note: ![[Books.base]], ![[Books.base#Unread]], two embeds in one note,
// and a `base` code block (no base file, so the plugin leaves it to the app).
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
import { cleanUp, configure, filesIn, frontmatter, setPro, today, waitForNew } from './util';

const BOOKS = { templates: ['Templates/Book.md'], folder: 'Books', pattern: '{{date}} {{view}}', views: { Unread: 'Templates/Unread book.md' } };
const TASKS = { templates: ['Templates/Task.md'], pattern: '{{date}} {{project}}' };

/** Opens a note in a new tab, in live preview ('source') or in reading view ('preview'). */
async function openNote(path: string, mode: 'source' | 'preview'): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, p, m) => {
			const file = app.vault.getFileByPath(p);
			if (!file) throw new Error(`no ${p}`);
			await app.workspace.getLeaf('tab').openFile(file, { active: true, state: { mode: m } });
		},
		path,
		mode,
	);
	await browser.pause(800);
}

/** The New button of a base in the active note: an embed with this src, or the first `base` code block. */
function newButton(src: string | null): string {
	const scope = src ? `.workspace-leaf.mod-active [src="${src}"]` : '.workspace-leaf.mod-active .block-language-base';
	return `${scope} .bases-toolbar-new-item-menu .text-icon-button`;
}

/** Waits for the embed to load, then clicks its New button like a user. A hidden editor can hold a copy of the embed. */
async function pressEmbedNew(src: string | null): Promise<void> {
	const sel = newButton(src);
	let shown: WebdriverIO.Element | undefined;
	await browser.waitUntil(
		async () => {
			for (const el of await browser.$$(sel).getElements()) {
				if (await el.isDisplayed()) {
					shown = el;
					return true;
				}
			}
			return false;
		},
		{ timeout: 8000, timeoutMsg: `no visible New button in ${src ?? 'the code block'}` },
	);
	await shown!.scrollIntoView({ block: 'center' });
	await browser.pause(300);
	await shown!.click();
}

/** Starts Obsidian again with the plugin off or on. obsidianPage.resetVault removes the plugin files, so a plain switch cannot turn it on again. */
async function setPlugin(on: boolean): Promise<void> {
	await browser.reloadObsidian({ plugins: on ? [pluginId] : [] });
	const loaded = await browser.executeObsidian(({ app }, id) => id in (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins, pluginId);
	expect(loaded).toBe(on);
}

async function remove(path: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, p) => {
		const f = app.vault.getFileByPath(p);
		if (f) await app.vault.delete(f);
	}, path);
}

describe('the New button of an embedded base', function () {
	beforeEach(async function () {
		await obsidianPage.resetVault();
		await configure({ 'Books.base': BOOKS, 'Tasks.base': TASKS });
	});
	afterEach(async function () {
		await setPro(false);
		await cleanUp();
	});

	for (const mode of ['source', 'preview'] as const) {
		it(`![[Books.base]] in ${mode === 'source' ? 'live preview' : 'reading view'}: template, filter values, folder and name pattern`, async function () {
			await openNote('Hosts/Reading list.md', mode);
			const before = await filesIn('Books');
			await pressEmbedNew('Books.base');
			const date = await today();
			const made = await waitForNew('Books', before, (text, path) => path === `Books/${date} Reading.md` && text.includes('## Summary'));
			expect(made.text).toContain('## Quotes');
			const fm = await frontmatter(made.path);
			// Filter values of the base and of the Reading view win over the template; template-only values stay.
			expect(fm).toMatchObject({ status: 'reading', done: false, rating: 4, tags: ['book'], genre: ['scifi'], shelf: 'home' });
		});
	}

	it('![[Books.base#Unread]]: the view template with Pro, the base template without Pro', async function () {
		expect(await setPro(false)).toBe(false);
		await openNote('Hosts/Unread list.md', 'preview');
		const date = await today();
		let before = await filesIn('Books');
		await pressEmbedNew('Books.base#Unread');
		const free = await waitForNew('Books', before, (text, path) => path === `Books/${date} Unread.md` && text.includes('## Summary'));
		expect(free.text).not.toContain('## Why read it');
		expect(await frontmatter(free.path)).toMatchObject({ status: 'unread', shelf: 'home' });
		expect(await browser.$('.prompt').isExisting()).toBe(false);

		await cleanUp();
		expect(await setPro(true)).toBe(true);
		await openNote('Hosts/Unread list.md', 'preview');
		before = await filesIn('Books');
		await pressEmbedNew('Books.base#Unread');
		await browser.waitUntil(async () => (await browser.$$('.prompt .suggestion-item').length) > 0, { timeout: 5000 });
		const items = await browser.executeObsidian(() => Array.from(document.querySelectorAll('.prompt .suggestion-item > div')).map((e) => (e as HTMLElement).innerText));
		expect(items).toEqual(['Unread book', 'Book']);
		await (await browser.$('.prompt .suggestion-item')).click();
		const pro = await waitForNew('Books', before, (text, path) => path === `Books/${date} Unread 1.md` && text.includes('## Why read it'));
		expect(await frontmatter(pro.path)).toMatchObject({ status: 'unread', shelf: 'wishlist' });
	});

	it('two embeds of two bases in one note: the setup of the embed that the user clicked', async function () {
		await openNote('Hosts/Dashboard.md', 'source');
		const date = await today();
		const tasksBefore = await filesIn('Tasks');
		const booksBefore = await filesIn('Books');
		await pressEmbedNew('Tasks.base#Apollo');
		const task = await waitForNew('Tasks', tasksBefore, (text, path) => path === `Tasks/${date} Apollo.md` && text.includes('## Goal'));
		expect(await frontmatter(task.path)).toMatchObject({ status: 'todo', priority: 'normal', project: '[[Apollo]]' });
		expect(await filesIn('Books')).toEqual(booksBefore);

		await cleanUp();
		await openNote('Hosts/Dashboard.md', 'source');
		await pressEmbedNew('Books.base');
		const book = await waitForNew('Books', booksBefore, (text, path) => path === `Books/${date} Reading.md` && text.includes('## Summary'));
		expect(book.text).not.toContain('## Goal');
		expect(await filesIn('Tasks')).toEqual([...tasksBefore, task.path].sort());
	});

	it('a base code block: the same note as the app makes without the plugin', async function () {
		await openNote('Hosts/Code block.md', 'preview');
		let before = await filesIn('Books');
		await pressEmbedNew(null);
		const withPlugin = await waitForNew('Books', before, (text) => text.startsWith('---'));
		await browser.pause(1800);
		const withText = await obsidianPage.read(withPlugin.path);
		await cleanUp();
		await remove(withPlugin.path);

		await setPlugin(false);
		try {
			await openNote('Hosts/Code block.md', 'preview');
			before = await filesIn('Books');
			await pressEmbedNew(null);
			const core = await waitForNew('Books', before, (text) => text.startsWith('---'));
			await browser.pause(800);
			expect(withPlugin.path).toBe(core.path);
			expect(withText).toBe(await obsidianPage.read(core.path));
			expect(withText).toContain('status: unread');
		} finally {
			await cleanUp();
			await setPlugin(true);
		}
	});
});
