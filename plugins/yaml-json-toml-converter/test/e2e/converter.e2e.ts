import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type DataFormatConverterPlugin from '../../src/main';
import type { BatchModal, ConversionModal } from '../../src/ui';
import { pluginId } from './load';

let noteIndex = 0;
async function select(text: string): Promise<void> {
	await browser.executeObsidian(({ app }, id) => { const p = (app as unknown as { plugins: { plugins: Record<string, DataFormatConverterPlugin> } }).plugins.plugins[id]!; for (const m of p.modals) m.close(); }, pluginId);
	const path = `Conversion test ${++noteIndex}.md`;
	await browser.executeObsidian(async ({ app }, name, value) => { await app.vault.create(name, value); }, path, text);
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, value) => app.workspace.activeEditor?.editor?.getValue() === value, text), { timeout: 15000, timeoutMsg: 'Editor must contain the test input.' });
	await browser.executeObsidian(({ app }, value) => { const e = app.workspace.activeEditor!.editor!; e.setSelection({ line: 0, ch: 0 }, e.offsetToPos(value.length)); }, text);
}
async function state(): Promise<{ preview: string; status: string; disabled: boolean } | null> {
	return browser.execute(() => { const el = document.querySelector('.modal .data-format-converter'); if (!el) return null; return { preview: el.querySelector('.dfc-preview')?.textContent ?? '', status: el.querySelector('.dfc-status')?.textContent ?? '', disabled: el.querySelector<HTMLButtonElement>('button')?.disabled ?? true }; });
}
async function open(source = 'yaml', target = 'json'): Promise<void> {
	await browser.executeObsidianCommand(`${pluginId}:convert-selection`);
	await browser.waitUntil(async () => (await state()) !== null, { timeout: 15000 });
	await browser.$('[aria-label="Source format"]').selectByAttribute('value', source);
	await browser.$('[aria-label="Target format"]').selectByAttribute('value', target);
}
async function text(): Promise<string> { return browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? ''); }
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, enabled) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, DataFormatConverterPlugin> } }).plugins.plugins[id]!;
		if (!enabled) { p.pro!.signOut(); return; }
		p.pro!.opts.http = () => Promise.resolve({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36)); await p.pro!.refreshNow();
	}, pluginId, on);
}
describe('Data Format Converter in the editor', function () {
	before(async () => setPro(false));
	it('previews YAML as JSON and replaces after confirmation', async () => {
		await select('name: Ada\ncount: 3'); await open(); const s = await state(); expect(JSON.parse(s!.preview)).toEqual({ name: 'Ada', count: 3 }); expect(s!.disabled).toBe(false);
		await browser.$('button=Replace selection').click(); await browser.waitUntil(async () => (await state()) === null, { timeout: 5000 }); expect(JSON.parse(await text())).toEqual({ name: 'Ada', count: 3 });
	});
	it('previews JSON as TOML', async () => { await select('{"name":"Ada","count":3}'); await open('json', 'toml'); const s = await state(); expect(s!.preview).toContain('name = "Ada"'); expect(s!.preview).toContain('count = 3'); });
	it('previews a TOML table as JSON', async () => { await select('[person]\nname = "Ada"'); await open('toml', 'json'); expect(JSON.parse((await state())!.preview)).toEqual({ person: { name: 'Ada' } }); });
	it('keeps Boolean array values in TOML', async () => { await select('flags: [true, false]'); await open('yaml', 'toml'); expect((await state())!.preview).toMatch(/flags = \[\s*true,\s*false\s*\]/); });
	for (const c of [
		['null path', '{"a":null}', 'json', 'toml', '$["a"]'],
		['duplicate YAML', 'a: 1\na: 2', 'yaml', 'json', 'Map keys must be unique'],
		['indentation', 'a:\n  b: 1\n c: 2', 'yaml', 'json', 'column'],
		['custom tag', 'a: !custom Ada', 'yaml', 'json', 'tag'],
		['cyclic alias', 'a: &cycle [*cycle]', 'yaml', 'json', 'Cyclic aliases'],
		['large number', 'a: 9007199254740993', 'yaml', 'json', 'safe conversion range'],
		['YAML underflow', 'n: 1e-999', 'yaml', 'json', 'underflows'],
		['TOML underflow', 'n = 1e-999', 'toml', 'json', 'underflows'],
		['TOML negative zero', 'n = -0', 'toml', 'json', 'Negative zero'],
		['TOML date', 'day = 2026-10-12', 'toml', 'json', 'Dates and non-plain objects'],
		['TOML final array comment', 'a=[1 #', 'toml', 'json', 'Invalid TOML'],
		['TOML final table comment', 'a={b=1 #', 'toml', 'json', 'Invalid TOML'],
		['deep YAML', '['.repeat(5000) + '1' + ']'.repeat(5000), 'yaml', 'json', 'Maximum call stack size exceeded'],
	]) it(`blocks ${c[0]} and keeps the note`, async () => { await select(c[1]!); await open(c[2], c[3]); const s = await state(); expect(s!.status).toContain(c[4]); expect(s!.disabled).toBe(true); expect(await text()).toBe(c[1]); });
	it('converts TOML after thousands of comments', async () => {
		const input = '# comment\n'.repeat(8000) + 'name = "Ada"';
		await select(input); await open('toml', 'json');
		expect(JSON.parse((await state())!.preview)).toEqual({ name: 'Ada' });
		expect((await state())!.disabled).toBe(false); expect(await text()).toBe(input);
	});
	it('Cancel keeps the source byte-identical', async () => { const input = 'name: Ada\n# keep this\n'; await select(input); await open(); await browser.$('button=Cancel').click(); expect(await text()).toBe(input); });
	it('blocks replacement after a source change', async () => {
		await select('name: Ada'); await open(); await browser.executeObsidian(({ app }, id) => { const p = (app as unknown as { plugins: { plugins: Record<string, DataFormatConverterPlugin> } }).plugins.plugins[id]!; const m = [...p.modals][0] as ConversionModal; m.editor.setValue('name: Bea'); }, pluginId);
		await browser.$('button=Replace selection').click(); expect((await state())!.status).toContain('Source changed'); expect(await text()).toBe('name: Bea');
	});
	it('shows the comment-loss warning', async () => { await select('name: Ada # comment'); await open(); expect(await browser.$('.dfc-warning').getText()).toContain('Comments and YAML scalar styles will not be retained'); });
	it('blocks both Pro commands when signed out', async () => { await select('{"name":"Ada"}'); await setPro(false); await browser.executeObsidianCommand(`${pluginId}:validate-schema`); expect(await state()).toBeNull(); await browser.executeObsidianCommand(`${pluginId}:batch-convert`); expect(await state()).toBeNull(); });
	it('validates selected JSON against a local schema', async () => {
		await select('{"name":"Ada","count":3}'); await setPro(true); await browser.executeObsidian(async ({ app }) => { await app.vault.create('person.schema.json', '{"type":"object","required":["name"],"definitions":{"label":{"type":"string"}},"properties":{"name":{"$ref":"#/definitions/label"}}}'); });
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.vault.getFileByPath('person.schema.json') !== null), { timeout: 10000 });
		await browser.executeObsidianCommand(`${pluginId}:validate-schema`); await browser.$('[aria-label="Schema path in vault"]').setValue('person.schema.json'); await browser.$('button=Validate JSON').click();
		await browser.waitUntil(async () => (await state())?.status === 'JSON matches the local schema.', { timeout: 10000, timeoutMsg: `Schema status: ${JSON.stringify(await state())}` }); expect(await text()).toBe('{"name":"Ada","count":3}');
	});
	it('previews chosen blocks and creates two new files', async () => {
		const input = '```yaml\nname: Ada\n```\n```toml\ncount = 3\n```'; await select(input); await setPro(true); await browser.executeObsidianCommand(`${pluginId}:batch-convert`);
		await browser.$('[aria-label="Choose block 1"]').click(); await browser.$('[aria-label="Choose block 2"]').click(); expect((await state())!.status).toContain('2 new files in preview'); await browser.$('button=Create new files').click();
		await browser.waitUntil(async () => (await state())?.status.includes('Created 2 files') === true, { timeout: 10000 });
		const contents = await browser.executeObsidian(async ({ app }) => [JSON.parse(await app.vault.read(app.vault.getFileByPath('Converted block 1.json')!)), JSON.parse(await app.vault.read(app.vault.getFileByPath('Converted block 2.json')!))] as unknown[]);
		expect(contents).toEqual([{ name: 'Ada' }, { count: 3 }]); expect(await text()).toBe(input);
	});
	it('checks Pro again after a batch preview', async () => {
		await select('```yaml\nname: Ada\n```\n```yaml\nname: Bea\n```\n```yaml\nname: Cora\n```'); await setPro(true); await browser.executeObsidianCommand(`${pluginId}:batch-convert`);
		await browser.executeObsidian(async ({ app }, id) => { const p = (app as unknown as { plugins: { plugins: Record<string, DataFormatConverterPlugin> } }).plugins.plugins[id]!; const m = [...p.modals][0] as BatchModal; m.chosen.add(3); m.previewBatch(); if (m.items.length !== 1) throw new Error('A fresh preview is required.'); p.pro!.signOut(); await m.createFiles(); }, pluginId); expect(await text()).toContain('name: Ada'); expect(await browser.executeObsidian(({ app }) => app.vault.getFileByPath('Converted block 3.json'))).toBeNull();
	});
	after(async () => { await setPro(false); await browser.executeObsidian(({ app }, id) => { const p = (app as unknown as { plugins: { plugins: Record<string, DataFormatConverterPlugin> } }).plugins.plugins[id]!; for (const m of p.modals) m.close(); }, pluginId); });
});
