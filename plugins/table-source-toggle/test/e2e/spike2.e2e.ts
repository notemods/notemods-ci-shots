import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

// Kill gate spike 2: the only core path that shows a Live Preview table as text is a search highlight inside it.
// This probes the undocumented Editor.addHighlights route and what happens when core search clears it.
const NOTE = ['Intro line', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', 'End line'].join('\n');
const CLS = 'obsidian-search-match-highlight';

async function probe(): Promise<Record<string, unknown>> {
	return browser.executeObsidian(({ app }) => {
		const root = document.querySelector('.workspace-leaf.mod-active .markdown-source-view');
		const widgets = root ? root.querySelectorAll('.cm-table-widget').length : -1;
		const raw = root ? Array.from(root.querySelectorAll('.cm-content > .cm-line')).map((l) => l.textContent ?? '').filter((t) => t.startsWith('|')) : [];
		const ed = app.workspace.activeEditor?.editor;
		const c = ed ? ed.getCursor() : { line: -1, ch: -1 };
		const marks = root ? root.querySelectorAll('.' + 'obsidian-search-match-highlight').length : -1;
		return { widgets, raw, cursor: { line: c.line, ch: c.ch }, marks, inCell: !!document.activeElement?.closest('.cm-table-widget') };
	});
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spike2 table source via search highlight', function () {
	it('records the undocumented route', async function () {
		await obsidianPage.write('Spike2.md', NOTE);
		await obsidianPage.openFile('Spike2.md');
		await browser.executeObsidian(async ({ app }) => {
			const l = app.workspace.getLeaf(false);
			const s = l.getViewState();
			await l.setViewState({ ...s, state: { ...s.state, mode: 'source', source: false } });
			app.workspace.activeEditor?.editor?.setCursor({ line: 0, ch: 0 });
			app.workspace.activeEditor?.editor?.focus();
		});
		await pause(800);
		const out: Record<string, unknown> = {};
		const add = async () =>
			browser.executeObsidian(({ app }, cls) => {
				const ed = app.workspace.activeEditor?.editor as unknown as { addHighlights?: (r: unknown[], c: string, rm: boolean, x: boolean) => void };
				if (typeof ed?.addHighlights !== 'function') return 'no addHighlights';
				ed.addHighlights([{ from: { line: 2, ch: 9 }, to: { line: 3, ch: 0 } }], cls, false, false);
				return 'ok';
			}, CLS);
		out.q0 = await probe();
		out.q1add = await add();
		await pause(800);
		out.q1 = await probe();
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 3 });
			app.workspace.activeEditor?.editor?.focus();
		});
		await pause(500);
		await browser.keys(['Z']);
		await pause(800);
		out.q2typed = await probe();
		out.q2text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');
		await browser.executeObsidian(({ app }, cls) => {
			(app.workspace.activeEditor?.editor as unknown as { removeHighlights: (c: string) => void }).removeHighlights(cls);
		}, CLS);
		await pause(800);
		out.q3afterRemove = await probe();
		await browser.keys(['Q']);
		await pause(800);
		out.q3typed = await probe();
		out.q3text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');
		out.q4add = await add();
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 2 });
			app.workspace.activeEditor?.editor?.focus();
		});
		await pause(600);
		await browser.executeObsidianCommand('editor:open-search');
		await pause(800);
		out.q4searchOpen = await probe();
		await browser.keys(['Escape']);
		await pause(800);
		out.q4searchClosed = await probe();
		out.version = await browser.executeObsidian(() => navigator.userAgent);
		console.log('SPIKE2 ' + JSON.stringify(out));
	});
});
