import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { readFileSync } from 'node:fs';
import { pluginId, reloadPlugin } from './load';

// Real Obsidian: a click on a switch rewrites the .base file and the open base shows the filtered rows.
// Sample data: 10 notes in Tasks/ (status todo 5, doing 2, done 3; area work 5, home 4, learning 1).
const DIR = 'Bases Filter Switches';

interface BarState {
	rows: number;
	chips: string[];
	more: string;
	quick: string[];
}

/** Rows of the first visible Bases table in the active tab (in an embed when embed is true) and the bar under it. */
async function state(embed: boolean): Promise<BarState | null> {
	return browser.execute((inEmbed: boolean) => {
		const leaf = document.querySelector('.workspace-leaf.mod-active');
		const scopes = Array.from(leaf?.querySelectorAll<HTMLElement>(inEmbed ? '.internal-embed.bases-embed' : '.view-content') ?? []).filter((e) => e.offsetParent !== null);
		const scope = scopes[0];
		const bar = scope?.querySelector('.fsw-bar');
		if (!scope || !bar) return null;
		return {
			rows: scope.querySelectorAll('.bases-tbody .bases-tr').length,
			chips: Array.from(bar.querySelectorAll('button')).map((b) => `${b.textContent ?? ''}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
			more: bar.querySelector('.fsw-more')?.textContent ?? '',
			quick: Array.from(bar.querySelectorAll('.fsw-quick-chip')).map((c) => c.textContent ?? ''),
		};
	}, embed);
}

async function waitRows(embed: boolean, rows: number, chip: string): Promise<BarState> {
	let last: BarState | null = null;
	await browser.waitUntil(
		async () => {
			last = await state(embed);
			return last !== null && last.rows === rows && last.chips.includes(chip);
		},
		{ timeout: 15000, interval: 250, timeoutMsg: `expected ${rows} rows and chip ${chip}` },
	);
	return last as unknown as BarState;
}

/** Waits until the scope shows this many rows and exactly these quick filter chips. */
async function waitQuick(embed: boolean, rows: number, quick: string[]): Promise<BarState> {
	let last: BarState | null = null;
	try {
		await browser.waitUntil(
			async () => {
				last = await state(embed);
				return last !== null && last.rows === rows && JSON.stringify(last.quick) === JSON.stringify(quick);
			},
			{ timeout: 15000, interval: 250 },
		);
	} catch {
		// The state, the notices and the base file make a failed run readable from the log alone.
		const notices = await browser.execute(() => Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? ''));
		throw new Error(`expected ${rows} rows and quick chips ${JSON.stringify(quick)}; got ${JSON.stringify(last)}, modal ${String(await modalOpen())}, notices ${JSON.stringify(notices)}, Tasks.base:\n${await baseText('Tasks.base')}`);
	}
	return last as unknown as BarState;
}

async function clickIn(embed: boolean, selector: string): Promise<void> {
	const scope = embed ? '.workspace-leaf.mod-active .internal-embed.bases-embed' : '.workspace-leaf.mod-active .view-content';
	for (const el of await browser.$$(`${scope} .fsw-bar ${selector}`)) {
		if (await el.isDisplayed()) {
			await el.click();
			return;
		}
	}
	throw new Error(`no ${selector}`);
}

const modalOpen = (): Promise<boolean> => browser.execute(() => document.querySelector('.modal-container .fsw-quick-modal') !== null);

async function click(embed: boolean, label: string): Promise<void> {
	const scope = embed ? '.workspace-leaf.mod-active .internal-embed.bases-embed' : '.workspace-leaf.mod-active .view-content';
	const chips = await browser.$$(`${scope} .fsw-bar button`);
	for (const c of chips) {
		if ((await c.getText()) === label && (await c.isDisplayed())) {
			await c.click();
			return;
		}
	}
	throw new Error(`no chip ${label}`);
}

async function baseText(name: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, path) => app.vault.adapter.read(path), `${DIR}/${name}`);
}

async function signInPro(): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, id) => {
		interface Pro {
			opts: { http: unknown };
			refreshNow(): Promise<void>;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro; isPro(): boolean }> } }).plugins.plugins[id]!;
		const tier = { name: '$5 a month', monthlyPriceInCents: 500 };
		const json = { data: { viewer: { login: 'e2e' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier } } } };
		p.pro.opts.http = () => Promise.resolve({ status: 200, json });
		app.secretStorage.setSecret(`${id}-github-token`, `gho_${'0'.repeat(36)}`);
		await p.pro.refreshNow();
		return p.isPro();
	}, pluginId);
}

const DONE = ['Book the dentist', 'Paint the fence', 'Ship version 2'];
const NOT_DONE = ['Clean the garage', 'Fix the login bug', 'Read the Bases docs', 'Plan the team offsite', 'Renew the passport', 'Review the budget', 'Write the launch post'];

/** True when a row text holds the note name (the name cell can show the extension too). */
const has = (rows: string[], name: string): boolean => rows.some((r) => r.includes(name));

interface ExcludedView {
	names: string[];
	headers: string[];
	mark: string;
	outline: boolean;
	pressed: boolean;
	enabled: string[];
	chips: string[];
}

/** The rows, column names, mark and enabled buttons of the first visible base in the active tab. */
async function excludedView(embed: boolean): Promise<ExcludedView> {
	return browser.execute((inEmbed: boolean) => {
		const leaf = document.querySelector('.workspace-leaf.mod-active');
		const scope = Array.from(leaf?.querySelectorAll<HTMLElement>(inEmbed ? '.internal-embed.bases-embed' : '.view-content') ?? []).find((e) => e.offsetParent !== null);
		const bar = scope?.querySelector('.fsw-bar');
		const label = (b: Element): string => `${b.textContent ?? ''}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`;
		const buttons = Array.from(bar?.querySelectorAll<HTMLButtonElement>('button') ?? []);
		return {
			names: Array.from(scope?.querySelectorAll('.bases-tbody .bases-tr') ?? []).map((r) => r.textContent?.trim() ?? ''),
			headers: Array.from(scope?.querySelectorAll('.bases-thead .bases-table-header-name') ?? []).map((h) => h.textContent?.trim() ?? ''),
			mark: bar?.querySelector('.fsw-excluded-mark')?.textContent ?? '',
			outline: bar?.parentElement?.classList.contains('fsw-showing-excluded') ?? false,
			pressed: bar?.querySelector('.fsw-excluded')?.getAttribute('aria-pressed') === 'true',
			enabled: buttons.filter((b) => !b.disabled).map(label).filter((t) => t.startsWith('Excluded')),
			chips: buttons.map(label),
		};
	}, embed);
}

async function waitExcluded(embed: boolean, on: boolean): Promise<ExcludedView> {
	let last: ExcludedView | null = null;
	try {
		await browser.waitUntil(
			async () => {
				last = await excludedView(embed);
				// On: the rows changed to the excluded set (no done task when Done was on, or rows outside Tasks).
				return last.pressed === on && last.names.length > 0 && (on ? last.mark !== '' && !has(last.names, 'Book the dentist') : last.mark === '');
			},
			{ timeout: 15000, interval: 250 },
		);
	} catch {
		throw new Error(`Excluded ${String(on)} not reached; got ${JSON.stringify(last)}, Tasks.base:\n${await baseText('Tasks.base')}`);
	}
	return last as unknown as ExcludedView;
}

describe('Bases Filter Switches', function () {
	// resetVault() would also drop the plugin folder of this vault, so only the two bases a test edits are restored.
	beforeEach(async function () {
		for (const name of ['Tasks.base', 'Many.base']) {
			const text = readFileSync(`test/e2e/vault/${DIR}/${name}`, 'utf8');
			await browser.executeObsidian(async ({ app }, path, t) => app.vault.adapter.write(path, t), `${DIR}/${name}`, text);
		}
	});

	it('loads, and turns off and on without errors', async function () {
		const s = await reloadPlugin(pluginId);
		expect(s.enabled).toBe(true);
		expect(s.reloaded).toBe(true);
		expect(s.errors).toEqual([]);
	});

	it('filters an open base tab: Todo, Todo and Doing, then All', async function () {
		await obsidianPage.openFile(`${DIR}/Tasks.base`);
		const first = await waitRows(false, 10, 'All*');
		expect(first.chips).toEqual(['Pause', 'All*', 'Todo', 'Doing', 'Done', '+', '', 'Excluded']);
		await click(false, 'Todo');
		await waitRows(false, 5, 'Todo*');
		await click(false, 'Doing');
		await waitRows(false, 7, 'Doing*');
		expect(await baseText('Tasks.base')).toContain('    - or:\n        - status == "todo"\n        - status == "doing"\n');
		expect(await baseText('Tasks.base')).toMatch(/^# Task board/);
		await click(false, 'All');
		await waitRows(false, 10, 'All*');
	});

	it('filters a base embedded in a note', async function () {
		await obsidianPage.openFile(`${DIR}/Weekly review.md`);
		await waitRows(true, 10, 'All*');
		await click(true, 'Done');
		await waitRows(true, 3, 'Done*');
	});

	it('works from the keyboard: arrow keys move, Enter toggles', async function () {
		await obsidianPage.openFile(`${DIR}/Tasks.base`);
		await waitRows(false, 10, 'All*');
		await browser.execute(() => document.querySelector<HTMLElement>('.workspace-leaf.mod-active .fsw-bar .fsw-chip:not(:disabled)')?.focus());
		await browser.keys(['ArrowRight', 'ArrowRight', 'ArrowRight']);
		const focused = await browser.execute(() => document.activeElement?.textContent ?? '');
		expect(focused).toBe('Done');
		await browser.keys(['Enter']);
		await waitRows(false, 3, 'Done*');
	});

	it('free: 3 switches of the first group, the rest counted as Pro', async function () {
		await obsidianPage.openFile(`${DIR}/Many.base`);
		const s = await waitRows(false, 10, 'All*');
		expect(s.chips).toEqual(['Pause', 'All*', 'Todo', 'Doing', 'Done', '+', '', 'Excluded']);
		expect(s.more).toBe('3 more with Pro');
	});

	it('free: pauses a selection, reopens the base and resumes the same filters', async function () {
		await obsidianPage.openFile(`${DIR}/Tasks.base`);
		await waitRows(false, 10, 'All*');
		await click(false, 'Todo');
		await waitRows(false, 5, 'Todo*');
		await click(false, 'Pause');
		await waitRows(false, 10, 'Resume*');
		expect(await baseText('Tasks.base')).toContain('paused:');
		await obsidianPage.openFile(`${DIR}/Weekly review.md`);
		await waitRows(true, 10, 'Resume*');
		await obsidianPage.openFile(`${DIR}/Tasks.base`);
		await waitRows(false, 10, 'Resume*');
		await click(false, 'Resume');
		await waitRows(false, 5, 'Todo*');
		expect(await baseText('Tasks.base')).not.toContain('paused:');
	});

	it('Pro: property values become switches and a preset command sets every group', async function () {
		expect(await signInPro()).toBe(true);
		await obsidianPage.openFile(`${DIR}/Many.base`);
		const s = await waitRows(false, 10, 'work');
		expect(s.chips).toEqual(['Pause', 'All*', 'Todo', 'Doing', 'Done', 'Waiting', 'Pause', 'High', 'Pause', 'All*', 'home', 'learning', 'work', 'Presets', '+', '', 'Excluded']);
		const ran = await browser.executeObsidian(({ app }) => {
			const cmds = (app as unknown as { commands: { commands: Record<string, { name: string }>; executeCommandById(id: string): boolean } }).commands;
			const id = Object.keys(cmds.commands).find((k) => cmds.commands[k]?.name.includes('Apply preset Open work to Many'));
			return id ? cmds.executeCommandById(id) : false;
		});
		expect(ran).toBe(true);
		await waitRows(false, 4, 'work*');
	});

	it('quick filter on a base tab with the keyboard only: area is work, Escape, then the chip removes it', async function () {
		const original = await baseText('Tasks.base');
		await obsidianPage.openFile(`${DIR}/Tasks.base`);
		await waitRows(false, 10, 'All*');
		await browser.execute(() => document.querySelector<HTMLElement>('.workspace-leaf.mod-active .fsw-bar .fsw-quick')?.focus());
		await browser.keys(['Enter']);
		await browser.waitUntil(modalOpen, { timeout: 5000, timeoutMsg: 'the Filter by property window did not open' });
		// Property lists the visible columns of the view first: status, priority, area. Focus starts on Property.
		await browser.waitUntil(async () => (await browser.execute(() => document.activeElement?.tagName ?? '')) === 'SELECT', { timeout: 3000 });
		await browser.keys(['ArrowDown', 'ArrowDown']);
		expect(await browser.execute(() => document.querySelector<HTMLSelectElement>('.fsw-quick-modal select')?.value ?? '')).toBe('area');
		await browser.keys(['Tab', 'Tab']);
		expect(await browser.execute(() => document.activeElement?.tagName ?? '')).toBe('INPUT');
		await browser.keys(['w', 'o', 'r', 'k']);
		await browser.pause(400);
		// The first Enter picks the suggestion when the list is open. The next Enter adds the filter.
		await browser.keys(['Enter']);
		await browser.pause(400);
		if (await modalOpen()) await browser.keys(['Enter']);
		const on = await waitQuick(false, 5, ['area: work']);
		expect(on.chips.slice(-2)).toEqual(['', 'Excluded']);
		const text = await baseText('Tasks.base');
		expect(text).toContain('    - file.inFolder("Bases Filter Switches/Tasks")\n    - area == "work"\n');
		// The base file gets only the filter item. The chip lives in the plugin data.
		expect(text).not.toContain('quick:');
		const chips = await browser.executeObsidian(({ app }, id, path) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { quick: Record<string, { chips: { filter: string }[] }> } }> } }).plugins.plugins[id]!;
			return (p.settings.quick[path]?.chips ?? []).map((c) => c.filter);
		}, pluginId, `${DIR}/Tasks.base`);
		expect(chips).toEqual(['area == "work"']);
		// Escape closes the window and changes nothing.
		await clickIn(false, '.fsw-quick');
		await browser.waitUntil(modalOpen, { timeout: 5000 });
		await browser.keys(['Escape']);
		await browser.waitUntil(async () => !(await modalOpen()), { timeout: 5000, timeoutMsg: 'Escape did not close the window' });
		expect(await baseText('Tasks.base')).toBe(text);
		await clickIn(false, '.fsw-quick-remove');
		await waitQuick(false, 10, []);
		expect(await baseText('Tasks.base')).toBe(original);
	});

	it('quick filter on an embedded base: status contains text oin shows only the doing notes', async function () {
		await obsidianPage.openFile(`${DIR}/Weekly review.md`);
		await waitRows(true, 10, 'All*');
		await clickIn(true, '.fsw-quick');
		await browser.waitUntil(modalOpen, { timeout: 5000 });
		// Obsidian 1.14 puts a hidden measuring select after each dropdown, so only the visible selects are used.
		await browser.execute(() => {
			const [property, match] = Array.from(document.querySelectorAll<HTMLSelectElement>('.fsw-quick-modal select.dropdown:not(.is-measuring)'));
			property!.value = 'status';
			property!.dispatchEvent(new Event('change'));
			match!.value = 'contains';
			match!.dispatchEvent(new Event('change'));
			const input = document.querySelector<HTMLInputElement>('.fsw-quick-modal input')!;
			input.value = 'OIN';
			input.dispatchEvent(new Event('input'));
			document.querySelector<HTMLButtonElement>('.fsw-quick-modal button.mod-cta')?.click();
		});
		await waitQuick(true, 2, ['status contains OIN']);
		expect(await baseText('Tasks.base')).toContain('    - status.toString().lower().contains("oin")\n');
		// A switch click keeps the quick filter: Doing and the quick filter give the same 2 notes, Todo gives none.
		await click(true, 'Todo');
		await waitQuick(true, 0, ['status contains OIN']);
	});
	it('Excluded on a base tab: Done on, then the 7 other tasks with the same columns and the mark, then off gives the same bytes', async function () {
		await obsidianPage.openFile(`${DIR}/Tasks.base`);
		await waitRows(false, 10, 'All*');
		await click(false, 'Done');
		await waitRows(false, 3, 'Done*');
		const before = await baseText('Tasks.base');
		const columns = await excludedView(false);
		expect(columns.headers.length).toBeGreaterThan(0);
		await click(false, 'Excluded');
		const on = await waitExcluded(false, true);
		expect(on.headers).toEqual(columns.headers);
		for (const name of NOT_DONE) expect(has(on.names, name)).toBe(true);
		for (const name of DONE) expect(has(on.names, name)).toBe(false);
		expect(on.mark).toBe('Showing excluded files');
		expect(on.outline).toBe(true);
		expect(on.enabled).toEqual(['Excluded*']);
		// The switch chips keep showing the old selection.
		expect(on.chips).toContain('Done*');
		expect(await baseText('Tasks.base')).toContain('filters:\n  not:\n    - and:\n');
		await click(false, 'Excluded');
		const off = await waitExcluded(false, false);
		expect(off.names.length).toBe(3);
		expect(off.outline).toBe(false);
		expect(await baseText('Tasks.base')).toBe(before);
	});

	it('Excluded on an embedded base: the embed shows the notes outside the filters and the mark', async function () {
		const before = await baseText('Tasks.base');
		await obsidianPage.openFile(`${DIR}/Weekly review.md`);
		await waitRows(true, 10, 'All*');
		await click(true, 'Excluded');
		const on = await waitExcluded(true, true);
		for (const name of [...DONE, ...NOT_DONE]) expect(has(on.names, name)).toBe(false);
		expect(has(on.names, 'Weekly review')).toBe(true);
		expect(on.mark).toBe('Showing excluded files');
		await click(true, 'Excluded');
		await waitExcluded(true, false);
		expect(await baseText('Tasks.base')).toBe(before);
	});
});
