// Pro through GitHub Sponsors with a stubbed network: picker, view templates, Duplicate as new note, Templater.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId } from './load';
import { cleanUp, configure, filesIn, frontmatter, openBase, pressNew, setPro, waitForNew } from './util';

const MULTI = { templates: ['Templates/Task.md', 'Templates/Bug.md'], views: { Apollo: 'Templates/Apollo task.md' } };

async function pickerItems(): Promise<string[]> {
	await browser.waitUntil(async () => (await browser.$$('.prompt .suggestion-item').length) > 0, { timeout: 5000 });
	return browser.executeObsidian(() => Array.from(document.querySelectorAll('.prompt .suggestion-item > div')).map((e) => (e as HTMLElement).innerText));
}

async function choose(name: string): Promise<void> {
	const items = await browser.$$('.prompt .suggestion-item');
	for (const item of items) {
		if ((await item.getText()).startsWith(name)) {
			await item.click();
			return;
		}
	}
	throw new Error(`no picker item ${name}`);
}

describe('pro features', function () {
	beforeEach(async function () {
		await obsidianPage.resetVault();
		await configure({ 'Tasks.base': MULTI });
	});
	afterEach(async function () {
		await setPro(false);
		await cleanUp();
	});

	it('free: two templates and a view template, only the first base template is used, no picker', async function () {
		expect(await setPro(false)).toBe(false);
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await browser.executeObsidianCommand(`${pluginId}:new-from-template`);
		const made = await waitForNew('Tasks', before, (text) => text.includes('## Goal'));
		expect((await frontmatter(made.path)).priority).toBe('normal');
		expect(await browser.$('.prompt').isExisting()).toBe(false);
	});

	it('pro: the command offers the view template first, then the base templates', async function () {
		expect(await setPro(true)).toBe(true);
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await browser.executeObsidianCommand(`${pluginId}:new-from-template`);
		expect(await pickerItems()).toEqual(['Apollo task', 'Task', 'Bug']);
		await choose('Bug');
		const made = await waitForNew('Tasks', before, (text) => text.includes('Steps to reproduce'));
		expect(await frontmatter(made.path)).toEqual({ kind: 'bug', severity: 'medium', status: 'todo', project: '[[Apollo]]', due: null });
		expect(made.text).toContain('## Seen in Apollo of Tasks');
	});

	it('pro: New opens the picker and applies the chosen template to the new note', async function () {
		await setPro(true);
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await pressNew();
		await pickerItems();
		await choose('Apollo task');
		const made = await waitForNew('Tasks', before, (text) => text.includes('Apollo task created'));
		expect(await frontmatter(made.path)).toEqual({ milestone: 'M1', status: 'todo', project: '[[Apollo]]', due: null });
	});

	it('pro: Escape in the picker leaves the app note as it is', async function () {
		await setPro(true);
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await pressNew();
		await pickerItems();
		await browser.keys(['Escape']);
		const made = await waitForNew('Tasks', before, (text) => text.startsWith('---'));
		await browser.pause(800);
		expect(await obsidianPage.read(made.path)).toBe('---\nstatus: todo\nproject: "[[Apollo]]"\ndue:\n---\n');
	});

	it('Duplicate as new note: a notice without pro, a copy with pro', async function () {
		await obsidianPage.openFile('Tasks/Write spec.md');
		await browser.executeObsidianCommand(`${pluginId}:duplicate-note`);
		await browser.waitUntil(async () => (await lastNotice()).includes('pro feature'), { timeout: 5000 });
		expect(await filesIn('Tasks')).toEqual(['Tasks/Write spec.md']);
		await setPro(true);
		await obsidianPage.openFile('Tasks/Write spec.md');
		await browser.executeObsidianCommand(`${pluginId}:duplicate-note`);
		const made = await waitForNew('Tasks', ['Tasks/Write spec.md'], (text) => text.includes('Write the spec.'));
		expect(made.path).toBe('Tasks/Write spec 1.md');
	});

	it('Duplicate as new note is in the row menu of a base (bases-context-menu)', async function () {
		const titles = await browser.executeObsidian(({ app, obsidian }) => {
			const menu = new obsidian.Menu();
			const file = app.vault.getFileByPath('Tasks/Write spec.md')!;
			app.workspace.trigger('file-menu', menu, file, 'bases-context-menu', null);
			const items = (menu as unknown as { items: { titleEl?: HTMLElement }[] }).items;
			return items.map((i) => i.titleEl?.innerText ?? '');
		});
		expect(titles).toContain('Duplicate as new note');
	});

	it('pro: Templater fills its tags through its own method; without Templater a notice says so', async function () {
		await setPro(true);
		await configure({ 'Tasks.base': { templates: ['Templates/Templater.md'] } });
		await openBase('Tasks.base', 'All');
		let before = await filesIn('Tasks');
		await browser.executeObsidianCommand(`${pluginId}:new-from-template`);
		await browser.waitUntil(async () => (await lastNotice()).includes('templater plugin is not on'), { timeout: 8000 });
		await waitForNew('Tasks', before, (text) => text.includes('<% "by Templater" %>'));
		// A stand-in Templater with the same method other plugins call.
		await browser.executeObsidian(({ app }) => {
			const plugins = (app as unknown as { plugins: { getPlugin: (id: string) => unknown; __orig?: unknown } }).plugins;
			plugins.__orig = plugins.getPlugin;
			const fake = { templater: { overwrite_file_commands: async (file: { path: string }) => { const t = await app.vault.adapter.read(file.path); await app.vault.adapter.write(file.path, t.replace(/<%[\s\S]*?%>/g, 'by Templater')); } } };
			plugins.getPlugin = (id: string) => (id === 'templater-obsidian' ? fake : null);
		});
		try {
			await openBase('Tasks.base', 'All');
			before = await filesIn('Tasks');
			await browser.executeObsidianCommand(`${pluginId}:new-from-template`);
			await waitForNew('Tasks', before, (text) => text.includes('Made by Templater.'));
		} finally {
			await browser.executeObsidian(({ app }) => {
				const plugins = (app as unknown as { plugins: { getPlugin: unknown; __orig?: unknown } }).plugins;
				plugins.getPlugin = plugins.__orig;
				delete plugins.__orig;
			});
		}
	});
});
