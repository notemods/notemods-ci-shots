// Free tier: the core New button, the command and the header button with one template, a folder and a name pattern.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
import { cleanUp, configure, filesIn, frontmatter, openBase, pressNew, today, waitForNew } from './util';

const TASKS = { templates: ['Templates/Task.md'], pattern: '{{date}} {{project}}' };

describe('new notes from a template (free)', function () {
	beforeEach(async function () {
		await obsidianPage.resetVault();
		await configure({ 'Tasks.base': TASKS });
	});
	afterEach(cleanUp);

	it('New in a base: template properties and text, filter values on top, renamed by the pattern', async function () {
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await pressNew();
		const date = await today();
		const made = await waitForNew('Tasks', before, (text, path) => path === `Tasks/${date} Apollo.md` && text.includes('## Goal'));
		expect(await frontmatter(made.path)).toEqual({ status: 'todo', priority: 'normal', created: date, project: '[[Apollo]]', due: null });
		expect(made.text).toContain('## Steps\n- [ ] ');
	});

	it('the command makes the same note in a new tab', async function () {
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await browser.executeObsidianCommand(`${pluginId}:new-from-template`);
		const date = await today();
		const made = await waitForNew('Tasks', before, (text, path) => path === `Tasks/${date} Apollo.md` && text.includes('## Goal'));
		expect(await frontmatter(made.path)).toEqual({ status: 'todo', priority: 'normal', created: date, project: '[[Apollo]]', due: null });
		const active = await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path);
		expect(active).toBe(made.path);
	});

	it('the header button of a base with a setup makes a note too', async function () {
		await openBase('Tasks.base', 'All');
		const btn = await browser.$('.workspace-leaf.mod-active .bnt-new-button');
		await expect(btn).toExist();
		const before = await filesIn('Tasks');
		await btn.click();
		const date = await today();
		const made = await waitForNew('Tasks', before, (text) => text.includes('## Goal'));
		expect(made.path).toBe(`Tasks/${date}.md`);
		expect(await frontmatter(made.path)).toEqual({ status: 'todo', priority: 'normal', created: date });
	});

	it('a second note with the same name gets a number', async function () {
		const date = await today();
		for (const name of [`${date} Apollo`, `${date} Apollo 1`]) {
			// The command opens each new note in a new tab, so go back to the base first.
			await openBase('Tasks.base', 'Apollo');
			const before = await filesIn('Tasks');
			await browser.executeObsidianCommand(`${pluginId}:new-from-template`);
			await waitForNew('Tasks', before, (_t, path) => path === `Tasks/${name}.md`);
		}
	});

	it('a base without a setup is left to the app (fail closed)', async function () {
		await configure({});
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await pressNew();
		const made = await waitForNew('Tasks', before, (text) => text.startsWith('---'));
		await browser.pause(1800);
		expect(made.path).toBe('Tasks/Untitled.md');
		expect(await obsidianPage.read(made.path)).toBe('---\nstatus: todo\nproject: "[[Apollo]]"\ndue:\n---\n');
	});

	it('the main switch off leaves the New button to the app', async function () {
		await configure({ 'Tasks.base': TASKS }, { hookNew: false });
		await openBase('Tasks.base', 'Apollo');
		const before = await filesIn('Tasks');
		await pressNew();
		const made = await waitForNew('Tasks', before, (text) => text.startsWith('---'));
		await browser.pause(1800);
		expect(made.path).toBe('Tasks/Untitled.md');
		expect(await obsidianPage.read(made.path)).not.toContain('## Goal');
	});

	it('the folder setting and a missing folder', async function () {
		await configure({ 'Tasks.base': { ...TASKS, folder: 'Inbox/New', pattern: 'Task {{date:YYYY}}' } });
		await openBase('Tasks.base', 'Apollo');
		await browser.executeObsidianCommand(`${pluginId}:new-from-template`);
		const year = (await today()).slice(0, 4);
		const made = await waitForNew('Inbox/New', [], (_t, path) => path === `Inbox/New/Task ${year}.md`);
		expect(made.text).toContain('priority: normal');
	});

	it('an empty note made elsewhere while the base is open is left alone (fail closed)', async function () {
		await openBase('Tasks.base', 'Apollo');
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.create('Projects/Empty.md', '');
		});
		await browser.pause(2200);
		expect(await obsidianPage.read('Projects/Empty.md')).toBe('');
	});

	it('New with a folder setting moves the note there', async function () {
		await configure({ 'Tasks.base': { ...TASKS, folder: 'Inbox' } });
		await openBase('Tasks.base', 'Apollo');
		await pressNew();
		const date = await today();
		const made = await waitForNew('Inbox', [], (text, path) => path === `Inbox/${date} Apollo.md` && text.includes('## Goal'));
		expect((await frontmatter(made.path)).status).toBe('todo');
		expect(await filesIn('Tasks')).toEqual(['Tasks/Write spec.md']);
	});

	it('commands are offered only when a base is the active tab', async function () {
		await obsidianPage.openFile('Projects/Apollo.md');
		const offered = await browser.executeObsidian(({ app }, id) => {
			const cmds = (app as unknown as { commands: { findCommand(id: string): { checkCallback?: (c: boolean) => boolean } | undefined } }).commands;
			return ['new-from-template', 'set-up-base'].map((c) => cmds.findCommand(`${id}:${c}`)?.checkCallback?.(true) ?? null);
		}, pluginId);
		expect(offered).toEqual([false, false]);
	});
});
