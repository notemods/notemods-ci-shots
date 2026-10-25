import { describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import BasesFilterSwitchesPlugin, { EXCLUDED_BLOCKS, parseExcludedState } from '../src/main';
import { SHOWING_EXCLUDED_CLASS, SwitchBar, type BarHost } from '../src/bar';
import { excludeOff, excludeOn, hasTopFilters, isExcluded, NO_TOP_FILTERS, readConfig, toggleExcluded, withoutExcluded, type ExcludedState } from '../src/basefile';
import { bindPro } from '../src/pro';
import manifest from '../manifest.json';

// "Excluded": the base shows the files that its top-level filters drop. The file gets filters: {not: [old filters]}.
const BASE = `# Tasks board
filters:
  and:
    - file.inFolder("Tasks") # task notes only
    - status == "done"
views:
  - type: table
    name: All
    order:
      - file.name
      - status
filterSwitches:
  groups:
    - name: Status
      switches:
        - label: Todo
          filter: status == "todo"
        - label: Done
          filter: status == "done"
  presets:
    - name: Open
      on: [Status/Todo]
`;

function plugin(text = BASE): { app: App; p: BasesFilterSwitchesPlugin; file: never; notices: string[] } {
	const app = App.createConfigured__({ files: { 'Tasks.base': text } });
	const p = new BasesFilterSwitchesPlugin(app as never, manifest as never);
	const file = app.vault.getFileByPath('Tasks.base') as never;
	if (!file) throw new Error('no file');
	return { app, p, file, notices: [] };
}

describe('Excluded in the base file (pure)', () => {
	it('A1: on wraps the top-level filters in one not item and keeps every other byte', () => {
		const r = excludeOn(BASE, null);
		expect(r.error).toBeNull();
		expect(r.text).toBe(BASE.replace('  and:\n    - file.inFolder("Tasks") # task notes only\n    - status == "done"\n', '  not:\n    - and:\n        - file.inFolder("Tasks") # task notes only\n        - status == "done"\n'));
		expect(isExcluded(r.text, r.state)).toBe(true);
		expect(withoutExcluded(r.text)).toContain('  and:\n    - file.inFolder("Tasks")');
	});

	it('A3: on then off gives back the same bytes for CRLF, 4-space, tab comments and no final newline', () => {
		const shapes = [
			BASE,
			BASE.replace(/\n/g, '\r\n'),
			'filters: \'status != "done"\'   # quoted\nviews: []',
			'filters:\n    or:\n        - a == 1 # one\n\n        - b == 2\n\nviews:\n    - type: table\n      name: All\n',
			'views:\n  - type: table\n    name: All\nfilters:\n  and: [a == 1, b == 2]\n',
		];
		for (const text of shapes) {
			const on = excludeOn(text, null);
			expect(on.text, text).not.toBe(text);
			expect(excludeOff(on.text, on.state).text, text).toBe(text);
		}
	});

	it('A4: a base without top-level filters does not change and names the reason', () => {
		for (const text of ['views: []\n', 'filters:\nviews: []\n', 'filters:\n  and:\nviews: []\n']) {
			expect(hasTopFilters(text)).toBe(false);
			expect(excludeOn(text, null)).toEqual({ text, state: null, error: NO_TOP_FILTERS });
		}
	});

	it('A5: off without the wrapper changes nothing; toggle uses the state', () => {
		const on = excludeOn(BASE, null);
		const handOff = on.text.replace('  not:\n    - and:\n        -', '  and:\n    - and:\n        -');
		const r = excludeOff(handOff, on.state);
		expect(r.text).toBe(handOff);
		expect(r.state).toBeNull();
		expect(r.error).not.toBeNull();
		expect(toggleExcluded(on.text, on.state).text).toBe(BASE);
		expect(toggleExcluded(BASE, null).text).toBe(on.text);
	});

	it('a large base: 2,000 filter items go on and off in under 1 second with the same bytes', () => {
		const text = `filters:\n  and:\n${Array.from({ length: 2000 }, (_, i) => `    - n${i} == ${i}\n`).join('')}views: []\n`;
		const t0 = performance.now();
		const on = excludeOn(text, null);
		const back = excludeOff(on.text, on.state);
		expect(performance.now() - t0).toBeLessThan(1000);
		expect(back.text).toBe(text);
	});
});

describe('Excluded in the plugin', () => {
	it('A6: while Excluded is on, switches, reset, pause, presets and quick filters do not change the file', async () => {
		const { app, p, file } = plugin();
		await p.loadSettings();
		await p.toggleExcluded(file);
		const on = await app.vault.read(file);
		expect(on).toContain('  not:\n');
		expect(p.settings.excluded['Tasks.base']).toBeDefined();
		const groups = readConfig(on).groups;
		await p.toggle(file, groups, 'Status', 'Todo');
		await p.reset(file, groups, null);
		await p.pauseGroup(file, groups, 'Status');
		await p.removeSwitch(file, groups, 'Status', 'Todo');
		expect(await p.saveQuick(file, { property: 'area', match: 'is', value: 'work' })).toBe(false);
		await p.clearQuick(file);
		expect(await app.vault.read(file)).toBe(on);
		// Off: the old bytes and no state.
		await p.toggleExcluded(file);
		expect(await app.vault.read(file)).toBe(BASE);
		expect(p.settings.excluded).toEqual({});
		// Now the switches work again.
		await p.toggle(file, readConfig(BASE).groups, 'Status', 'Todo');
		expect(await app.vault.read(file)).toContain('- or:');
	});

	it('A6: the refusal shows one notice with the reason, and no success notice', async () => {
		const { app, p, file } = plugin();
		await p.loadSettings();
		await p.toggleExcluded(file);
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const spy = vi.spyOn(Notice.prototype as unknown as { constructor__(m: unknown): void }, 'constructor__');
		try {
			await p.saveDefault(file);
			await p.clearDefault(file);
			expect(spy.mock.calls.map((c) => c[0])).toEqual([EXCLUDED_BLOCKS, EXCLUDED_BLOCKS]);
		} finally {
			spy.mockRestore();
			bindPro(null);
		}
		expect(await app.vault.read(file)).not.toContain('default:');
	});

	it('two fast clicks make one write: the base ends with Excluded on', async () => {
		const { app, p, file } = plugin();
		await p.loadSettings();
		await Promise.all([p.toggleExcluded(file), p.toggleExcluded(file)]);
		expect(isExcluded(await app.vault.read(file), p.excludedState(file))).toBe(true);
		await p.toggleExcluded(file);
		expect(await app.vault.read(file)).toBe(BASE);
	});

	it('A9: the Excluded state follows a renamed base, goes with a deleted one and survives a reload', async () => {
		const { app, p, file } = plugin();
		await p.loadSettings();
		await p.toggleExcluded(file);
		await p.loadSettings();
		expect(p.excludedState(file)).not.toBeNull();
		const move = (p as unknown as { moveQuick(o: string, n: string | null): void }).moveQuick.bind(p);
		move('Tasks.base', 'Work/Tasks.base');
		await app.vault.rename(file, 'Work/Tasks.base');
		expect(Object.keys(p.settings.excluded)).toEqual(['Work/Tasks.base']);
		await p.toggleExcluded(file);
		expect(await app.vault.read(file)).toBe(BASE);
		await p.toggleExcluded(file);
		move('Work/Tasks.base', null);
		expect(p.settings.excluded).toEqual({});
	});

	it('a state whose wrapper the user removed by hand is dropped on the next switch write', async () => {
		const { app, p, file } = plugin();
		await p.loadSettings();
		await p.toggleExcluded(file);
		await app.vault.modify(file, BASE);
		await p.toggle(file, readConfig(BASE).groups, 'Status', 'Todo');
		expect(await app.vault.read(file)).toContain('- or:');
		expect(p.settings.excluded).toEqual({});
	});

	it('ignores saved Excluded data in a wrong form', () => {
		expect(parseExcludedState({ origin: 'filters: a\n', live: 'x' })).toEqual({ origin: 'filters: a\n', live: 'x' });
		expect(parseExcludedState({ origin: 3, live: 'x' })).toBeNull();
		expect(parseExcludedState('no')).toBeNull();
	});
});

function host(state: { text: string; excluded: ExcludedState | null }, calls: string[]): BarHost {
	const noop = (): Promise<void> => Promise.resolve();
	return {
		read: () => Promise.resolve(state.text),
		resolve: (c) => c,
		showAdd: () => true,
		toggle: noop,
		reset: noop,
		pauseGroup: noop,
		applyPreset: noop,
		savePreset: () => undefined,
		deletePreset: noop,
		applyDefault: noop,
		saveDefault: noop,
		clearDefault: noop,
		addSwitch: () => undefined,
		editSwitch: () => undefined,
		removeSwitch: noop,
		quickFilter: () => undefined,
		quickState: () => null,
		removeQuick: noop,
		clearQuick: noop,
		excludedState: () => state.excluded,
		toggleExcluded: () => {
			calls.push('excluded');
			({ text: state.text, state: state.excluded } = toggleExcluded(state.text, state.excluded));
			return noop();
		},
	};
}

async function bar(state: { text: string; excluded: ExcludedState | null }, calls: string[] = []): Promise<{ bar: SwitchBar; parent: HTMLElement }> {
	const parent = document.body.createDiv();
	const b = new SwitchBar(host(state, calls), {} as never);
	parent.appendChild(b.el);
	await b.render();
	return { bar: b, parent };
}

const button = (b: SwitchBar, key: string): HTMLButtonElement => {
	const el = b.el.querySelector<HTMLButtonElement>(`[data-fsw-key="${key}"]`);
	if (!el) throw new Error(`no ${key}`);
	return el;
};

describe('Excluded button and mark', () => {
	it('A7: off, the button is last, not pressed, and there is no mark', async () => {
		const { bar: b, parent } = await bar({ text: BASE, excluded: null });
		const keys = Array.from(b.el.querySelectorAll('button')).map((x) => x.getAttribute('data-fsw-key'));
		expect(keys.at(-1)).toBe('excluded');
		expect(button(b, 'excluded').getAttribute('aria-pressed')).toBe('false');
		expect(b.el.querySelector('.fsw-excluded-mark')).toBeNull();
		expect(parent.hasClass(SHOWING_EXCLUDED_CLASS)).toBe(false);
	});

	it('A7: on, the bar shows the mark first, the pressed button, and disabled chips with the old selection', async () => {
		const state = { text: BASE, excluded: null as ExcludedState | null };
		const calls: string[] = [];
		const first = await bar(state, calls);
		button(first.bar, 'excluded').click();
		expect(calls).toEqual(['excluded']);
		const { bar: b, parent } = await bar(state);
		expect(b.el.firstElementChild?.textContent).toBe('Showing excluded files');
		expect(b.el.hasClass('fsw-excluded-on')).toBe(true);
		expect(parent.hasClass(SHOWING_EXCLUDED_CLASS)).toBe(true);
		const ex = button(b, 'excluded');
		expect(ex.getAttribute('aria-pressed')).toBe('true');
		expect(ex.disabled).toBe(false);
		expect(button(b, 'Status/Done').getAttribute('aria-pressed')).toBe('true');
		expect(button(b, 'Status/Todo').getAttribute('aria-pressed')).toBe('false');
		const enabled = Array.from(b.el.querySelectorAll<HTMLButtonElement>('button')).filter((x) => !x.disabled).map((x) => x.getAttribute('data-fsw-key'));
		expect(enabled).toEqual(['excluded']);
		// Destroy removes the outline from the Bases container.
		b.destroy();
		expect(parent.hasClass(SHOWING_EXCLUDED_CLASS)).toBe(false);
	});

	it('A4: a base without top-level filters gets a disabled button with the reason', async () => {
		const { bar: b } = await bar({ text: 'views:\n  - type: table\n    name: All\n', excluded: null });
		const ex = button(b, 'excluded');
		expect(ex.disabled).toBe(true);
		expect(ex.getAttribute('title')).toBe(NO_TOP_FILTERS);
	});
});
