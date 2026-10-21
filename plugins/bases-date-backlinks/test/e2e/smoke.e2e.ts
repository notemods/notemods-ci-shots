import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

async function setMarkdownMode(path: string, mode: 'source' | 'preview'): Promise<void> {
	await browser.executeObsidian(async ({ app }, filePath, viewMode) => {
		await app.workspace.getMostRecentLeaf()!.setViewState({
			type: 'markdown',
			state: { file: filePath, mode: viewMode },
		});
	}, path, mode);
}

async function matchingNotes(): Promise<string[]> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return Array.from(view?.containerEl.querySelectorAll('.bases-date-backlinks-list a') ?? []).map((link) => link.textContent ?? '');
	});
}

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('inserts one shared Bases view and matches the daily note date', async function () {
		const dailyNote = 'Daily/2026-10-21.md';
		await obsidianPage.write('Research/Matching note.md', '---\ndate: 2026-10-21\n---\nMatching content.');
		await obsidianPage.write('Research/Next day.md', '---\ndate: 2026-10-22\n---\nNext-day content.');
		await obsidianPage.write(dailyNote, '# Wednesday, October 21\n');
		await obsidianPage.openFile(dailyNote);
		await setMarkdownMode(dailyNote, 'source');

		await browser.executeObsidianCommand(`${pluginId}:insert-date-backlinks-view`);
		await browser.waitUntil(async () => (await obsidianPage.read(dailyNote)).includes('![[Date Property Backlinks.base]]'), {
			timeout: 10000,
			timeoutMsg: 'the shared Base embed was not inserted',
		});
		const base = await obsidianPage.read('Date Property Backlinks.base');
		expect(base).toContain('matchProperty: note.date');
		expect(base).toContain('dailyNoteDate: file.name');

		await browser.executeObsidianCommand(`${pluginId}:insert-date-backlinks-view`);
		const savedText = await browser.executeObsidian(async ({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			await view.save();
			return view.editor.getValue();
		});
		expect(savedText.match(/!\[\[Date Property Backlinks\.base\]\]/g)).toHaveLength(1);
		expect(await obsidianPage.read(dailyNote)).toBe(savedText);
		expect((await obsidianPage.read(dailyNote)).match(/!\[\[Date Property Backlinks\.base\]\]/g)).toHaveLength(1);

		await setMarkdownMode(dailyNote, 'preview');
		await browser.waitUntil(async () => JSON.stringify(await matchingNotes()) === JSON.stringify(['Matching note']), {
			timeout: 15000,
			timeoutMsg: 'the embedded view did not match the daily note date',
		});
		expect(await matchingNotes()).toEqual(['Matching note']);
	});
});

