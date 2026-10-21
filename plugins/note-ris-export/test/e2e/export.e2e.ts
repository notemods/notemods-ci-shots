import { browser, expect } from '@wdio/globals';
import type NoteRisExportPlugin from '../../src/main';

type Plugins = { plugins: { plugins: Record<string, NoteRisExportPlugin> } };
const LEE = '---\ntype: JOUR\ntitle: Test\nauthors:\n  - Lee\n  - Kim\nyear: 2026\njournal: Example\ndoi: 10.1/test\ncollection: thesis\n---\nBody\n';
const BAD = '---\ntype: JOUR\nyear: soon\n---\n';
const EXPECTED = 'TY  - JOUR\r\nTI  - Test\r\nAU  - Lee\r\nAU  - Kim\r\nPY  - 2026\r\nT2  - Example\r\nDO  - 10.1/test\r\nER  - \r\n';

async function click(action: string): Promise<void> {
	const el = browser.$(`.note-ris-export [data-action="${action}"]`);
	await el.waitForExist();
	await el.waitForEnabled();
	// Send the button event without a screen position or a theme check.
	await browser.execute((action) => {
		const button = document.querySelector<HTMLButtonElement>(`.note-ris-export [data-action="${action}"]`);
		if (!button || button.disabled) throw new Error(`Button ${action} is not ready.`);
		button.click();
	}, action);
}

async function read(path: string): Promise<string | null> {
	return browser.executeObsidian(async ({ app }, p) => { const f = app.vault.getFileByPath(p); return f ? app.vault.read(f) : null; }, path);
}

/** Writes the notes, waits until the metadata cache has their properties, and opens the export window on E2E Refs. */
async function prepare(notes: Record<string, string>): Promise<void> {
	await browser.executeObsidian(async ({ app }, notes) => {
		const p = (app as unknown as Plugins).plugins.plugins['note-ris-export']!;
		p.modal?.close();
		p.pro!.signOut();
		p.settings.folder = 'E2E Refs';
		p.settings.filter = '';
		p.settings.output = 'E2E References.ris';
		p.settings.last = null;
		p.settings.repeat = false;
		p.settings.map = { type: 'type', title: 'title', authors: 'authors', year: 'year', journal: 'journal', doi: 'doi', url: 'url', abstract: 'abstract' };
		p.settings.maps = [];
		p.settings.activeMap = '';
		await p.saveSettings();
		for (const f of app.vault.getFiles().filter((f) => f.path.startsWith('E2E '))) await app.vault.delete(f, true);
		if (!app.vault.getFolderByPath('E2E Refs')) await app.vault.createFolder('E2E Refs');
		for (const [path, text] of Object.entries(notes)) await app.vault.create(path, text);
	}, notes);
	await browser.waitUntil(() => browser.executeObsidian(({ app, obsidian }, notes) => Object.entries(notes).every(([path, text]) => {
		if (!path.endsWith('.md')) return true;
		const f = app.vault.getFileByPath(path);
		const props = f && app.metadataCache.getFileCache(f)?.frontmatter;
		if (!props) return false;
		const expected = obsidian.parseYaml(text.split('---')[1]!) as Record<string, unknown>;
		const actual = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'position'));
		return JSON.stringify(actual) === JSON.stringify(expected);
	}), notes), { timeout: 20000, timeoutMsg: 'The metadata cache must hold the new note properties.' });
	await browser.executeObsidianCommand('note-ris-export:open-export');
	await browser.$('.note-ris-export .nre-state').waitForExist({ timeout: 20000 });
}

/** Uses a local reply. No GitHub account or request is used. */
async function enablePro(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as Plugins).plugins.plugins['note-ris-export']!;
		const m = p.pro as unknown as { opts: { http: () => Promise<unknown> }; refreshNow: () => Promise<void> };
		m.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret('note-ris-export-github-token', 'gho_' + '0'.repeat(36));
		await m.refreshNow();
	});
}

