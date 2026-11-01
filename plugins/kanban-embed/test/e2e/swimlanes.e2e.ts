import { browser, expect } from '@wdio/globals';
import { SPRINT, cardMenu, open, readFile, setPro, waitFor, writeFile } from './helpers';
import { lastNotice, pluginId } from './load';

// Swimlanes on the sample board "Team sprint" and its notes "Sprint by project" and "Sprint by owner": 9 cards in 4 lanes. Rows by the #project/ tag: launch 5, pricing 3,
// Unassigned 1. Rows by owner: Ana 4, Ben 4, Unassigned 1.
interface Row {
	row: string;
	count: number;
	collapsed: boolean;
	cells: Record<string, number>;
}

interface SwimState {
	rows: Row[];
	lanes: string[];
	laneCounts: string[];
	notes: string[];
	plainLanes: number;
}

/** Rows of the newest embed on screen in the active tab. */
async function swimState(): Promise<SwimState> {
	return browser.execute(() => {
		const leaf = document.querySelector('.workspace-leaf.mod-active')!;
		const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
		const embeds = Array.from(leaf.querySelectorAll('.kanban-embed')).filter(vis);
		const el = embeds[embeds.length - 1];
		const texts = (sel: string) => (el ? Array.from(el.querySelectorAll(sel)).map((x) => x.textContent?.trim() ?? '') : []);
		const rows = el
			? Array.from(el.querySelectorAll<HTMLElement>('.kanban-embed-swim-row')).map((r) => ({
					row: r.dataset.row ?? '',
					count: Number(r.querySelector('.kanban-embed-swim-row-count')?.textContent ?? '-1'),
					collapsed: r.classList.contains('is-collapsed'),
					cells: Object.fromEntries(Array.from(r.querySelectorAll<HTMLElement>('.kanban-embed-swim-cell')).map((c) => [c.dataset.lane ?? '', c.querySelectorAll('.kanban-embed-card').length])),
				}))
			: [];
		return {
			rows,
			lanes: texts('.kanban-embed-lane-title'),
			laneCounts: texts('.kanban-embed-lane-count'),
			notes: texts('.kanban-embed-note'),
			plainLanes: el ? el.querySelectorAll('.kanban-embed-lanes .kanban-embed-lane').length : 0,
		};
	});
}

async function waitRows(pred: (s: SwimState) => boolean, msg: string): Promise<SwimState> {
	let last: SwimState | null = null;
	await browser.waitUntil(
		async () => {
			last = await swimState();
			return pred(last);
		},
		{ timeout: 15000, interval: 250, timeoutMsg: `${msg}; last state ${JSON.stringify(last)}` },
	);
	return last!;
}

/** Drops the card that starts with `text` on the cell of `lane` in `row`, at the top of the cell or at its bottom. */
async function dropOnCell(text: string, lane: string, row: string, where: 'top' | 'bottom'): Promise<void> {
	await browser.execute(
		(t: string, l: string, r: string, w: string) => {
			const leaf = document.querySelector('.workspace-leaf.mod-active')!;
			const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
			const card = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-card')).filter(vis).find((c) => c.querySelector('.kanban-embed-card-body')?.textContent?.trim().startsWith(t))!;
			const cell = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-swim-cell')).filter(vis).find((c) => c.dataset.lane === l && c.dataset.row === r)!;
			const list = cell.querySelector<HTMLElement>('.kanban-embed-cards')!;
			const box = list.getBoundingClientRect();
			const y = w === 'top' ? box.top + 1 : box.bottom - 1;
			const dt = new DataTransfer();
			card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
			list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
			list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
			card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		},
		text,
		lane,
		row,
		where,
	);
}

const NOTE = 'Kanban Embed/Sprint by project.md';

