import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import AsciidocFilesPlugin from '../src/main';
import { classifyHref } from '../src/adoc/links';
import { bindPro } from '../src/pro';
import type { AsciidocView } from '../src/view';
import manifest from '../manifest.json';

afterEach(() => bindPro(null));

async function setup(files: Record<string, string>) {
	const app = App.createConfigured__({ files });
	const plugin = new AsciidocFilesPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	return { app, plugin };
}

describe('audit regressions', () => {
	it('export does not overwrite an HTML file that the plugin did not write', async () => {
		const mine = '<p>My own page.</p>\n';
		const { app, plugin } = await setup({ 'docs/doc.adoc': '= Doc\n\nText.\n', 'docs/doc.html': mine });
		const view = { file: app.vault.getFileByPath('docs/doc.adoc'), data: '= Doc\n\nText.\n' } as unknown as AsciidocView;
		const path = await plugin.exportHtml(view);
		const own = app.vault.getFileByPath('docs/doc.html');
		expect(own ? await app.vault.read(own) : '').toBe(mine);
		expect(path).toBe('docs/doc 1.html');
		// A second export replaces the earlier export, not a new name each time.
		view.data = '= Doc\n\nNew text.\n';
		expect(await plugin.exportHtml(view)).toBe('docs/doc 1.html');
		const out = app.vault.getFileByPath('docs/doc 1.html');
		expect(out ? await app.vault.read(out) : '').toContain('New text.');
		expect(app.vault.getFileByPath('docs/doc 2.html')).toBeNull();
	});

	it('export replaces its own earlier file at the plain name', async () => {
		const { app, plugin } = await setup({ 'docs/doc.adoc': '= Doc\n\nOne.\n' });
		const view = { file: app.vault.getFileByPath('docs/doc.adoc'), data: '= Doc\n\nOne.\n' } as unknown as AsciidocView;
		expect(await plugin.exportHtml(view)).toBe('docs/doc.html');
		view.data = '= Doc\n\nTwo.\n';
		expect(await plugin.exportHtml(view)).toBe('docs/doc.html');
		const out = app.vault.getFileByPath('docs/doc.html');
		expect(out ? await app.vault.read(out) : '').toContain('Two.');
	});

	it('a fragment with a bad percent escape does not throw on click', () => {
		expect(() => classifyHref('#50%', 'a.adoc')).not.toThrow();
		expect(classifyHref('#50%', 'a.adoc')).toEqual({ kind: 'anchor', fragment: '50%' });
		expect(classifyHref('#caf%C3%A9', 'a.adoc')).toEqual({ kind: 'anchor', fragment: 'café' });
	});

	it('with Pro, an include that fails to read becomes a missing note and the preview still renders', async () => {
		const { app, plugin } = await setup({ 'docs/guide.adoc': '= Guide\n\ninclude::part.adoc[]\n', 'docs/part.adoc': '== Part\n' });
		bindPro({ isPro: () => true, onChange: () => () => undefined } as unknown as SponsorsManager);
		vi.spyOn(app.vault, 'cachedRead').mockRejectedValue(new Error('EIO'));
		const r = await plugin.expand('= Guide\n\ninclude::part.adoc[]\n', 'docs/guide.adoc');
		expect(r.includes.map((i) => i.status)).toEqual(['missing']);
		expect(r.text).toContain('file not found');
	});
});
