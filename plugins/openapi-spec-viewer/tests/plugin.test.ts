import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import LocalApiPlugin from '../src/main';
import { MAX_BYTES, parseSpec, resolve, schemaDetails } from '../src/model';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { normalizeSaved } from '../src/settings';
import { ReferenceView } from '../src/view';
import manifest from '../manifest.json';

function plugin(files: Record<string, string> = {}) {
	const app = App.createConfigured__({ files });
	return new LocalApiPlugin(app as never, manifest as never);
}
function pro(on: boolean) { bindPro({ isPro: () => on, onChange: () => () => undefined } as never); }
const source = JSON.stringify({ openapi: '3.0.3', paths: { '/pets': { get: { summary: '<img src=x onerror=alert(1)>', description: 'Pets', responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } } } }, components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' }, child: { $ref: '#/components/schemas/Pet' } } } } } });
const endpoint = parseSpec(source).endpoints[0]!;
afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('vault actions and Pro guards', () => {
	it('blocks three paid actions before Pro', async () => {
		const p = plugin(); const save = vi.spyOn(p, 'saveData'); const create = vi.spyOn(p.app.vault, 'create');
		expect(await p.bookmark('api.json', endpoint.id)).toBe(false);
		expect(await p.saveFilter('Pets', 'Pets')).toBe(false);
		expect(await p.exportEndpoint(endpoint, 'api.json')).toBeNull();
		expect(save).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
	});
	it('writes new notes and keeps an existing note and source', async () => {
		pro(true); const p = plugin({ 'api.json': source, 'API GET pets.md': 'Keep this' });
		const note = await p.exportEndpoint(endpoint, 'api.json');
		expect(note?.path).toBe('API GET pets 2.md');
		expect(await p.app.vault.read(note!)).toContain('&lt;img');
		expect(await p.app.vault.read(p.app.vault.getFileByPath('API GET pets.md')!)).toBe('Keep this');
		expect(await p.app.vault.read(p.app.vault.getFileByPath('api.json')!)).toBe(source);
	});
	it('saves and removes bookmarks, and replaces a named filter', async () => {
		pro(true); const p = plugin(); const save = vi.spyOn(p, 'saveData').mockResolvedValue();
		await p.bookmark('api.json', endpoint.id); expect(p.settings.bookmarks).toHaveLength(1);
		await p.bookmark('api.json', endpoint.id); expect(p.settings.bookmarks).toHaveLength(0);
		await p.saveFilter('Review', 'Pets'); await p.saveFilter('Review', 'Admin');
		expect(p.settings.filters).toEqual([{ name: 'Review', tag: 'Admin' }]); expect(save).toHaveBeenCalledTimes(4);
	});
	it('keeps saved values when a write fails', async () => {
		pro(true); const p = plugin(); vi.spyOn(p, 'saveData').mockRejectedValue(new Error('disk full'));
		expect(await p.bookmark('a', 'GET /')).toBe(false); expect(p.settings.bookmarks).toEqual([]);
		expect(await p.saveFilter('a', 'Pets')).toBe(false); expect(p.settings.filters).toEqual([]);
		vi.spyOn(p.app.vault, 'create').mockRejectedValue(new Error('disk full'));
		expect(await p.exportEndpoint(endpoint, 'a')).toBeNull();
	});
	it('normalizes damaged saved data', () => {
		expect(normalizeSaved(null)).toEqual({ bookmarks: [], filters: [] });
		expect(normalizeSaved({ bookmarks: [null, { source: 2 }, { source: 'a', endpoint: 'GET /' }], filters: [{ name: '', tag: 'Pets' }] })).toEqual({ bookmarks: [{ source: 'a', endpoint: 'GET /' }], filters: [] });
	});
	it('uses the reference sponsorship terms', () => {
		expect(isPro()).toBe(false);
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
});

describe('read-only view', () => {
	function view(p: LocalApiPlugin) {
		const leaf = p.app.workspace.getLeaf('tab');
		const v = new ReferenceView(leaf, p); v.path = 'api.json'; return v;
	}
	it('renders HTML as text and opens a shallow schema', async () => {
		const p = plugin({ 'api.json': source }); const v = view(p); await v.reload();
		expect(v.contentEl.textContent).toContain('<img src=x onerror=alert(1)>');
		expect(v.contentEl.querySelector('img,script')).toBeNull();
		(v.contentEl.querySelector('.lar-schema-links button') as HTMLButtonElement).click();
		expect(v.contentEl.querySelector('.lar-schema')?.textContent).toContain('name: string');
		(v.contentEl.querySelector('.lar-property button') as HTMLButtonElement).click();
		expect(v.contentEl.querySelectorAll('.lar-property')).toHaveLength(2);
	});
	it('parse errors and reload do not write source', async () => {
		const p = plugin({ 'api.json': '{bad' }); const v = view(p);
		const create = vi.spyOn(p.app.vault, 'create'); const modify = vi.spyOn(p.app.vault, 'modify');
		await v.reload(); expect(v.contentEl.textContent).toContain('Parse error');
		expect(create).not.toHaveBeenCalled(); expect(modify).not.toHaveBeenCalled();
	});
	it('does not request external schema references', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		const r = schemaDetails({}, { $ref: 'https://example.com/Pet.json' });
		expect(r.error).toContain('Unsupported'); expect(fetch).not.toHaveBeenCalled();
	});
	it('rejects oversize bytes and permits exactly 5 MiB', () => {
		const prefix = '{"openapi":"3.0.3","padding":"'; const suffix = '"}';
		const exact = prefix + 'x'.repeat(MAX_BYTES - prefix.length - suffix.length) + suffix;
		expect(parseSpec(exact).version).toBe('3.0.3');
		expect(() => parseSpec(exact + ' ')).toThrow('5 MiB');
		expect(() => parseSpec('é'.repeat(MAX_BYTES / 2 + 1))).toThrow('5 MiB');
	});
	it('limits long reference chains', () => {
		const root: Record<string, unknown> = {};
		for (let i = 0; i < 50; i++) root[String(i)] = { $ref: `#/${i + 1}` };
		expect(resolve(root, { $ref: '#/0' }).error).toContain('depth limit');
	});
});
