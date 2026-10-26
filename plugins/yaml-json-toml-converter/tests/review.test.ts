import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import type { Editor } from 'obsidian';
import DataFormatConverterPlugin from '../src/main';
import { ConversionModal } from '../src/ui';
import { convert, fitLineEnd } from '../src/convert';
import { codeBlocks } from '../src/batch';
import manifest from '../manifest.json';

describe('review defects', () => {
	it('rejects decimals that a JavaScript number rounds', () => {
		expect(() => convert('a: 19.999999999999999999', 'yaml', 'json')).toThrow('more digits');
		expect(() => convert('{"a": 0.1000000000000000000001}', 'json', 'yaml')).toThrow('more digits');
		expect(() => convert('a = 12345678.123456789012345', 'toml', 'json')).toThrow('more digits');
	});
	it('keeps decimals that a JavaScript number holds exactly', () => {
		expect(convert('a: 1.10\nb: 0.30000000000000004\nc: 5e-324\nd: 1.0e2\ne: -2.5', 'yaml', 'json').data).toEqual({ a: 1.1, b: 0.30000000000000004, c: 5e-324, d: 100, e: -2.5 });
		expect(convert('a = 1_000.25', 'toml', 'json').data).toEqual({ a: 1000.25 });
	});
	it('does not keep integer and float types apart, as the README states', () => {
		expect(convert('a = 1.0', 'toml', 'toml').text).toBe('a = 1');
	});
	it('keeps the line end of the selection', () => {
		expect(fitLineEnd('{\n  "a": 1\n}', 'a: 1\n', 'json')).toBe('{\n  "a": 1\n}\n');
		expect(fitLineEnd('a: 1\n', '{"a":1}', 'yaml')).toBe('a: 1');
		expect(fitLineEnd('a: |+\n  x\n\n', '{"a":"x\\n\\n"}', 'yaml')).toBe('a: |+\n  x\n\n');
	});
	it('a JSON replacement does not join the closing fence', () => {
		const app = App.createConfigured__({});
		const plugin = new DataFormatConverterPlugin(app as never, manifest as never);
		let doc = '```yaml\nname: Ada\n```';
		const from = { line: 1, ch: 0 };
		const to = { line: 2, ch: 0 };
		const editor = { getValue: () => doc, getSelection: () => 'name: Ada\n', getCursor: (s: string) => (s === 'from' ? from : to), getRange: () => 'name: Ada\n', replaceRange: (out: string) => { doc = `\`\`\`yaml\n${out}\`\`\``; } } as unknown as Editor;
		const m = new ConversionModal(plugin, editor);
		m.onOpen();
		m.replace();
		expect(doc).toBe('```yaml\n{\n  "name": "Ada"\n}\n```');
	});
	it('a fence with an info string does not hide the next block', () => {
		const blocks = codeBlocks('```yaml title="a"\na: 1\n```\n```json\n{"b":2}\n```');
		expect(blocks.map((b) => [b.source, b.text])).toEqual([['yaml', 'a: 1'], ['json', '{"b":2}']]);
		expect(codeBlocks('```js\nlet a = 1\n```\n```toml\nb = 2\n```').map((b) => b.text)).toEqual(['b = 2']);
	});
});
