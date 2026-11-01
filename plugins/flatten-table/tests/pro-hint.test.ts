// s1101 FIX item 2: a free user who sets a Pro view option gets a hint and the shared Pro notice, not a silent drop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pro: false }));
const proNotice = vi.hoisted(() => vi.fn());
vi.mock('../src/pro', async (orig) => {
	const real = await orig<typeof import('../src/pro')>();
	return { ...real, isPro: () => state.pro, proNotice, proText: (lead: string) => `${lead} Sponsor on GitHub, then sign in from the plugin settings.` };
});

import { flatten } from '../src/flatten';
import { FlattenView } from '../src/view';

const notes = [{ path: 'A.md', frontmatter: { tasks: [{ owner: 'Ann', hours: 2 }, { owner: 'Ben', hours: 3 }] } }];

function makeView(config: Record<string, string>) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const plugin = { views: new Set(), settings: { debounceMs: 300 } };
	const view = new FlattenView({} as never, el, plugin as never);
	view.config.set('property', 'note.tasks');
	for (const [k, v] of Object.entries(config)) view.config.set(k, v);
	const draw = () => {
		const opts = { ...view.options(), property: 'tasks' };
		(view as never as { draw: (r: unknown, o: unknown) => void }).draw(flatten(notes, opts), opts);
	};
	return { view, el, draw };
}

const hint = (el: HTMLElement) => el.querySelector('.flatten-table-pro-hint')?.textContent ?? null;

beforeEach(() => {
	state.pro = false;
	proNotice.mockClear();
});
afterEach(() => document.body.empty());

describe('Pro view options for a free user', () => {
	it('names the ignored Group by column in the bar and shows the shared Pro notice', () => {
		const { el, draw } = makeView({ groupColumn: 'owner' });
		draw();
		expect(hint(el)).toBe('Group by column is a pro option. This view does not use it. Sponsor on GitHub, then sign in from the plugin settings.');
		expect(proNotice).toHaveBeenCalledTimes(1);
		expect(proNotice).toHaveBeenCalledWith('Group by column is a pro option. This view does not use it.');
	});

	it('names both ignored options in one sentence', () => {
		const { el, draw } = makeView({ groupColumn: 'owner', filterColumn: 'owner', filterValue: 'Ann' });
		draw();
		expect(hint(el)).toContain('Group by column and Filter column are pro options. This view does not use them.');
	});

	it('still ignores the option: all rows, no groups', () => {
		const { el, draw } = makeView({ groupColumn: 'owner', filterColumn: 'owner', filterValue: 'Ann' });
		draw();
		expect(el.querySelectorAll('tbody tr').length).toBe(2);
	});

	it('shows the notice one time for the same options, not on each redraw', () => {
		const { draw } = makeView({ filterColumn: 'owner' });
		draw();
		draw();
		expect(proNotice).toHaveBeenCalledTimes(1);
	});

	it('shows the notice again when the user clicks the hint', () => {
		const { el, draw } = makeView({ filterColumn: 'owner' });
		draw();
		(el.querySelector('.flatten-table-pro-hint') as HTMLElement).click();
		expect(proNotice).toHaveBeenCalledTimes(2);
	});

	it('gives no hint and no notice when no Pro option is set', () => {
		const { el, draw } = makeView({ filterValue: 'Ann' });
		draw();
		expect(hint(el)).toBeNull();
		expect(proNotice).not.toHaveBeenCalled();
	});

	it('gives no hint to a Pro user', () => {
		state.pro = true;
		const { el, draw } = makeView({ groupColumn: 'owner' });
		draw();
		expect(hint(el)).toBeNull();
		expect(proNotice).not.toHaveBeenCalled();
	});
});
