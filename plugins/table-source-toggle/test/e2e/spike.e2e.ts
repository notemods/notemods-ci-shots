import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

// Kill gate spike: does core Live Preview show the raw table text when the main editor selection is inside the table?
const NOTE = ['Intro line', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', 'End line'].join('\n');

interface Probe {
	widgets: number;
	raw: string[];
	cursor: { line: number; ch: number };
	inCell: boolean;
	version: string;
}

async function probe(): Promise<Probe> {
	return browser.executeObsidian(({ app }) => {
		const root = document.querySelector('.workspace-leaf.mod-active .markdown-source-view');
		const widgets = root ? root.querySelectorAll('.cm-table-widget').length : -1;
		const raw = root ? Array.from(root.querySelectorAll('.cm-content > .cm-line')).map((l) => l.textContent ?? '').filter((t) => t.startsWith('|')) : [];
		const ed = app.workspace.activeEditor?.editor;
		const c = ed ? ed.getCursor() : { line: -1, ch: -1 };
		const inCell = !!document.activeElement?.closest('.cm-table-widget');
		return { widgets, raw, cursor: { line: c.line, ch: c.ch }, inCell, version: (window as unknown as { electron?: unknown }).electron ? 'x' : String((app as unknown as { appVersion?: string }).appVersion ?? '') };
	});
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spike table source', function () {
	it('records core behavior', async function () {
		await obsidianPage.write('Spike.md', NOTE);
		await obsidianPage.openFile('Spike.md');
		await browser.executeObsidian(async ({ app }) => {
			const l = app.workspace.getLeaf(false);
			const s = l.getViewState();
			await l.setViewState({ ...s, state: { ...s.state, mode: 'source', source: false } });
			app.workspace.activeEditor?.editor?.setCursor({ line: 0, ch: 0 });
			app.workspace.activeEditor?.editor?.focus();
		});
		await pause(800);
		const out: Record<string, unknown> = {};
		out.p0 = await probe();
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 3 }));
		await pause(800);
		out.p1cursorInside = await probe();
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setSelection({ line: 1, ch: 0 }, { line: 6, ch: 2 }));
		await pause(800);
		out.p2selectionAcross = await probe();
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setSelection({ line: 2, ch: 2 }, { line: 2, ch: 3 }));
		await pause(800);
		out.p3selectionInside = await probe();
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setCursor({ line: 1, ch: 0 });
			app.workspace.activeEditor?.editor?.focus();
		});
		await pause(500);
		await browser.keys(['ArrowDown']);
		await pause(800);
		out.p4arrowDown = await probe();
		await browser.executeObsidian(({ app }) => {
			app.workspace.activeEditor?.editor?.setCursor({ line: 4, ch: 3 });
			app.workspace.activeEditor?.editor?.focus();
		});
		await pause(500);
		await browser.keys(['Z']);
		await pause(800);
		out.p5typeAfterCursorInside = await probe();
		out.p5text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');
		out.version = await browser.executeObsidian(({ app }) => String((app as unknown as { appVersion?: string }).appVersion ?? navigator.userAgent));
		console.log('SPIKE ' + JSON.stringify(out));
	});
});
