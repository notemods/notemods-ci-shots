// The plugin's filter rules against the app's own New button: same properties and folder from the same filters.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { filtersToProperties } from '../../src/filters';
import { cleanUp, configure, filesIn, frontmatter, openBase, pressNew, waitForNew } from './util';

interface RawBase {
	filters?: unknown;
	views?: { name?: string; filters?: unknown; order?: string[] }[];
}

async function rawBase(path: string): Promise<RawBase> {
	return browser.executeObsidian(async ({ app, obsidian }, p) => obsidian.parseYaml(await app.vault.adapter.read(p)) as RawBase, path);
}

async function linkTextOf(target: string, source: string): Promise<string> {
	return browser.executeObsidian(({ app }, t, s) => {
		const dest = app.metadataCache.getFirstLinkpathDest(t, s);
		return dest ? app.metadataCache.fileToLinktext(dest, s) : t;
	}, target, source);
}

describe('filter parity with the app New button', function () {
	beforeEach(async function () {
		await obsidianPage.resetVault();
		await configure({});
	});
	afterEach(cleanUp);

	for (const [base, view, folder] of [
		['Books.base', 'Reading', 'Books'],
		['Tasks.base', 'Apollo', 'Tasks'],
		['Tasks.base', 'All', 'Tasks'],
	] as const) {
		it(`${base} view ${view}: same properties and folder`, async function () {
			await openBase(base, view);
			const before = await filesIn(folder);
			await pressNew();
			const created = await waitForNew(folder, before, (text) => text.startsWith('---'));
			const app = await frontmatter(created.path);
			const raw = await rawBase(base);
			const v = raw.views?.find((x) => x.name === view);
			const link = await linkTextOf('Projects/Apollo', created.path);
			const ours = filtersToProperties(raw.filters, v?.filters, v?.order ?? [], { linkText: (t) => (t === 'Projects/Apollo' ? link : t) });
			expect(app).toEqual(ours.properties);
			expect(created.path.startsWith(`${ours.folder}/`)).toBe(true);
		});
	}
});
