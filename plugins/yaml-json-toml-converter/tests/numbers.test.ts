import { describe, expect, it } from 'vitest';
import { convert } from '../src/convert';
describe('numeric token checks', () => {
	it('retains zero and string tokens in TOML', () => expect(convert('n = 0e-999\ntext = "1e-999"\nliteral = \'-0\'', 'toml', 'json').data).toEqual({ n: 0, text: '1e-999', literal: '-0' }));
	it('ignores numeric bare keys and comments', () => expect(convert('-0 = 3\n# 1e-999\n[1e-999]\nn = 0', 'toml', 'json').data).toEqual({ '-0': 3, '1e-999': { n: 0 } }));
	it('rejects underflow inside arrays and inline tables', () => { for (const text of ['a = [1e-999]', 'a = { n = 1e-999 }', 'a = [\n [1e-999]\n]']) expect(() => convert(text, 'toml', 'json')).toThrow('underflows'); });
	it('ignores multiline basic and literal string contents', () => expect(convert('a = """1e-999\n-0"""\nb = \'\'\'1e-999\n-0\'\'\'', 'toml', 'json').data).toEqual({ a: '1e-999\n-0', b: '1e-999\n-0' }));
	it('retains quoted numeric-looking YAML values', () => expect(convert('a: "-0"\nb: "1e-999"', 'yaml', 'json').data).toEqual({ a: '-0', b: '1e-999' }));
});
