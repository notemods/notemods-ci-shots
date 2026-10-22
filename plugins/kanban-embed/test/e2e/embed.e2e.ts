import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { DIR, MOBILE, WEB, cardMenu, open, readFile, setPro, waitFor, writeFile } from './helpers';
import { lastNotice, pluginId } from './load';

// Real-app checks of the kanban-embed code block on the sample vault: two boards (Website redesign, 10 cards in
// 4 lanes, In progress over its limit of 3; Mobile app, 5 cards) and four notes that embed them.

describe(`${pluginId} in the real app`, function () {
	let web = '';
	let mobile = '';

	before(async function () {
		// The card menu is checked through the DOM, so use Obsidian menus, not the native menus of macOS.
		await browser.executeObsidian(({ app }) => (app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig('nativeMenus', false));
		await setPro(false);
		web = await readFile(WEB);
		mobile = await readFile(MOBILE);
	});

	afterEach(async function () {
		await setPro(false);
		await writeFile(WEB, web);
		await writeFile(MOBILE, mobile);
	});

	it('draws every lane of the board inside the note, with counts and the over-limit lane', async function () {
		await open('Website project.md');
		const s = await waitFor((x) => x.cards === 10, 'website board not drawn');
		expect(s.lanes).toEqual(['Backlog', 'In progress', 'Review', 'Done']);
		expect(s.counts).toEqual(['3', '4/3', '1', '2']);
		expect(s.over).toBe(1);
		expect(s.title).toBe('Website redesign');
	});

	it('works in Live Preview: a checkbox press writes the board and the board stays on screen', async function () {
		await obsidianPage.openFile(`${DIR}/Website project.md`);
		await browser.executeObsidian(async ({ app }) => {
			const leaf = app.workspace.getMostRecentLeaf();
			const state = leaf?.getViewState();
			if (leaf && state) await leaf.setViewState({ ...state, state: { ...state.state, mode: 'source', source: false } });
		});
		await waitFor((x) => x.cards === 10, 'board not drawn in Live Preview');
		const box = await browser.$('.workspace-leaf.mod-active .markdown-source-view .cm-editor .kanban-embed-card input.kanban-embed-check');
		await box.click();
		await browser.waitUntil(async () => (await readFile(WEB)).includes('- [x] Write the pricing page copy #content'), { timeout: 5000, timeoutMsg: 'Live Preview click did not write' });
		const s = await waitFor((x) => x.cards === 10, 'board left the screen after the click');
		expect(s.lanes.length).toBe(4);
	});

	it('shows only the picked lanes and hides done cards', async function () {
		await open('Standup.md');
		const s = await waitFor((x) => x.lanes.length === 2, 'standup not drawn');
		expect(s.lanes).toEqual(['In progress', 'Review']);
		expect(s.cards).toBe(5);
	});

	it('checks a card off in the board file and draws the change', async function () {
		await open('Website project.md');
		await waitFor((x) => x.cards === 10, 'website board not drawn');
		await browser.execute(() => {
			const cards = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-card')).filter((x) => x.offsetParent !== null);
			const card = cards.find((c) => c.textContent?.includes('Compress hero images'));
			card?.querySelector<HTMLInputElement>('input.kanban-embed-check')?.click();
		});
		await browser.waitUntil(async () => (await readFile(WEB)).includes('- [x] Compress hero images #perf'), { timeout: 5000, timeoutMsg: 'card not checked in the file' });
		expect((await readFile(WEB)).replace('- [x] Compress hero images', '- [ ] Compress hero images')).toBe(web);
	});

	it('redraws when the board file changes elsewhere', async function () {
		await open('Website project.md');
		const before = await waitFor((x) => x.cards === 10, 'website board not drawn');
		await writeFile(WEB, web.replace('## Review\n', '## Review\n\n- [ ] Added from the board #dev\n'));
		const s = await waitFor((x) => x.cards === 11 && x.draws > before.draws, 'no redraw after the change');
		expect(s.counts).toEqual(['3', '4/3', '2', '2']);
	});

	it('free: shows the first board only and refuses to move cards', async function () {
		await open('This week.md');
		const s = await waitFor((x) => x.lanes.length === 2, 'this week not drawn');
		expect(s.cards).toBe(5);
		expect(s.notes.join(' ')).toContain('Pro shows all 2 boards');
		await cardMenu('Cookie banner text', 'Move to Review');
		await browser.waitUntil(async () => (await lastNotice()).includes('Moving cards is a pro feature'), { timeout: 5000 });
		expect(await readFile(WEB)).toBe(web);
	});

	it('pro: merges two boards and moves a card with the Move to menu', async function () {
		await setPro(true);
		await open('This week.md');
		const s = await waitFor((x) => x.cards === 8, 'two boards not merged');
		expect(s.title).toBe('In flight across projects');
		expect(s.counts).toEqual(['6/3', '2']);
		await cardMenu('Cookie banner text', 'Move to Review');
		await browser.waitUntil(async () => /## Review\n\n- \[ \] Homepage layout #design\n\tCheck the mobile breakpoints first.\n- \[ \] Cookie banner text #legal/.test(await readFile(WEB)), {
			timeout: 5000,
			timeoutMsg: 'card not moved in the file',
		});
		expect(await readFile(MOBILE)).toBe(mobile);
	});

	it('pro: drag and drop moves a card to the top of another lane', async function () {
		await setPro(true);
		await open('Website project.md');
		await waitFor((x) => x.cards === 10, 'website board not drawn');
		await browser.execute(() => {
			const leaf = document.querySelector('.workspace-leaf.mod-active')!; // the hidden editor of the leaf can hold an older copy of the board
			const card = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-card')).filter((x) => x.offsetParent !== null).find((c) => c.textContent?.includes('Footer links audit'))!;
			const lane = Array.from(leaf.querySelectorAll<HTMLElement>('.kanban-embed-lane')).filter((x) => x.offsetParent !== null).find((l) => l.dataset.lane === 'Backlog')!;
			const list = lane.querySelector<HTMLElement>('.kanban-embed-cards')!;
			const top = list.getBoundingClientRect().top + 1;
			const dt = new DataTransfer();
			card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
			list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: top }));
			list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: top }));
			card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		});
		await browser.waitUntil(async () => (await readFile(WEB)).includes('## Backlog\n\n- [ ] Footer links audit #content\n- [ ] Write the pricing page copy'), {
			timeout: 5000,
			timeoutMsg: `drop did not move the card; notice: ${await lastNotice()}`,
		});
	});

	it('pro: adds a card at the end of a lane', async function () {
		await setPro(true);
		await open('Website project.md');
		await waitFor((x) => x.cards === 10, 'website board not drawn');
		await browser.execute(() => {
			const lane = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-lane')).filter((x) => x.offsetParent !== null).find((l) => l.dataset.lane === 'Backlog')!;
			lane.querySelector<HTMLElement>('.kanban-embed-add')!.click();
		});
		const input = await browser.$('.workspace-leaf.mod-active .markdown-reading-view .kanban-embed-add-input');
		await input.waitForDisplayed({ timeout: 5000 });
		await input.setValue('Order the launch cake');
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await readFile(WEB)).includes('- [ ] Compress hero images #perf\n- [ ] Order the launch cake\n'), { timeout: 5000, timeoutMsg: 'card not added' });
	});

	it('pro: the filter line keeps only matching cards', async function () {
		await setPro(true);
		await open('Design queue.md');
		const s = await waitFor((x) => x.cards === 4, 'filter not applied');
		expect(s.lanes).toEqual(['Backlog', 'In progress', 'Review', 'Done']);
		expect(s.notes).toEqual([]);
	});

	it('a card with a priority tag shows a priority class and chip', async function () {
		await open('Website project.md');
		const before = await waitFor((x) => x.cards === 10, 'website board not drawn');
		await writeFile(WEB, web.replace('## Backlog\n', '## Backlog\n\n- [ ] Rank the search terms #high\n'));
		await waitFor((x) => x.cards === 11 && x.draws > before.draws, 'no redraw after the change');
		// The note has a hidden view too, so read only the cards on screen, as the other tests do.
		const found = await browser.execute(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-card.mod-priority-high'))
				.filter((x) => x.offsetParent !== null)
				.map((c) => ({ text: c.textContent ?? '', chip: c.querySelector('.kanban-embed-chip.mod-priority-high')?.textContent ?? null })),
		);
		expect(found.length).toBe(1);
		expect(found[0]!.text.includes('Rank the search terms')).toBe(true);
		expect(found[0]!.chip).toBe('high');
		// The sample board has no other priority tag, so the other cards look as before.
		const marked = await browser.execute(
			() => Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-card[class*="mod-priority-"]')).filter((x) => x.offsetParent !== null).length,
		);
		expect(marked).toBe(1);
	});
});
