import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { localCsvOnly } from '../build/papa-local.mjs';
import vectors from './vectors/substack-export-import.json';

describe('local CSV build', () => {
	it('keeps CSV field parsing and removes the request transport', async () => {
		const output = await build({ stdin: { contents: "import Papa from 'papaparse'; export default Papa;", resolveDir: process.cwd(), loader: 'js' }, plugins: [localCsvOnly], bundle: true, define: { PAPA_BROWSER_CONTEXT: 'true' }, write: false, format: 'esm', platform: 'browser' });
		const text = output.outputFiles[0]!.text; expect(text).not.toContain('XMLHttpRequest'); expect(text).not.toContain('require("stream")');
		const path = `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
		const shipped = await import(/* @vite-ignore */ path) as { default: { parse: (csv: string, config: unknown) => unknown } };
		const original = await import('papaparse');
		for (const test of vectors.cases) {
			const members = test.args[0] as Record<string, string>;
			if (typeof members['posts.csv'] !== 'string') continue;
			const config = { delimiter: ',', skipEmptyLines: 'greedy', worker: false };
			expect(shipped.default.parse(members['posts.csv'], config)).toEqual(original.default.parse(members['posts.csv'], config));
		}
		expect(() => shipped.default.parse('https://example.test/posts.csv', { download: true })).toThrow('Remote CSV is not supported');
	});
});