describe('daily setup and navigation regressions', function () {
	before(async () => {
		await browser.execute(() => {
			const state = window as unknown as { dateBacklinksErrors: string[] };
			state.dateBacklinksErrors = [];
			window.addEventListener('error', (event) => state.dateBacklinksErrors.push(event.message));
			window.addEventListener('unhandledrejection', (event) => state.dateBacklinksErrors.push(String(event.reason)));
			const original = console.error;
			console.error = (...args: unknown[]) => { state.dateBacklinksErrors.push(args.map(String).join(' ')); original(...args); };
		});
	});

	it('switches to another daily note and uses real internal links', async () => {
		await obsidianPage.write('Daily/2026-10-22.md', '# Thursday\n\n![[Date Property Backlinks.base]]\n');
		await obsidianPage.openFile('Daily/2026-10-22.md');
		await setMarkdownMode('Daily/2026-10-22.md', 'preview');
		await browser.waitUntil(async () => JSON.stringify(await matchingNotes()) === JSON.stringify(['Next day']), { timeout: 15000 });
		const row = await browser.executeObsidian(({ app, obsidian }) => {
			const el = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.containerEl;
			return { href: el.querySelector('.bases-date-backlinks-list a.internal-link')?.getAttribute('data-href'), label: el.querySelector('.bases-date-backlinks-property')?.textContent };
		});
		expect(row).toEqual({ href: 'Research/Next day.md', label: 'date' });
	});

	it('keeps each filename date in a split pane', async () => {
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.getLeaf('split').setViewState({ type: 'markdown', state: { file: 'Daily/2026-10-21.md', mode: 'preview' }, active: true });
		});
		await browser.waitUntil(async () => {
			const panes = await browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType('markdown').map((leaf) => ({
				path: (leaf.view as unknown as { file?: { path: string } }).file?.path,
				rows: Array.from(leaf.view.containerEl.querySelectorAll('.bases-date-backlinks-list a')).map((el) => el.textContent),
			})));
			return panes.some((pane) => pane.path === 'Daily/2026-10-21.md' && pane.rows.join() === 'Matching note') && panes.some((pane) => pane.path === 'Daily/2026-10-22.md' && pane.rows.join() === 'Next day');
		}, { timeout: 15000 });
		await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves.slice(1)) leaf.detach();
		});
	});

	it('previews and updates the configured template only once', async () => {
		await obsidianPage.write('Templates/Daily.md', '# {{date}}\n\nDaily plan.\n');
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.adapter.write(`${app.vault.configDir}/daily-notes.json`, JSON.stringify({ template: 'Templates/Daily', format: 'YYYY-MM-DD' }));
		});
		await browser.executeObsidianCommand(`${pluginId}:add-to-daily-template`);
		await browser.$('.modal .bases-date-backlinks-preview').waitForExist();
		expect(await browser.$('.bases-date-backlinks-preview').getText()).toContain('![[Date Property Backlinks.base]]');
		expect(await obsidianPage.read('Templates/Daily.md')).not.toContain('![[Date Property');
		await browser.$('button=Add view to template').click();
		await browser.waitUntil(async () => (await obsidianPage.read('Templates/Daily.md')).includes('![[Date Property Backlinks.base]]'), { timeout: 10000 });
		await browser.executeObsidianCommand(`${pluginId}:add-to-daily-template`);
		await browser.$('button=Already added').waitForExist();
		expect(await browser.$('button=Already added').isEnabled()).toBe(false);
		expect((await obsidianPage.read('Templates/Daily.md')).match(/!\[\[Date Property Backlinks\.base\]\]/g)).toHaveLength(1);
		await browser.keys('Escape');
	});

	it('automatically shows existing daily notes without changing their text', async () => {
		const path = 'Daily/2026-10-23.md';
		const original = '# Existing daily note\n';
		await obsidianPage.write('Research/Automatic match.md', '---\ndate: 2026-10-23\n---\nAn existing note.');
		await obsidianPage.write(path, original);
		await obsidianPage.openFile(path);
		await setMarkdownMode(path, 'preview');
		await browser.executeObsidian(async ({ app }, id) => {
			const plugins = (app as unknown as { plugins: { plugins: Record<string, { setAutoShow(value: boolean): Promise<void> }> } }).plugins;
			await plugins.plugins[id]!.setAutoShow(true);
		}, pluginId);
		await browser.waitUntil(async () => (await matchingNotes()).includes('Automatic match'), { timeout: 15000 });
		expect(await browser.$$('.bases-date-backlinks-auto')).toHaveLength(1);
		await browser.waitUntil(async () => browser.execute(() => {
			const el = document.querySelector('.bases-date-backlinks-auto');
			const rect = el?.getBoundingClientRect();
			return !!rect && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
		}), { timeout: 10000, timeoutMsg: 'automatic view must be visible in the note viewport' });
		expect(await obsidianPage.read(path)).toBe(original);
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { plugins: Record<string, { setAutoShow(value: boolean): Promise<void> }> } }).plugins.plugins[id]!.setAutoShow(false);
		}, pluginId);
		await browser.$('.bases-date-backlinks-auto').waitForExist({ reverse: true });
	});

	it('preserves a user file at the generated Base path', async () => {
		const path = 'Date Property Backlinks.base';
		const original = await obsidianPage.read(path);
		const userText = 'views:\n  - type: table\n    name: My existing Base\n';
		try {
			await obsidianPage.write(path, userText);
			await obsidianPage.write('Daily/2026-10-24.md', '# No embed\n');
			await obsidianPage.openFile('Daily/2026-10-24.md');
			await setMarkdownMode('Daily/2026-10-24.md', 'source');
			await browser.executeObsidianCommand(`${pluginId}:insert-date-backlinks-view`);
			await browser.waitUntil(async () => browser.execute(() => Array.from(document.querySelectorAll('.notice')).some((notice) => notice.textContent?.includes('already exists'))), { timeout: 5000 });
			expect(await obsidianPage.read(path)).toBe(userText);
			expect(await obsidianPage.read('Daily/2026-10-24.md')).toBe('# No embed\n');
		} finally { await obsidianPage.write(path, original); }
	});

	after(async () => {
		const errors = await browser.execute(() => (window as unknown as { dateBacklinksErrors: string[] }).dateBacklinksErrors);
		expect(errors).toEqual([]);
	});
});
