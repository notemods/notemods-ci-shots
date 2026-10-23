import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

type Mode = 'live' | 'source';
let opened = 0;

/** Opens a new note with `doc`, in Live Preview or Source mode, with the cursor at the end and the focus in the editor. */
async function open(doc: string, mode: Mode = 'live', settings: { enabled?: boolean; lineBreakStyle?: 'newline' | 'spaces' | 'html' } = {}): Promise<string> {
	const path = `Enter ${++opened}.md`;
	await browser.executeObsidian(async ({ plugins }, s) => {
		const p = plugins.paragraphEnter;
		p.settings.enabled = s.enabled ?? true;
		p.settings.lineBreakStyle = s.lineBreakStyle ?? 'newline';
		await p.saveSettings();
		p.refreshStatus();
	}, settings);
	await obsidianPage.write(path, doc);
	await obsidianPage.openFile(path);
	await browser.executeObsidian(async ({ app, obsidian }, source) => {
		const leaf = app.workspace.getMostRecentLeaf()!;
		const old = leaf.getViewState();
		await leaf.setViewState({ ...old, state: { ...(old.state as Record<string, unknown>), mode: 'source', source } });
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		view.editor.focus();
		const last = view.editor.lastLine();
		view.editor.setCursor({ line: last, ch: view.editor.getLine(last).length });
	}, mode === 'source');
	await browser.waitUntil(async () => (await source()) === doc, { timeout: 10000, interval: 50, timeoutMsg: `The note did not open with ${JSON.stringify(doc)}` });
	return path;
}
async function source(): Promise<string | null> {
	return browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor.getValue() ?? null);
}
async function cursor(): Promise<{ line: number; ch: number }> {
	return browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getCursor());
}
async function waitSource(text: string, why = ''): Promise<void> {
	await browser.waitUntil(async () => (await source()) === text, { timeout: 10000, interval: 50, timeoutMsg: `Expected ${JSON.stringify(text)} ${why}, got ${JSON.stringify(await source())}` });
}
async function type(text: string): Promise<void> {
	for (const ch of text) await browser.keys(ch);
}

for (const mode of ['live', 'source'] as const) {
	describe(`Enter in ${mode === 'live' ? 'Live Preview' : 'Source mode'}`, function () {
		it('typing One, Enter, Two gives two paragraphs in Reading view', async function () {
			await open('', mode);
			await type('One');
			await browser.keys('Enter');
			await type('Two');
			await waitSource('One\n\nTwo');
			const paragraphs = await browser.executeObsidian(async ({ app, obsidian }) => {
				const leaf = app.workspace.getMostRecentLeaf()!;
				const old = leaf.getViewState();
				await leaf.setViewState({ ...old, state: { ...(old.state as Record<string, unknown>), mode: 'preview' } });
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
				for (let i = 0; i < 100; i++) {
					const ps = Array.from(view.containerEl.querySelectorAll('.markdown-reading-view p')).map((p) => p.textContent ?? '');
					if (ps.length >= 2) return ps;
					await new Promise((r) => setTimeout(r, 50));
				}
				return Array.from(view.containerEl.querySelectorAll('.markdown-reading-view p')).map((p) => p.textContent ?? '');
			});
			expect(paragraphs).toEqual(['One', 'Two']);
		});

		it('Enter in the middle of a word splits the paragraph', async function () {
			await open('Hello', mode);
			await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setCursor({ line: 0, ch: 3 }));
			await browser.keys('Enter');
			await waitSource('Hel\n\nlo');
			expect(await cursor()).toEqual({ line: 2, ch: 0 });
		});

		it('Enter before one empty line and more text opens a separate paragraph', async function () {
			await open('Hello\n\nNext', mode);
			await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setCursor({ line: 0, ch: 5 }));
			await browser.keys('Enter');
			await waitSource('Hello\n\n\n\nNext');
			expect(await cursor()).toEqual({ line: 2, ch: 0 });
			await type('New');
			await waitSource('Hello\n\nNew\n\nNext');
		});

		it('Enter at the end of a soft-wrapped line splits the paragraph', async function () {
			await open('One\nTwo', mode);
			await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.setCursor({ line: 0, ch: 3 }));
			await browser.keys('Enter');
			await waitSource('One\n\nTwo');
			expect(await cursor()).toEqual({ line: 2, ch: 0 });
		});

		it('Enter in a list continues the list as core does', async function () {
			await open('- item', mode);
			await browser.keys('Enter');
			await waitSource('- item\n- ', 'after Enter in a list');
			await type('next');
			await waitSource('- item\n- next');
		});

		it('Enter in a task, a quote, a heading and a code block keeps the default', async function () {
			await open('- [ ] task', mode);
			await browser.keys('Enter');
			await waitSource('- [ ] task\n- [ ] ', 'after Enter in a task');
			await open('# Head', mode);
			await browser.keys('Enter');
			await waitSource('# Head\n', 'after Enter in a heading');
			await open('```\ncode', mode);
			await browser.keys('Enter');
			await waitSource('```\ncode\n', 'after Enter in a code block');
			await open('> quote', mode);
			await browser.keys('Enter');
			await browser.waitUntil(async () => (await source())?.startsWith('> quote\n') === true && !(await source())!.startsWith('> quote\n\n'), { timeout: 10000, interval: 50, timeoutMsg: 'Enter in a quote did not keep the default' });
		});

		it('Shift+Enter inserts the chosen line break style', async function () {
			await open('Hello', mode, { lineBreakStyle: 'html' });
			await browser.keys(['Shift', 'Enter']);
			await waitSource('Hello<br>\n');
			await open('Hello', mode, { lineBreakStyle: 'spaces' });
			await browser.keys(['Shift', 'Enter']);
			await waitSource('Hello  \n');
		});
	});
}