describe('RIS export in a real vault', function () {
	afterEach(async function () {
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Plugins).plugins.plugins['note-ris-export']!;
			p.modal?.close();
			p.pro!.signOut();
		});
	});

	it('exports the first acceptance case as a UTF-8 RIS file', async function () {
		await prepare({ 'E2E Refs/Lee.md': LEE });
		expect(await browser.$('.note-ris-export .nre-ready').getText()).toBe('Ready: 1 record with no errors.');
		await click('export');
		await browser.$('.note-ris-export .nre-saved').waitForExist({ timeout: 20000 });
		expect(await read('E2E References.ris')).toBe(EXPECTED);
		expect(await read('E2E Refs/Lee.md')).toBe(LEE);
	});

	it('creates a numbered file when the output exists', async function () {
		await prepare({ 'E2E Refs/Lee.md': LEE, 'E2E References.ris': 'keep' });
		await click('export');
		await browser.$('.note-ris-export .nre-saved').waitForExist({ timeout: 20000 });
		expect(await read('E2E References.ris')).toBe('keep');
		expect(await read('E2E References (2).ris')).toBe(EXPECTED);
	});

	it('lists errors and keeps Export off', async function () {
		await prepare({ 'E2E Refs/Lee.md': LEE, 'E2E Refs/Bad.md': BAD });
		const items = await browser.$$('.note-ris-export .nre-problems li').map((e) => e.getText());
		expect(items).toEqual(['E2E Refs/Bad.md: missing title (property "title"); year "soon" is not a 4-digit year (property "year")']);
		expect(await browser.$('.note-ris-export [data-action="export"]').isEnabled()).toBe(false);
		expect(await read('E2E References.ris')).toBeNull();
	});

	it('signed-out Pro actions change nothing', async function () {
		await prepare({ 'E2E Refs/Lee.md': LEE });
		const r = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Plugins).plugins.plugins['note-ris-export']!;
			return { map: await p.saveMap('X'), repeat: await p.setRepeat(true), again: await p.repeatLast(), maps: p.settings.maps.length };
		});
		expect(r).toEqual({ map: false, repeat: false, again: 'blocked', maps: 0 });
	});

	it('Pro exports a filtered group', async function () {
		await prepare({ 'E2E Refs/Lee.md': LEE, 'E2E Refs/Other.md': LEE.replace('Test', 'Other').replace('thesis', 'review') });
		await enablePro();
		const path = await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as Plugins).plugins.plugins['note-ris-export']!;
			return p.exportRis('E2E Refs', 'collection = thesis');
		});
		expect(path).toBe('E2E References.ris');
		expect(await read('E2E References.ris')).toBe(EXPECTED);
	});

	it('keeps Unicode titles and author names in the saved file', async function () {
		const note = LEE.replace('title: Test', 'title: Étude α').replace('  - Lee\n  - Kim', '  - García\n  - 李');
		await prepare({ 'E2E Refs/Unicode.md': note });
		await click('export');
		await browser.$('.note-ris-export .nre-saved').waitForExist({ timeout: 20000 });
		expect(await read('E2E References.ris')).toBe(EXPECTED.replace('TI  - Test', 'TI  - Étude α').replace('AU  - Lee\r\nAU  - Kim', 'AU  - García\r\nAU  - 李'));
	});

	it('Pro selects a saved field map', async function () {
		await prepare({ 'E2E Refs/Lee.md': LEE.replace('title: Test', 'paper_title: A study') });
		await enablePro();
		const path = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as Plugins).plugins.plugins['note-ris-export']!;
			p.settings.map.title = 'paper_title';
			await p.saveMap('Imported titles');
			p.settings.map.title = 'title';
			await p.useMap('Imported titles');
			return p.exportRis('E2E Refs');
		});
		expect(path).toBe('E2E References.ris');
		expect(await read('E2E References.ris')).toBe(EXPECTED.replace('TI  - Test', 'TI  - A study'));
	});

	it('Pro repeats an export after saved properties change', async function () {
		await prepare({ 'E2E Refs/Lee.md': LEE });
		await enablePro();
		await browser.executeObsidian(async ({ app }, note) => {
			const p = (app as unknown as Plugins).plugins.plugins['note-ris-export']!;
			await p.exportRis('E2E Refs');
			await p.setRepeat(true);
			await app.vault.modify(app.vault.getFileByPath('E2E Refs/Lee.md')!, note);
		}, LEE.replace('title: Test', 'title: Updated title'));
		const expected = EXPECTED.replace('TI  - Test', 'TI  - Updated title');
		await browser.waitUntil(async () => await read('E2E References.ris') === expected, { timeout: 20000, timeoutMsg: 'The repeat must save the new title.' });
		expect(await read('E2E References (2).ris')).toBeNull();
	});
});
