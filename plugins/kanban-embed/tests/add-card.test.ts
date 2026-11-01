// s1101 FIX item 3: "Add a card" checks the board file and lets the user pick the board.
// Defects from qa/known-issues-evidence.md (kanban-embed 1 and 2): the add write had no check of the lane,
// and with several boards the card always went to the first board.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownRenderer } from 'obsidian-test-mocks/obsidian';

const state = vi.hoisted(() => ({ pro: true }));
vi.mock('../src/pro', async (orig) => {
	const real = await orig<typeof import('../src/pro')>();
	return { ...real, isPro: () => state.pro, proNotice: vi.fn() };
});

import KanbanEmbedPlugin from '../src/main';
import { applyEdit } from '../src/board';
import { BoardEmbed } from '../src/view';
import manifest from '../manifest.json';

const FM = '---\nkanban-plugin: board\n---\n\n';

async function setup(files: Record<string, string>, source: string) {
	const app = App.createConfigured__({ files });
	const plugin = new KanbanEmbedPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async () => {});
	const el = document.createElement('div');
	document.body.appendChild(el);
	const embed = new BoardEmbed(plugin, el, source, 'Note.md');
	plugin.embeds.add(embed);
	embed.load();
	await embed.draw();
	const read = (p: string) => app.vault.read(app.vault.getFileByPath(p)!);
	const write = (p: string, md: string) => app.vault.modify(app.vault.getFileByPath(p)!, md);
	return { app, plugin, el, embed, read, write };
}

/** Opens the add field of a lane and returns the field and the form around it. */
function openAdd(el: HTMLElement, lane: string) {
	const laneEl = el.querySelector<HTMLElement>(`.kanban-embed-lane[data-lane="${lane}"]`)!;
	laneEl.querySelector<HTMLButtonElement>('.kanban-embed-add')!.click();
	const input = laneEl.querySelector<HTMLInputElement>('.kanban-embed-add-input')!;
	return { laneEl, input };
}

function enter(input: HTMLInputElement, text: string) {
	input.value = text;
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

beforeEach(() => {
	state.pro = true;
});
afterEach(() => {
	document.body.empty();
	vi.restoreAllMocks();
});

describe('Add a card: check of the board file', () => {
	it('adds the card to the lane that the user saw when a lane was put before it while the field was open', async () => {
		const { el, read, write } = await setup({ 'Board.md': `${FM}## Todo\n- [ ] a\n\n## Done\n- [ ] b\n` }, 'board: [[Board]]');
		const { input } = openAdd(el, 'Done');
		// Kanban (or sync) changes the file while the user types: a new lane "Doing" comes before "Done".
		await write('Board.md', `${FM}## Todo\n- [ ] a\n\n## Doing\n- [ ] x\n\n## Done\n- [ ] b\n`);
		enter(input, 'new card');
		await vi.waitFor(async () => expect(await read('Board.md')).toContain('new card'));
		expect(await read('Board.md')).toBe(`${FM}## Todo\n- [ ] a\n\n## Doing\n- [ ] x\n\n## Done\n- [ ] b\n- [ ] new card\n`);
	});

	it('does not write when the lane is gone, and says why', async () => {
		const { el, read, write, plugin } = await setup({ 'Board.md': `${FM}## Todo\n- [ ] a\n\n## Done\n- [ ] b\n` }, 'board: [[Board]]');
		const edit = vi.spyOn(plugin, 'edit');
		const { input } = openAdd(el, 'Done');
		const changed = `${FM}## Todo\n- [ ] a\n\n## Archive later\n- [ ] b\n`;
		await write('Board.md', changed);
		enter(input, 'new card');
		await vi.waitFor(() => expect(edit).toHaveBeenCalled());
		expect(await edit.mock.results[0]!.value).toBe(false);
		expect(await read('Board.md')).toBe(changed);
	});

	it('applyEdit add: the lane title check finds the lane, or gives stale', () => {
		const md = `${FM}## Todo\n\n## Doing\n\n## Done\n- [ ] b\n`;
		const r = applyEdit(md, { type: 'add', lane: 1, text: 'c', expect: 'Done' });
		expect(r.ok && r.md.endsWith('## Done\n- [ ] b\n- [ ] c\n')).toBe(true);
		expect(applyEdit(md, { type: 'add', lane: 1, text: 'c', expect: 'Review' })).toEqual({ ok: false, reason: 'stale' });
		const twice = `${FM}## Done\n\n## Todo\n\n## Done\n`;
		expect(applyEdit(twice, { type: 'add', lane: 1, text: 'c', expect: 'Done' })).toEqual({ ok: false, reason: 'stale' });
		const same = applyEdit(md, { type: 'add', lane: 2, text: 'c', expect: 'done' });
		expect(same.ok).toBe(true);
	});
});

describe('Add a card: several boards with the same lane', () => {
	const files = { 'Work.md': `${FM}## Todo\n- [ ] w\n`, 'Home.md': `${FM}## Todo\n- [ ] h\n` };

	it('lets the user pick the board, and writes the card to that board only', async () => {
		const { el, read } = await setup(files, 'boards: [[Work]], [[Home]]');
		const { laneEl, input } = openAdd(el, 'Todo');
		const select = laneEl.querySelector<HTMLSelectElement>('select.kanban-embed-add-board');
		expect(select).not.toBeNull();
		expect(Array.from(select!.options).map((o) => o.text)).toEqual(['Work', 'Home']);
		select!.value = select!.options[1]!.value;
		select!.dispatchEvent(new Event('change'));
		enter(input, 'buy milk');
		await vi.waitFor(async () => expect(await read('Home.md')).toContain('buy milk'));
		expect(await read('Home.md')).toBe(`${FM}## Todo\n- [ ] h\n- [ ] buy milk\n`);
		expect(await read('Work.md')).toBe(`${FM}## Todo\n- [ ] w\n`);
	});

	it('keeps the field open when the focus moves from the text field to the board list', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		try {
			const { el } = await setup(files, 'boards: [[Work]], [[Home]]');
			const { laneEl, input } = openAdd(el, 'Todo');
			const select = laneEl.querySelector<HTMLSelectElement>('select.kanban-embed-add-board')!;
			input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: select }));
			select.focus();
			vi.advanceTimersByTime(300);
			expect(laneEl.querySelector('.kanban-embed-add-input')).not.toBeNull();
			// The focus leaves the form: the field closes and the button comes back.
			select.blur();
			select.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
			vi.advanceTimersByTime(300);
			expect(laneEl.querySelector('.kanban-embed-add-form')).toBeNull();
			expect(laneEl.querySelector<HTMLElement>('.kanban-embed-add')!.style.display).not.toBe('none');
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows no board list when only one board has the lane', async () => {
		const { el } = await setup({ ...files, 'Home.md': `${FM}## Later\n` }, 'boards: [[Work]], [[Home]]');
		const { laneEl, input } = openAdd(el, 'Todo');
		expect(laneEl.querySelector('select.kanban-embed-add-board')).toBeNull();
		expect(input).not.toBeNull();
	});
});