describe('Enter with the editor around it', function () {
	it('one Undo removes the paragraph break as one step', async function () {
		await open('');
		await type('Hello');
		await browser.keys('Enter');
		await waitSource('Hello\n\n');
		const mod = await browser.executeObsidian(({ obsidian }) => (obsidian.Platform.isMacOS ? 'Meta' : 'Control'));
		await browser.keys([mod, 'z']);
		await waitSource('Hello', 'after one Undo');
		expect(await cursor()).toEqual({ line: 0, ch: 5 });
	});

	it('the link suggestion popup still accepts with Enter', async function () {
		await open('See ');
		await type('[[Targ');
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.suggestion-container .suggestion-item').length > 0), { timeout: 10000, interval: 50, timeoutMsg: 'The link suggestion did not open' });
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await source())?.includes('[[Target]]') === true, { timeout: 10000, interval: 50, timeoutMsg: 'Enter did not accept the suggestion' });
		expect(await source()).not.toContain('\n');
	});

	it('the toggle command and the status bar mark switch the mode', async function () {
		await open('Hello');
		await browser.executeObsidianCommand(`${pluginId}:toggle`);
		expect(await browser.executeObsidian(({ plugins }) => plugins.paragraphEnter.settings.enabled)).toBe(false);
		await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.focus());
		await browser.keys('Enter');
		await waitSource('Hello\n', 'with the mode off');
		await browser.execute(() => (document.querySelector('.status-bar .paragraph-enter-status') as HTMLElement).click());
		await browser.waitUntil(async () => browser.executeObsidian(({ plugins }) => plugins.paragraphEnter.settings.enabled), { timeout: 5000, interval: 50, timeoutMsg: 'The status bar click did not turn the mode on' });
	});

	it('Insert line break uses the chosen style', async function () {
		await open('Hello', 'live', { lineBreakStyle: 'spaces' });
		await browser.executeObsidianCommand(`${pluginId}:insert-line-break`);
		await waitSource('Hello  \n');
	});

	it('Enter during a composition is left to the editor: the result equals the result with the plugin off', async function () {
		const run = async (enabled: boolean) => {
			await open('Hello', 'live', { enabled });
			return browser.executeObsidian(async ({ app, obsidian }) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
				const content = view.containerEl.querySelector('.cm-content')!;
				content.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
				content.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ka', bubbles: true }));
				content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
				content.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true }));
				await new Promise((r) => setTimeout(r, 300));
				return view.editor.getValue();
			});
		};
		const core = await run(false);
		const withPlugin = await run(true);
		expect(withPlugin).toBe(core);
		expect(withPlugin).not.toBe('Hello\n\n');
	});
});

describe('Enter in a Live Preview table', function () {
	it('moves to the next row and writes no <br>', async function () {
		await browser.executeObsidian(async ({ plugins }) => { plugins.paragraphEnter.settings.enabled = true; await plugins.paragraphEnter.saveSettings(); });
		await obsidianPage.write('Table.md', '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter');
		await obsidianPage.openFile('Table.md');
		await browser.executeObsidian(async ({ app, obsidian }) => {
			const leaf = app.workspace.getMostRecentLeaf()!;
			const old = leaf.getViewState();
			await leaf.setViewState({ ...old, state: { ...(old.state as Record<string, unknown>), mode: 'source', source: false } });
			const e = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			e.focus();
			e.setCursor({ line: e.lastLine(), ch: e.getLine(e.lastLine()).length });
		});
		const header = await browser.$('.workspace-leaf.mod-active .cm-table-widget th');
		await header.waitForExist({ timeout: 10000 });
		const before = (await source()) ?? '';
		await header.click();
		await browser.waitUntil(async () => browser.execute(() => !!document.activeElement?.closest('.table-cell-wrapper') && !!document.activeElement?.closest('th')), { timeout: 10000, interval: 50, timeoutMsg: 'The header cell editor did not open' });
		await browser.keys('End');
		await browser.keys('Enter');
		await browser.waitUntil(async () => browser.execute(() => !!document.activeElement?.closest('.table-cell-wrapper') && !!document.activeElement?.closest('td')), { timeout: 10000, interval: 50, timeoutMsg: `Enter did not move to the next row; source ${JSON.stringify(await source())}` });
		const after = (await source()) ?? '';
		expect(after).not.toContain('<br>');
		expect(after.split('\n')[0]).toBe(before.split('\n')[0]);
		expect(after.split('\n').length).toBe(before.split('\n').length);
	});
});