describe(`${pluginId} swimlanes`, function () {
	let sprint = '';

	before(async function () {
		await browser.executeObsidian(({ app }) => (app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig('nativeMenus', false));
		await setPro(false);
		sprint = await readFile(SPRINT);
	});

	afterEach(async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { collapsedRows: unknown }; saveData(d: unknown): Promise<void> }> } }).plugins.plugins[id]!;
			p.settings.collapsedRows = {};
			await p.saveData(p.settings);
		}, pluginId);
		await setPro(false);
		await writeFile(SPRINT, sprint);
	});

	it('free: the swimlane line is locked without a sponsorship and the board shows as plain lanes', async function () {
		await open('Sprint by project.md');
		const s = await waitFor((x) => x.cards === 9, 'sprint board not drawn');
		expect(s.lanes).toEqual(['Backlog', 'In progress', 'Review', 'Done']);
		expect(s.notes.join(' ')).toContain('The swimlane line is a Pro feature');
		const sw = await swimState();
		expect(sw.rows).toEqual([]);
		expect(sw.plainLanes).toBe(4);
	});

	it('pro: draws one row for each project tag with the right card counts, lanes stay columns', async function () {
		await setPro(true);
		await open('Sprint by project.md');
		const s = await waitRows((x) => x.rows.length === 3, 'rows not drawn');
		expect(s.lanes).toEqual(['Backlog', 'In progress', 'Review', 'Done']);
		expect(s.laneCounts).toEqual(['3', '3/3', '2', '1']);
		expect(s.rows.map((r) => [r.row, r.count])).toEqual([['launch', 5], ['pricing', 3], ['Unassigned', 1]]);
		expect(s.rows[0]!.cells).toEqual({ Backlog: 2, 'In progress': 1, Review: 1, Done: 1 });
		expect(s.rows[1]!.cells).toEqual({ Backlog: 1, 'In progress': 1, Review: 1, Done: 0 });
		expect(s.rows[2]!.cells).toEqual({ Backlog: 0, 'In progress': 1, Review: 0, Done: 0 });
		expect(s.plainLanes).toBe(0);
		expect(s.notes).toEqual([]);
	});

	it('pro: a row by card field groups by owner', async function () {
		await setPro(true);
		await open('Sprint by owner.md');
		const s = await waitRows((x) => x.rows.length === 3, 'owner rows not drawn');
		expect(s.rows.map((r) => [r.row, r.count])).toEqual([['Ana', 4], ['Ben', 4], ['Unassigned', 1]]);
	});

	it('pro: a row folds and unfolds, and the fold is kept in the plugin settings across redraws', async function () {
		await setPro(true);
		await open('Sprint by project.md');
		await waitRows((x) => x.rows.length === 3, 'rows not drawn');
		await browser.execute(() => {
			const leaf = document.querySelector('.workspace-leaf.mod-active')!;
			const row = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-swim-row')).filter((r) => r.offsetParent !== null).find((r) => r.dataset.row === 'pricing')!;
			row.querySelector<HTMLElement>('.kanban-embed-swim-row-head')!.click();
		});
		let s = await waitRows((x) => x.rows.find((r) => r.row === 'pricing')?.collapsed === true, 'row did not fold');
		expect(s.rows.filter((r) => r.collapsed).length).toBe(1);
		const shown = await browser.execute(() => {
			const leaf = document.querySelector('.workspace-leaf.mod-active')!;
			const cells = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-swim-row')).filter((r) => r.offsetParent !== null).find((r) => r.dataset.row === 'pricing')!.querySelector<HTMLElement>('.kanban-embed-swim-cells')!;
			return getComputedStyle(cells).display;
		});
		expect(shown).toBe('none');
		await browser.waitUntil(
			async () => browser.executeObsidian(({ app }, id) => JSON.stringify((app as unknown as { plugins: { plugins: Record<string, { settings: { collapsedRows: unknown } }> } }).plugins.plugins[id]!.settings.collapsedRows).includes('pricing'), pluginId),
			{ timeout: 5000, timeoutMsg: 'folded row not kept in the plugin settings' },
		);
		// A change of the board file draws the embed again from the saved state, not from the old elements.
		await writeFile(SPRINT, `${sprint}\n`);
		s = await waitRows((x) => x.rows.find((q) => q.row === 'pricing')?.collapsed === true && x.rows.length === 3, 'row not folded after the redraw');
		expect(s.rows.filter((q) => q.collapsed).length).toBe(1);
		await browser.execute(() => {
			const leaf = document.querySelector('.workspace-leaf.mod-active')!;
			const row = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-swim-row')).filter((q) => q.offsetParent !== null).find((q) => q.dataset.row === 'pricing')!;
			row.querySelector<HTMLElement>('.kanban-embed-swim-row-head')!.click();
		});
		s = await waitRows((x) => x.rows.every((q) => !q.collapsed), 'row did not unfold');
		expect(s.rows.length).toBe(3);
	});

	it('pro: dragging a card inside its row moves it to the other lane, in front of the next card of the row, and keeps the tag', async function () {
		await setPro(true);
		await open('Sprint by project.md');
		await waitRows((x) => x.rows.length === 3, 'rows not drawn');
		await dropOnCell('Plan the launch checklist', 'Review', 'launch', 'top');
		await browser.waitUntil(
			async () =>
				(await readFile(SPRINT)).includes(
					'## Review\n\n- [ ] Compare competitor plans #project/pricing owner:: Ben\n- [ ] Plan the launch checklist #project/launch owner:: Ana\n- [ ] Proofread the landing page #project/launch owner:: Ana\n',
				),
			{ timeout: 5000, timeoutMsg: `card not moved in the file; notice: ${await lastNotice()}` },
		);
		const after = await readFile(SPRINT);
		expect(after.replace('- [ ] Plan the launch checklist #project/launch owner:: Ana\n', '')).toBe(sprint.replace('- [ ] Plan the launch checklist #project/launch owner:: Ana\n', ''));
		const s = await waitRows((x) => x.rows[0]?.cells.Review === 2, 'row not redrawn');
		expect(s.rows[0]!.count).toBe(5);
	});

	it('pro: a drop in another row is refused and nothing is written', async function () {
		await setPro(true);
		await open('Sprint by project.md');
		await waitRows((x) => x.rows.length === 3, 'rows not drawn');
		await dropOnCell('Plan the launch checklist', 'Review', 'pricing', 'top');
		await browser.pause(800);
		expect(await readFile(SPRINT)).toBe(sprint);
	});

	it('pro: the Move to menu keeps the card in its row', async function () {
		await setPro(true);
		await open('Sprint by project.md');
		await waitRows((x) => x.rows.length === 3, 'rows not drawn');
		await cardMenu('Draft the pricing table', 'Move to Review');
		await browser.waitUntil(async () => (await readFile(SPRINT)).includes('- [ ] Proofread the landing page #project/launch owner:: Ana\n- [ ] Draft the pricing table #project/pricing owner:: Ben'), {
			timeout: 5000,
			timeoutMsg: 'card not moved',
		});
		const s = await waitRows((x) => x.rows[1]?.cells.Review === 2 && x.rows[1]?.cells.Backlog === 0, 'row not redrawn');
		expect(s.rows[1]!.count).toBe(3);
	});

	it('pro: a card added in a row cell gets the tag of the row', async function () {
		await setPro(true);
		await open('Sprint by project.md');
		await waitRows((x) => x.rows.length === 3, 'rows not drawn');
		await browser.execute(() => {
			const leaf = document.querySelector('.workspace-leaf.mod-active')!;
			const cell = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-swim-cell')).filter((c) => c.offsetParent !== null).find((c) => c.dataset.lane === 'Backlog' && c.dataset.row === 'pricing')!;
			cell.querySelector<HTMLElement>('.kanban-embed-add')!.click();
		});
		const input = await browser.$('.workspace-leaf.mod-active .markdown-reading-view .kanban-embed-add-input');
		await input.waitForDisplayed({ timeout: 5000 });
		await input.setValue('Update the FAQ');
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await readFile(SPRINT)).includes('- [ ] Write the release notes #project/launch owner:: Ben\n- [ ] Update the FAQ #project/pricing\n'), {
			timeout: 5000,
			timeoutMsg: 'card not added with the row tag',
		});
		const s = await waitRows((x) => x.rows[1]?.cells.Backlog === 2, 'added card not in the pricing row');
		expect(s.rows[1]!.count).toBe(4);
	});

	it('pro: a bad swimlane line shows a warning and the board still shows as lanes', async function () {
		await setPro(true);
		await open('Sprint by project.md');
		await waitRows((x) => x.rows.length === 3, 'rows not drawn');
		const note = await readFile(NOTE);
		try {
			await writeFile(NOTE, note.replace('swimlane: #project/', 'swimlane: owner'));
			const s = await waitFor((x) => x.cards === 9 && x.notes.some((n) => n.startsWith('swimlane must be')), 'warning not shown');
			expect(s.lanes.length).toBe(4);
			expect((await swimState()).rows).toEqual([]);
		} finally {
			await writeFile(NOTE, note);
		}
	});
});
