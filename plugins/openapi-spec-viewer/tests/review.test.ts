import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import LocalApiPlugin from '../src/main';
import { endpointMarkdown, parseSpec } from '../src/model';
import { bindPro, resetPro } from '../src/pro';
import { ReferenceView } from '../src/view';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('review defects', () => {
	it('shows endpoints after a file without the selected tag is opened', async () => {
		const a = JSON.stringify({ openapi: '3.0.3', paths: { '/pets': { get: { tags: ['Pets'] } } } });
		const b = JSON.stringify({ openapi: '3.0.3', paths: { '/users': { get: { tags: ['Users'] } } } });
		const app = App.createConfigured__({ files: { 'a.json': a, 'b.json': b } });
		const p = new LocalApiPlugin(app as never, manifest as never);
		const v = new ReferenceView(p.app.workspace.getLeaf('tab'), p);
		v.path = 'a.json'; await v.reload();
		const select = v.contentEl.querySelector('select')!;
		select.value = 'Pets'; select.dispatchEvent(new Event('change'));
		v.path = 'b.json'; await v.reload();
		expect(v.contentEl.querySelectorAll('.lar-endpoint')).toHaveLength(1);
		expect(v.contentEl.querySelector('select')!.value).toBe('');
	});
	it('escapes Obsidian comment, math and highlight markup in endpoint notes', () => {
		const spec = parseSpec(JSON.stringify({ openapi: '3.0.3', paths: { '/a': { get: { description: '%%hidden%% $x$ ==mark== ^ref' } } } }));
		const note = endpointMarkdown(spec.endpoints[0]!, 'a.json');
		expect(note).not.toContain('%%');
		expect(note).not.toMatch(/(^|[^\\])\$/);
		expect(note).not.toContain('==');
	});
	it('drops the schema of a path parameter that an operation parameter replaces', () => {
		const spec = parseSpec(JSON.stringify({ openapi: '3.0.3', paths: { '/a/{id}': {
			parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
			get: { parameters: [{ name: 'id', in: 'path', schema: { type: 'integer' } }] } } } }));
		const e = spec.endpoints[0]!;
		expect(e.schemas.filter((s) => s.label === 'Parameter id')).toEqual([{ label: 'Parameter id', schema: { type: 'integer' } }]);
	});
	it('reads a JSON file that starts with a byte order mark', () => {
		expect(parseSpec('﻿{"openapi":"3.1.0","paths":{}}').version).toBe('3.1.0');
	});

	it('picker lists only JSON, YAML and YML files and filters by path text', () => {
		const app = App.createConfigured__({ files: { 'a/api.json': '{}', 'b.yaml': '', 'c.YML': '', 'note.md': '', 'img.png': '' } });
		const p = new LocalApiPlugin(app as never, manifest as never);
		p.addCommand = ((c: { callback: () => void }) => { (p as unknown as { cb: () => void }).cb = c.callback; }) as never;
		let modal: HTMLElement | null = null;
		vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) { this.onOpen(); modal = this.contentEl; });
		return p.onload().then(() => {
			(p as unknown as { cb: () => void }).cb();
			if (!modal) throw new Error('No modal');
			const names = () => [...modal.querySelectorAll('.setting-item-name')].map((n) => n.textContent);
			expect(names()).toEqual(['a/api.json', 'b.yaml', 'c.YML']);
			const search = modal.querySelector('input')!; search.value = 'API'; search.dispatchEvent(new Event('input'));
			expect(names()).toEqual(['a/api.json']);
		});
	});
	it('offers array items and hides Pro controls and saved bookmarks when Pro is off', async () => {
		const src = JSON.stringify({ openapi: '3.0.3', paths: { '/a': { get: { responses: { '200': { content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/P' } } } } } } } } }, components: { schemas: { P: { properties: { n: { type: 'string' } } } } } });
		const app = App.createConfigured__({ files: { 'a.json': src } });
		const p = new LocalApiPlugin(app as never, manifest as never);
		p.settings = { bookmarks: [{ source: 'a.json', endpoint: 'GET /a' }], filters: [{ name: 'F', tag: 'Untagged' }] };
		const v = new ReferenceView(p.app.workspace.getLeaf('tab'), p); v.path = 'a.json'; await v.reload();
		expect(v.contentEl.textContent).not.toContain('(Pro)');
		expect(v.contentEl.querySelector('.lar-saved-filter')).toBeNull();
		(v.contentEl.querySelector('.lar-schema-links button') as HTMLButtonElement).click();
		const items = [...v.contentEl.querySelectorAll('.lar-schema button')].find((b) => b.textContent === 'Open array items') as HTMLButtonElement;
		items.click();
		expect(v.contentEl.querySelector('.lar-schema')?.textContent).toContain('n: string');
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never); v.render();
		expect(v.contentEl.textContent).toContain('Bookmarks (Pro)');
		expect(v.contentEl.querySelector('.lar-saved-filter')?.textContent).toBe('F');
	});
});
