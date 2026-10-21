import { describe, expect, it } from 'vitest';
import vectors from './vectors/yaml-json-toml-converter.json';
import { convert, parseData, COMMENT_WARNING, type Format, type Data } from '../src/convert';
import { batchPreview, codeBlocks } from '../src/batch';
import { validateSchema } from '../src/schema';
import { replaceGuarded } from '../src/selection';
import type { Editor } from 'obsidian';

interface Vector { name: string; kind?: string; args: unknown[]; expected: { data?: unknown; error?: string; text?: string; errors?: string[]; files?: string[] } }
function run(c: Vector): unknown {
	if (c.kind === 'guard' || c.kind === 'cancel') {
		const [source, current, output] = c.args as string[];
		let text = c.kind === 'cancel' ? source! : current!;
		const editor = { getValue: () => text, getRange: () => text, replaceRange: (out: string) => { text = out; } } as unknown as Editor;
		if (c.kind === 'guard') replaceGuarded(editor, { source: source!, document: source!, from: { line: 0, ch: 0 }, to: { line: 0, ch: source!.length } }, output!);
		return { text };
	}
	if (c.kind === 'schema') return { errors: validateSchema(c.args[0] as Data, c.args[1] as string) };
	if (c.kind === 'batch') {
		const target = c.args[1] as Format;
		const items = batchPreview(codeBlocks(c.args[0] as string), target);
		return { files: items.map((b) => b.path), data: items.map((b) => parseData(b.text, target)) };
	}
	const [input, source, target] = c.args as [string, Format, Format];
	const result = convert(input, source, target);
	expect(result.warning).toBe(COMMENT_WARNING);
	return { data: result.data };
}
describe('golden acceptance vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases as Vector[]) it(c.name, () => {
		if (c.expected.error) expect(() => run(c)).toThrow(c.expected.error);
		else expect(run(c)).toEqual(c.expected);
	});
});
