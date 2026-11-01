import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingGates, whatProModel, whatProUrl } from '../src/license/github-obsidian';
import { PRO_FEATURES } from '../src/pro-features';
import { PRO_UI, SPONSORS } from '../src/pro';
import { SAMPLE_COLUMNS, tableDemo, whatProFeatures } from '../src/what-pro';
import manifest from '../manifest.json';

const ROOT = join(import.meta.dirname, '..');
const read = (file: string): string | null => {
	try {
		return readFileSync(join(ROOT, file), 'utf8');
	} catch {
		return null;
	}
};
const demo = (id: string): HTMLElement => {
	const el = document.createElement('div');
	const f = whatProFeatures().find((x) => x.id === id);
	if (!f) throw new Error(`no feature ${id}`);
	f.demo(el);
	return el;
};

describe('What Pro adds: feature list', () => {
	it('lists the 4 Pro features of the plugin, one line each', () => {
		expect(PRO_FEATURES.map((f) => f.id)).toEqual(['columns', 'file-view', 'last', 'pin']);
		for (const f of PRO_FEATURES) expect(f.line).toMatch(/^[A-Z].{20,160}\.$/);
		expect(whatProFeatures().map((f) => f.line)).toEqual(PRO_FEATURES.map((f) => f.line));
	});

	it('each listed feature has its Pro gate in src', () => {
		expect(missingGates(PRO_FEATURES, read)).toEqual([]);
	});

	it('negative control: a listed feature without a gate in src fails the gate check', () => {
		const ghost = { id: 'ghost', line: 'Freeze the first row of each group.', gate: { file: 'src/scope.ts', text: 'groups: pro && settings.freezeGroups' } };
		expect(missingGates([...PRO_FEATURES, ghost], read)).toEqual(['ghost']);
	});

	it('the README Pro section has the same lines and the same price text', () => {
		const readme = read('README.md') ?? '';
		const section = readme.slice(readme.indexOf('\n## Pro\n'));
		expect(section.startsWith('\n## Pro\n')).toBe(true);
		for (const f of PRO_FEATURES) expect(section).toContain(`\n- ${f.line}\n`);
		expect(section).toContain(PRO_UI.priceText);
	});
});

describe('What Pro adds: price and button', () => {
	it('the Sponsor $15 once button opens the one-time tab with metadata_source=<plugin id>-whatpro', () => {
		const m = whatProModel(null, { pluginId: manifest.id, features: PRO_FEATURES, priceText: PRO_UI.priceText }, SPONSORS);
		expect(m.sponsorText).toBe('Sponsor $15 once');
		expect(m.sponsorUrl).toBe('https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=bases-freeze-panes-whatpro');
		expect(m.sponsorUrl).toBe(whatProUrl(SPONSORS, manifest.id));
		expect(m.priceText).toBe(PRO_UI.priceText);
	});
});

describe('What Pro adds: demos on a sample table', () => {
	const result = (el: HTMLElement): string => el.querySelector('.pf-whatpro-demo-result')?.textContent ?? '';
	const sticky = (el: HTMLElement): string[] => [...el.querySelectorAll<HTMLElement>('tr:first-child th')].filter((c) => c.style.position === 'sticky').map((c) => c.textContent ?? '');
	it('columns: 3 frozen columns stick to the left edge with the offsets of the planner', () => {
		const el = demo('columns');
		expect(result(el)).toBe('Frozen on the left: Name, Author, Year.');
		expect(sticky(el)).toEqual(['Name', 'Author', 'Year']);
		const lefts = [...el.querySelectorAll<HTMLElement>('tr:first-child th.is-frozen')].map((c) => c.style.left);
		expect(lefts).toEqual(['0px', '150px', '280px']);
	});

	it('file-view: the view choice wins over the file choice, and other files keep the default', () => {
		expect(demo('file-view').querySelector('code')?.textContent).toBe('Books.base, view Table: 3 frozen columns\nBooks.base, view By shelf: 2 frozen columns\nOther files: 1 frozen column');
	});

	it('last: the Status column sticks to the right edge', () => {
		const el = demo('last');
		expect(result(el)).toBe('Frozen on the left: Name. Pinned to the right edge: Status.');
		const end = el.querySelector<HTMLElement>('tr:first-child th.is-end');
		expect(end?.textContent).toBe('Status');
		expect(end?.style.right).toBe('0px');
	});

	it('pin: the Rating column moves next to the frozen column', () => {
		const el = demo('pin');
		expect(result(el)).toBe('Frozen on the left: Name, Rating.');
		expect([...el.querySelectorAll('tr:first-child th')].map((c) => c.textContent)).toEqual(['Name', 'Rating', 'Author', 'Year', 'Pages', 'Genre', 'Shelf', 'Status']);
	});

	it('the free plan of the same table keeps 1 column', () => {
		expect(tableDemo(document.createElement('div'), 1, false, null).frozen).toEqual(['Name']);
		expect(SAMPLE_COLUMNS).toHaveLength(8);
	});
});

describe('What Pro adds: entry points', () => {
	const main = read('src/main.ts') ?? '';
	it('has one command and opens the window only from a user action', () => {
		expect(main).toContain("this.addCommand({ id: 'what-pro-adds', name: WHAT_PRO_TITLE, callback: () => this.openWhatPro() });");
		// onload never opens it: the only calls are inside callbacks.
		const onload = main.slice(main.indexOf('async onload()'), main.indexOf('onunload()'));
		expect(onload.match(/openWhatPro\(\)/g)).toHaveLength(1);
	});
	it('has the settings button and the notice link', () => {
		expect(read('src/settings.ts')).toContain('sponsorsSettingItemsWithWhatPro(this.plugin.pro, PRO_UI, () => this.plugin.openWhatPro())');
		expect(main).toContain("showProNoticeWithWhatPro(this.pro, 'This is a pro feature.', () => this.openWhatPro());");
	});
});
