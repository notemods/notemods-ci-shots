// s1101 FIX item 2: a free user who sets a Pro view option gets a hint and the shared Pro notice, not a silent drop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pro: false }));
const proNotice = vi.hoisted(() => vi.fn());
vi.mock('../src/pro', async (orig) => {
	const real = await orig<typeof import('../src/pro')>();
	return { ...real, isPro: () => state.pro, proNotice, proText: (lead: string) => `${lead} Sponsor on GitHub, then sign in from the plugin settings.` };
});

import { RollupView } from '../src/view';
import { rollup } from '../src/table';

const notes = [{ path: 'Notes/a.md', markdown: '| Item | Owner | Cost |\n|---|---|---|\n| Spec | Ann | 3 |\n| Budget | Ben | 4 |\n' }];

function makeView(config: Record<string, string>) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const plugin = { views: new Set(), settings: { debounceMs: 300 } };
	const view = new RollupView({} as never, el, plugin as never);
	for (const [k, v] of Object.entries(config)) view.config.set(k, v);
	const draw = () => (view as never as { draw: (r: unknown, o: unknown) => void }).draw(rollup(notes, view.options()), view.options());
	return { view, el, draw };
}

const hint = (el: HTMLElement) => el.querySelector('.table-rollup-pro-hint')?.textContent ?? null;

beforeEach(() => {
	state.pro = false;
	proNotice.mockClear();
});
afterEach(() => document.body.empty());

describe('Pro view options for a free user', () => {
	it('names the ignored Summary row in the bar and shows the shared Pro notice', () => {
		const { el, draw } = makeView({ summary: 'sum' });
		draw();
		expect(hint(el)).toBe('Summary row is a pro option. This view does not use it. Sponsor on GitHub, then sign in from the plugin settings.');
		expect(proNotice).toHaveBeenCalledTimes(1);
		expect(proNotice).toHaveBeenCalledWith('Summary row is a pro option. This view does not use it.');
	});

	it('names all three ignored options in one sentence', () => {
		const { el, draw } = makeView({ summary: 'avg', groupColumn: 'Owner', filterColumn: 'Owner', filterValue: 'Ann' });
		draw();
		expect(hint(el)).toContain('Summary row, Group by column and Filter column are pro options. This view does not use them.');
		expect(proNotice).toHaveBeenCalledWith('Summary row, Group by column and Filter column are pro options. This view does not use them.');
	});

	it('still ignores the option: no summary row, no groups, no filter', () => {
		const { el, draw } = makeView({ summary: 'sum', groupColumn: 'Owner', filterColumn: 'Owner', filterValue: 'Ann' });
		draw();
		expect(el.querySelectorAll('tbody tr').length).toBe(2);
		expect(el.querySelector('tfoot')).toBeNull();
	});

	it('shows the notice one time for the same options, not on each redraw', () => {
		const { el, draw } = makeView({ groupColumn: 'Owner' });
		draw();
		draw();
		draw();
		expect(proNotice).toHaveBeenCalledTimes(1);
		expect(hint(el)).toContain('Group by column is a pro option.');
	});

	it('shows the notice again when the user clicks the hint', () => {
		const { el, draw } = makeView({ filterColumn: 'Owner' });
		draw();
		(el.querySelector('.table-rollup-pro-hint') as HTMLElement).click();
		expect(proNotice).toHaveBeenCalledTimes(2);
	});

	it('gives no hint and no notice when no Pro option is set (summary None counts as not set)', () => {
		const { el, draw } = makeView({ summary: 'none', filterValue: 'Ann' });
		draw();
		expect(hint(el)).toBeNull();
		expect(proNotice).not.toHaveBeenCalled();
	});

	it('gives no hint to a Pro user, and the options work', () => {
		state.pro = true;
		const { el, draw } = makeView({ summary: 'sum' });
		draw();
		expect(hint(el)).toBeNull();
		expect(proNotice).not.toHaveBeenCalled();
	});
});
