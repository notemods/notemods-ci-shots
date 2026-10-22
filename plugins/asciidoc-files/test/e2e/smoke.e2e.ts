import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

const DIR = 'AsciiDoc Files';

interface Probe {
	type: string | null;
	h1: string | null;
	tables: number;
	headings: string[];
	notes: number;
	source: boolean;
	preview: boolean;
}

/** The active tab: view type, preview headings and tables, and which panes are shown. */
async function probe(): Promise<Probe> {
	return browser.execute(() => {
		const leaf = document.querySelector('.workspace-leaf.mod-active');
		const view = leaf?.querySelector('.adoc-view');
		const prev = view?.querySelector<HTMLElement>('.adoc-preview');
		const src = view?.querySelector<HTMLElement>('.adoc-source');
		return {
			type: leaf?.querySelector('.workspace-leaf-content')?.getAttribute('data-type') ?? null,
			h1: prev?.querySelector('h1')?.textContent ?? null,
			tables: prev?.querySelectorAll('table.tableblock').length ?? 0,
			headings: Array.from(prev?.querySelectorAll('h2') ?? []).map((h) => h.textContent ?? ''),
			notes: prev?.querySelectorAll('.adoc-include-note').length ?? 0,
			source: !!src && src.offsetParent !== null,
			preview: !!prev && prev.offsetParent !== null,
		};
	});
}

async function openAdoc(path: string): Promise<void> {
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => (await probe()).h1 !== null, { timeout: 15000, timeoutMsg: `no rendered preview for ${path}` });
}

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('opens a .adoc file in its own view and renders a heading and a table', async function () {
		await openAdoc(`${DIR}/Handbook.adoc`);
		const p = await probe();
		expect(p.type).toBe('asciidoc-files');
		expect(p.h1).toBe('Tidewater Release Handbook');
		expect(p.tables).toBeGreaterThanOrEqual(1);
		expect(p.headings).toContain('Release checklist');
		expect(p.preview).toBe(true);
		expect(p.source).toBe(false);
	});

	it('without Pro each include shows as a note and the included chapters are not read', async function () {
		const p = await probe();
		expect(p.notes).toBe(2);
		expect(p.headings).not.toContain('Install the tools');
	});

	it('switches to source, edits, saves the file and updates the preview', async function () {
		await browser.executeObsidianCommand(`${pluginId}:toggle-split`);
		await browser.waitUntil(async () => (await probe()).source, { timeout: 5000 });
		const saved = await browser.executeObsidian(async ({ app }, dir) => {
			const view = app.workspace.getMostRecentLeaf()!.view as unknown as { editor: { state: { doc: { length: number } }; dispatch(t: unknown): void } };
			view.editor.dispatch({ changes: { from: view.editor.state.doc.length, insert: '\n\n== Added in the test\n' } });
			await new Promise((r) => setTimeout(r, 2500));
			const f = app.vault.getFileByPath(`${dir}/Handbook.adoc`)!;
			return app.vault.read(f);
		}, DIR);
		expect(saved).toContain('== Added in the test');
		await browser.waitUntil(async () => (await probe()).headings.includes('Added in the test'), { timeout: 5000 });
		const p = await probe();
		expect(p.source && p.preview).toBe(true);
		await browser.executeObsidianCommand(`${pluginId}:toggle-split`);
	});

	it('an xref click opens the target document and scrolls to the anchor', async function () {
		await browser.execute(() => document.querySelector<HTMLElement>('.workspace-leaf.mod-active .adoc-preview a[href="Reference.adoc#exit-codes"]')?.click());
		await browser.waitUntil(async () => (await probe()).h1 === 'Command reference', { timeout: 10000, timeoutMsg: 'Reference.adoc did not open' });
		expect((await probe()).headings).toContain('Exit codes');
	});

	it('passthrough HTML is sanitized: no script, no event handler, no javascript: link runs', async function () {
		await openAdoc(`${DIR}/Unsafe.adoc`);
		await browser.pause(800);
		await browser.execute(() => document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .adoc-preview a').forEach((a) => a.click()));
		await browser.pause(300);
		const r = await browser.execute(() => {
			const prev = document.querySelector('.workspace-leaf.mod-active .adoc-preview')!;
			return {
				xss: (window as unknown as { adocXss?: number }).adocXss ?? null,
				scripts: prev.querySelectorAll('script').length,
				handlers: Array.from(prev.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((a) => a.name.startsWith('on'))).length,
				jsLinks: Array.from(prev.querySelectorAll('a')).filter((a) => /^javascript:/i.test(a.getAttribute('href') ?? '')).length,
			};
		});
		expect(r).toEqual({ xss: null, scripts: 0, handlers: 0, jsLinks: 0 });
	});
});
