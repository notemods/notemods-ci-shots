import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { convert } from '../src/convert';

describe('parser security advisories', () => {
	it('converts valid TOML after thousands of comments without a stack overflow', () => {
		// GHSA-v3rj-xjv7-4jmq: skipping comments must not recurse once per line.
		const input = '# comment\n'.repeat(8000) + 'name = "Ada"\ncount = 3';
		expect(JSON.parse(convert(input, 'toml', 'json').text)).toEqual({ name: 'Ada', count: 3 });
	});

	it.each(['a=[1 #', 'a={b=1 #'])('rejects an unterminated final comment promptly: %s', (input) => {
		// GHSA-7w5x-hrqm-74c2: isolate the parser so a regression cannot hang Vitest.
		const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
			import assert from 'node:assert/strict';
			import { parse, TomlError } from 'smol-toml';
			assert.throws(() => parse(${JSON.stringify(input)}), TomlError);
		`], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 });
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(() => convert(input, 'toml', 'json')).toThrow();
	});

	it('reports deeply nested YAML as a controlled parse error', () => {
		// GHSA-48c2-rrv3-qjmp: composition must not leak a native RangeError.
		const input = '['.repeat(5000) + '1' + ']'.repeat(5000);
		const doc = parseDocument(input);
		expect(doc.errors[0]?.name).toBe('YAMLParseError');
		expect(doc.errors[0]?.code).toBe('RESOURCE_EXHAUSTION');
		expect(() => convert(input, 'yaml', 'json')).toThrow();
	});
});
