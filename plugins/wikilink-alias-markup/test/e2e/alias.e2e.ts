import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';
import { ACTIVE, LAST, NOTE, POST1_RAW, TARGET, activePath, collectErrors, hoverShowsPreview, isMobile, lines, marksIn, openNote, setCursor, setMode, takeErrors, waitForLine, writeNote } from './helpers';

// Real-app checks for the acceptance criteria A1 to A11 of the spec, on minAppVersion, the latest app and the latest
// app in mobile emulation (wdio.conf.mts).
describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await collectErrors();
		await writeNote('Target.md', TARGET);
		await writeNote('Alias.md', NOTE);
		await openNote();
	});

	it('A1 Live Preview: post 1 alias shows as inline code inside the link, backticks hidden', async function () {
		const marks = await marksIn('Post 1:');
		const core = await browser.execute((sel: string) => {
			const el = document.querySelector<HTMLElement>(`${sel} .markdown-source-view .cm-line .cm-inline-code:not(.wam-code)`);
			return el ? getComputedStyle(el).fontFamily : '';
		}, ACTIVE);
		expect(marks.map((m) => [m.cls, m.text, m.inLink])).toEqual([['code', 'obsidian', true]]);
		expect(core).not.toBe('');
		expect(marks[0]!.font).toBe(core);
	});

	it('A3 Live Preview: bold, italic, strikethrough and highlight', async function () {
		await waitForLine('Mixed:', 'Mixed: bold and italic and gone and marked end.');
		const marks = await marksIn('Mixed:');
		expect(marks.map((m) => [m.cls, m.text, m.inLink])).toEqual([
			['strong', 'bold', true],
			['em', 'italic', true],
			['del', 'gone', true],
			['mark', 'marked', true],
		]);
		expect(Number(marks[0]!.weight)).toBeGreaterThanOrEqual(600);
		expect(marks[1]!.style).toBe('italic');
		expect(marks[2]!.deco).toContain('line-through');
	});

	it('A9 Live Preview: links without alias and code blocks do not change', async function () {
		expect(await marksIn('Plain:')).toEqual([]);
		expect(await marksIn('[[Target|`raw`]]')).toEqual([]);
		expect((await lines()).filter((l) => l.startsWith('[[Target|'))).toEqual(['[[Target|`raw`]]']);
	});

	it('A8 Live Preview: a table cell and a nested callout show the markup', async function () {
		const info = await browser.execute((sel: string) => {
			const root = document.querySelector<HTMLElement>(`${sel} .markdown-source-view`)!;
			return {
				cell: root.querySelector('table a.internal-link code')?.textContent ?? '',
				deep: root.querySelector('.callout .callout a.internal-link em')?.textContent ?? '',
				deepCode: root.querySelector('.callout .callout a.internal-link code')?.textContent ?? '',
			};
		}, ACTIVE);
		expect(info).toEqual({ cell: 'cell', deep: 'deep', deepCode: 'code' });
	});

	it('A6 cursor in the link shows the source; arrow keys move one character at a time', async function () {
		// ch 20 is between "b" and "s" of obsidian.
		await setCursor(2, 20);
		await waitForLine('Post 1:', POST1_RAW);
		expect(await marksIn('Post 1:')).toEqual([]);
		for (let i = 0; i < 6; i++) await browser.keys('ArrowRight');
		const cursor = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getCursor());
		expect(cursor).toEqual({ line: 2, ch: 26 });
		await browser.keys('X');
		const text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getLine(2));
		expect(text).toBe('Post 1: [[Target|`obsidianX`]] here.');
		await browser.executeObsidian(({ app }, raw) => app.workspace.activeEditor?.editor?.setLine(2, raw), POST1_RAW);
		await setCursor(LAST, 0);
		await waitForLine('Post 1:', 'Post 1: obsidian here.');
	});

	it('A6 cursor entry from the end of the line with ArrowLeft: a typed key lands where the cursor is', async function () {
		await setCursor(2, POST1_RAW.length);
		const seen: string[] = [];
		for (let i = 0; i < 9; i++) {
			await browser.keys('ArrowLeft');
			seen.push((await lines()).find((l) => l.startsWith('Post 1:')) ?? '');
		}
		const cursor = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getCursor());
		console.info(`A6 line text while entering: ${JSON.stringify(seen)}; cursor ${JSON.stringify(cursor)}`);
		// Once the cursor is in the link, the plugin shows the source of the alias (the backticks). Core shows the whole
		// link source on desktop. In mobile emulation core keeps "[[Target|" hidden after arrow keys (CI run 41270253058).
		const mobile = await isMobile();
		expect(seen[seen.length - 1]).toBe(mobile ? 'Post 1: `obsidian` here.' : POST1_RAW);
		expect(await marksIn('Post 1:')).toEqual([]);
		await browser.keys('Y');
		const text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getLine(2));
		expect(text).toBe(POST1_RAW.slice(0, cursor!.ch) + 'Y' + POST1_RAW.slice(cursor!.ch));
		await browser.executeObsidian(({ app }, raw) => app.workspace.activeEditor?.editor?.setLine(2, raw), POST1_RAW);
		await setCursor(LAST, 0);
		await waitForLine('Post 1:', 'Post 1: obsidian here.');
	});

	it('A7 selection with the keyboard covers the raw source', async function () {
		await setCursor(2, 0);
		await browser.keys(['Shift', 'End']);
		const sel = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getSelection());
		expect(sel).toBe(POST1_RAW);
		await setCursor(LAST, 0);
		// A selection over lines 1 to 5 from the last line up: the selected text is the source text.
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setSelection({ line: 1, ch: 0 }, { line: 5, ch: 0 }));
		const multi = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getSelection());
		expect(multi).toBe(['', POST1_RAW, '', 'Mixed: [[Target|**bold** and *italic* and ~~gone~~ and ==marked==]] end.', ''].join('\n'));
		await setCursor(LAST, 0);
		await waitForLine('Post 1:', 'Post 1: obsidian here.');
	});

	it('A5 Live Preview: hover with Mod on the formatted alias shows the page preview', async function () {
		if (await isMobile()) this.skip();
		await setCursor(LAST, 0);
		// Control: a plain link with the same pointer events. The plugin must not do worse than core.
		const plain = await hoverShowsPreview(`${ACTIVE} .markdown-source-view .cm-line .cm-hmd-internal-link`);
		const formatted = await hoverShowsPreview(`${ACTIVE} .markdown-source-view .cm-line .wam-code`);
		expect({ plain, formatted }).toEqual({ plain: true, formatted: true });
	});

	it('A4 Live Preview: a click on the formatted alias opens the target', async function () {
		await setCursor(LAST, 0);
		await waitForLine('Post 1:', 'Post 1: obsidian here.');
		await browser.$(`${ACTIVE} .markdown-source-view .cm-line .wam-code`).click();
		await browser.waitUntil(async () => (await activePath()) === 'Target.md', { timeout: 5000, timeoutMsg: 'Target.md did not open from Live Preview' });
		await openNote();
	});

	it('A1 A3 A8 A9 Reading view: markup inside the core link elements', async function () {
		await setMode('preview');
		const sel = `${ACTIVE} .markdown-reading-view .markdown-preview-view`;
		await browser.waitUntil(async () => (await browser.execute((s: string) => document.querySelector(`${s} a.internal-link code`)?.textContent ?? '', sel)) === 'obsidian', { timeout: 10000, timeoutMsg: 'no code in a link in Reading view' });
		const info = await browser.execute((s: string) => {
			const root = document.querySelector<HTMLElement>(s)!;
			const linkOf = (text: string) => Array.from(root.querySelectorAll<HTMLElement>('a.internal-link')).find((a) => (a.textContent ?? '').includes(text));
			const post1 = linkOf('obsidian');
			const mixed = linkOf('bold');
			return {
				post1: post1?.innerHTML ?? '',
				href: post1?.getAttribute('data-href') ?? '',
				mixed: mixed?.innerHTML ?? '',
				plain: linkOf('Target')?.innerHTML ?? '',
				snake: linkOf('snake')?.innerHTML ?? '',
				codeBlock: root.querySelector('pre code')?.textContent?.trim() ?? '',
				cell: root.querySelector('table a.internal-link')?.innerHTML ?? '',
				deep: root.querySelector('.callout .callout a.internal-link')?.innerHTML ?? '',
				math: linkOf('gas')?.innerHTML ?? '',
			};
		}, sel);
		expect(info).toEqual({
			post1: '<code>obsidian</code>',
			href: 'Target',
			mixed: '<strong>bold</strong> and <em>italic</em> and <del>gone</del> and <mark>marked</mark>',
			plain: 'Target',
			snake: 'snake_case_note',
			codeBlock: '[[Target|`raw`]]',
			cell: '<code>cell</code>',
			deep: '<em>deep</em> <code>code</code>',
			math: '$NH_3$ gas',
		});
	});

	it('A5 Reading view: hover on the formatted alias shows the page preview', async function () {
		if (await isMobile()) this.skip();
		const sel = `${ACTIVE} .markdown-reading-view a.internal-link code`;
		expect(await hoverShowsPreview(sel)).toBe(true);
	});

	it('A4 Reading view: a click on the code inside the link opens the target', async function () {
		await browser.$(`${ACTIVE} .markdown-reading-view a.internal-link code`).click();
		await browser.waitUntil(async () => (await activePath()) === 'Target.md', { timeout: 5000, timeoutMsg: 'Target.md did not open from Reading view' });
		await openNote();
	});

	it('A10 typing in a 5,000-line note: the plugin adds less than 4 ms for each keystroke', async function () {
		const big = Array.from({ length: 5000 }, (_, i) => `Line ${i} [[Target|\`code ${i}\`]] and [[Target|**bold** *it*]] text.`).join('\n');
		await writeNote('Big.md', big);
		await obsidianPage.openFile('Big.md');
		await setMode('source');
		await setCursor(2500, 0);
		const measure = async (): Promise<number> =>
			browser.executeObsidian(async ({ app }) => {
				const editor = app.workspace.activeEditor!.editor!;
				const cm = (editor as unknown as { cm: { dispatch(t: unknown): void; state: { doc: { line(n: number): { from: number } } } } }).cm;
				const at = cm.state.doc.line(2501).from + 5;
				const t0 = performance.now();
				for (let i = 0; i < 200; i++) cm.dispatch({ changes: { from: at + i, insert: 'x' }, selection: { anchor: at + i + 1 }, userEvent: 'input.type' });
				const ms = (performance.now() - t0) / 200;
				cm.dispatch({ changes: { from: at, to: at + 200, insert: '' } });
				await new Promise((r) => setTimeout(r, 100));
				return ms;
			});
		// The first pass runs on a cold note (first parse, cold code). It warms up and is not counted. Then the test
		// measures without the plugin, then with it, so the plugin run is not the cold one.
		const warmup = await measure();
		await browser.executeObsidian(async ({ app }, id) => (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id), pluginId);
		await setCursor(2500, 0);
		const without = await measure();
		await browser.executeObsidian(async ({ app }, id) => (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id), pluginId);
		await setCursor(2500, 0);
		const withPlugin = await measure();
		console.info(`A10 warm-up pass ms per keystroke ${warmup.toFixed(2)}`);
		console.info(`A10 ms per keystroke: with plugin ${withPlugin.toFixed(2)}, without ${without.toFixed(2)}`);
		expect(withPlugin - without).toBeLessThan(4);
		// Real keys still type in the right place.
		await setCursor(2500, 4);
		await browser.keys(['Z', 'Z']);
		const line = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getLine(2500));
		expect(line).toBe('LineZZ 2500 [[Target|`code 2500`]] and [[Target|**bold** *it*]] text.');
	});

	it('A11 unload while Reading view renders a large note: no errors, no markup left; load again works', async function () {
		await takeErrors();
		const left = await browser.executeObsidian(async ({ app }, id) => {
			const plugins = (app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<boolean> } }).plugins;
			const leaf = app.workspace.getMostRecentLeaf()!;
			const s = leaf.getViewState();
			const switching = leaf.setViewState({ ...s, state: { ...s.state, mode: 'preview' } });
			await plugins.disablePlugin(id);
			await switching;
			await new Promise((r) => setTimeout(r, 1500));
			return leaf.view.containerEl.querySelectorAll('.wam-alias').length;
		}, pluginId);
		expect(left).toBe(0);
		await browser.executeObsidian(async ({ app }, id) => (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id), pluginId);
		await setMode('preview');
		const count = async (): Promise<string> =>
			browser.execute((sel: string) => {
				const v = document.querySelector(`${sel} .markdown-reading-view`);
				const shown = !!v && (v as HTMLElement).offsetParent !== null;
				return `${document.querySelectorAll(`${sel} .markdown-reading-view .wam-alias`).length} marked, ${document.querySelectorAll(`${sel} .markdown-reading-view a.internal-link`).length} links, reading view shown ${shown}`;
			}, ACTIVE);
		await browser.waitUntil(async () => !(await count()).startsWith('0 '), { timeout: 10000 }).catch(async () => {
			throw new Error(`no markup after load again: ${await count()}`);
		});
		expect(await takeErrors()).toEqual([]);
	});

	it('A11 unload with Live Preview open removes the markup from the editor', async function () {
		await openNote();
		await browser.executeObsidian(async ({ app }, id) => (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id), pluginId);
		await browser.waitUntil(async () => (await browser.execute((sel: string) => document.querySelectorAll(`${sel} .markdown-source-view .cm-line [class*="wam-"]`).length, ACTIVE)) === 0, { timeout: 5000, timeoutMsg: 'markup stays after unload' });
		await browser.executeObsidian(async ({ app }, id) => (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id), pluginId);
		await setCursor(LAST, 0);
		await waitForLine('Post 1:', 'Post 1: obsidian here.');
		expect(await takeErrors()).toEqual([]);
	});
});
