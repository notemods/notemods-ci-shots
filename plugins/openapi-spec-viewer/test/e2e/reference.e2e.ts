import { browser, expect } from '@wdio/globals';
import type LocalApiPlugin from '../../src/main';
import type { ReferenceView } from '../../src/view';
const id = 'openapi-spec-viewer';
const source = JSON.stringify({ openapi: '3.1.0', info: { title: 'Pet service' }, paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], get: { tags: ['Pets'], summary: '<img src=x onerror=alert(1)>', responses: { '200': { description: 'Found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } }, '404': { description: 'Not found' } } } } }, components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' }, parent: { $ref: '#/components/schemas/Pet' } } } } } });
describe('local reference workflow', () => {
	it('reads parameters and responses and renders safe source text', async () => {
		const result = await browser.executeObsidian(async ({ app }, id, source) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, LocalApiPlugin> } }).plugins.plugins[id]!;
			await app.vault.create('reference-test.json', source); await p.openFile('reference-test.json');
			const v = app.workspace.getLeavesOfType('local-api-reference').map(l => l.view as ReferenceView).find(v => v.path === 'reference-test.json')!;
			return { text: v.contentEl.textContent, images: v.contentEl.querySelectorAll('img,script').length, unchanged: await app.vault.read(app.vault.getFileByPath(v.path)!) === source };
		}, id, source);
		for (const text of ['GET', '/pets/{id}', 'Pets', 'integer', 'required', '404', '<img src=x onerror=alert(1)>']) expect(result.text).toContain(text);
		expect(result.images).toBe(0); expect(result.unchanged).toBe(true);
	});
	it('opens a schema and stops recursive expansion', async () => {
		const result = await browser.executeObsidian(({ app }) => {
			const v = app.workspace.getLeavesOfType('local-api-reference').map(l => l.view as ReferenceView).find(v => v.path === 'reference-test.json')!;
			const schemaButton = [...v.contentEl.querySelectorAll<HTMLButtonElement>('.lar-schema-links button')].find(b => b.textContent?.startsWith('Response 200'))!;
			schemaButton.click();
			const first = v.contentEl.querySelector('.lar-schema')!.textContent;
			(v.contentEl.querySelector('.lar-property button') as HTMLButtonElement).click();
			return { first, count: v.contentEl.querySelectorAll('.lar-property').length };
		});
		expect(result.first).toContain('name: string'); expect(result.first).toContain('Open reference'); expect(result.count).toBe(2);
	});
	it('accepts YAML and keeps malformed source unchanged', async () => {
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, LocalApiPlugin> } }).plugins.plugins[id]!;
			await app.vault.create('reference-test.yaml', 'openapi: 3.0.3\npaths:\n  /pets:\n    get:\n      tags: [Pets]\n'); await p.openFile('reference-test.yaml');
			const yaml = app.workspace.getLeavesOfType('local-api-reference').map(l => l.view as ReferenceView).find(v => v.path === 'reference-test.yaml')!.contentEl.textContent;
			const bad = await app.vault.create('reference-bad.yaml', 'openapi: [}'); await p.openFile(bad.path);
			const message = app.workspace.getLeavesOfType('local-api-reference').map(l => l.view as ReferenceView).find(v => v.path === bad.path)!.contentEl.textContent;
			return { yaml, message, original: await app.vault.read(bad) };
		}, id);
		expect(result.yaml).toContain('/pets'); expect(result.yaml).toContain('Pets'); expect(result.message).toContain('Parse error'); expect(result.original).toBe('openapi: [}');
	});
	it('guards paid writes then saves notes and bookmarks with a local sponsorship response', async () => {
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, LocalApiPlugin> } }).plugins.plugins[id]!;
			const v = app.workspace.getLeavesOfType('local-api-reference').map(l => l.view as ReferenceView).find(v => v.path === 'reference-test.json')!;
			const e = v.spec!.endpoints[0]!; p.pro!.signOut();
			const blocked = await p.exportEndpoint(e, v.path) === null;
			const manager = p.pro as unknown as { opts: { http: (req: unknown) => Promise<unknown> } };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(id + '-github-token', 'gho_' + '0'.repeat(36)); await p.pro!.refreshNow();
			const note = await p.exportEndpoint(e, v.path); await p.bookmark(v.path, e.id); await p.saveFilter('Review', 'Pets');
			const data = await p.loadData() as { bookmarks: unknown[]; filters: unknown[] }; const body = note ? await app.vault.read(note) : '';
			p.pro!.signOut(); return { blocked, body, bookmarks: data.bookmarks.length, filters: data.filters.length, source: await app.vault.read(app.vault.getFileByPath(v.path)!) };
		}, id);
		expect(result.blocked).toBe(true); expect(result.body).toContain('&lt;img'); expect(result.bookmarks).toBe(1); expect(result.filters).toBe(1); expect(result.source).toBe(source);
	});
});
