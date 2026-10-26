import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import DataFormatConverterPlugin from '../src/main';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { ConversionModal, BatchModal, SchemaModal } from '../src/ui';
import { checkData, equalData, MAX_INPUT, convert } from '../src/convert';
import { codeBlocks } from '../src/batch';
import { validateSchema } from '../src/schema';
import manifest from '../manifest.json';
import type { Editor } from 'obsidian';

afterEach(() => resetPro());
function fixture(text = 'name: Ada') {
	const app = App.createConfigured__({ files: { 'Schemas/person.json': '{"type":"object","required":["name"]}' } });
	const plugin = new DataFormatConverterPlugin(app as never, manifest as never);
	let value = text;
	const editor = { getValue: () => value, getSelection: () => value, getCursor: (side: string) => ({ line: 0, ch: side === 'from' ? 0 : value.length }), getRange: () => value, replaceRange: (out: string) => { value = out; } } as unknown as Editor;
	return { plugin, editor, text: () => value, set: (s: string) => { value = s; } };
}
function pro(enabled: boolean) { bindPro({ isPro: () => enabled, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' }, onChange: () => () => undefined } as never); }

describe('modal safety', () => {
	it('cancel closes without an editor write', () => { const f = fixture(); const m = new ConversionModal(f.plugin, f.editor); m.onOpen(); m.onClose(); expect(f.text()).toBe('name: Ada'); expect(f.plugin.modals.size).toBe(0); });
	it('changed source blocks replacement in the modal', () => { const f = fixture(); const m = new ConversionModal(f.plugin, f.editor); m.onOpen(); f.set('name: Bea'); m.replace(); expect(f.text()).toBe('name: Bea'); expect(m.contentEl.textContent).toContain('Source changed'); m.onClose(); });
	it('a null error disables replacement', () => { const f = fixture('{"a":null}'); const m = new ConversionModal(f.plugin, f.editor); m.source = 'json'; m.target = 'toml'; m.onOpen(); expect(m.output).toBeNull(); expect(m.contentEl.querySelector('button')?.disabled).toBe(true); m.replace(); expect(f.text()).toBe('{"a":null}'); m.onClose(); });
	it('Pro off blocks schema and file creation', async () => { const f = fixture('```yaml\nname: Ada\n```'); pro(false); expect(f.plugin.requirePro()).toBe(false); const m = new BatchModal(f.plugin, f.editor); m.onOpen(); m.chosen.add(1); m.previewBatch(); const create = vi.spyOn(f.plugin.app.vault, 'create'); await m.createFiles(); expect(create).not.toHaveBeenCalled(); m.onClose(); });
	it('Pro creates previewed files and keeps the source note', async () => { const f = fixture('```yaml\nname: Ada\n```\n```toml\ncount = 3\n```'); pro(true); const m = new BatchModal(f.plugin, f.editor); m.onOpen(); m.chosen.add(1); m.chosen.add(2); m.previewBatch(); await m.createFiles(); const a = f.plugin.app.vault.getFileByPath('Converted block 1.json'); expect(a).not.toBeNull(); expect(JSON.parse(await f.plugin.app.vault.read(a!))).toEqual({ name: 'Ada' }); expect(f.text()).toContain('```yaml'); m.onClose(); });
	it('changed source blocks a batch before creating a file', async () => { const f = fixture('```yaml\nname: Ada\n```'); pro(true); const m = new BatchModal(f.plugin, f.editor); m.onOpen(); m.chosen.add(1); m.previewBatch(); f.set('changed'); await m.createFiles(); expect(f.plugin.app.vault.getFileByPath('Converted block 1.json')).toBeNull(); expect(m.contentEl.textContent).toContain('Source changed'); m.onClose(); });
	it('a file collision disables the batch without overwrite', async () => { const f = fixture('```yaml\nname: Ada\n```'); pro(true); await f.plugin.app.vault.create('Converted block 1.json', 'keep'); const m = new BatchModal(f.plugin, f.editor); m.onOpen(); m.chosen.add(1); m.previewBatch(); expect(m.items).toEqual([]); expect(m.contentEl.textContent).toContain('File already exists'); m.onClose(); });
	it('local schema command reads a vault file', async () => { const f = fixture('{"name":"Ada"}'); pro(true); const m = new SchemaModal(f.plugin, f.editor); m.onOpen(); m.path = 'Schemas/person.json'; await m.validate(); expect(m.contentEl.textContent).toContain('JSON matches'); expect(f.text()).toBe('{"name":"Ada"}'); m.onClose(); });
	it('sign out after preview blocks file creation', async () => { const f = fixture('```yaml\nname: Ada\n```'); pro(true); const m = new BatchModal(f.plugin, f.editor); m.onOpen(); m.chosen.add(1); m.previewBatch(); pro(false); await m.createFiles(); expect(f.plugin.app.vault.getFileByPath('Converted block 1.json')).toBeNull(); m.onClose(); });
});
describe('conversion limits', () => {
	it('rejects a large selection', () => expect(() => convert('x'.repeat(MAX_INPUT + 1), 'yaml', 'json')).toThrow('larger'));
	it('rejects dates, sets and undefined', () => { for (const v of [new Date(), new Set(), undefined]) expect(() => checkData(v, 'json')).toThrow(); });
	it('detects a missing key and changed type', () => { expect(equalData({ a: 1 }, {})).toBe(false); expect(equalData({ a: 1 }, { a: '1' })).toBe(false); });
	it('rejects schema external refs without a loader', () => expect(() => validateSchema({}, '{"$ref":"https://example.invalid/schema"}')).toThrow('local fragments'));
	it('checks a local schema fragment without modifying data', () => { const data = { n: '3' }; expect(validateSchema(data, '{"definitions":{"n":{"type":"number"}},"type":"object","properties":{"n":{"$ref":"#/definitions/n"}}}')).toEqual(['/n: is not of a type(s) number']); expect(data.n).toBe('3'); });
	it('recognizes matching tilde fences and ignores unclosed blocks', () => { expect(codeBlocks('~~~yml\na: 1\n~~~\n```json\n{}')).toHaveLength(1); });
	it('the Sponsors terms match the reference', () => { expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15 }); expect(isPro()).toBe(false); });
});
