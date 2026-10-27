import data from './vectors/zettelkasten-archive-import.json';
import { describe, it, expect } from 'vitest';
import { inspectXml } from '../src/parser';
import { compareXml, convertMarkup, renderXml } from '../src/model';
import { inspectZipBase64 } from '../src/archive';

const vectors = data as { cases: { name: string; function: string; args: unknown[]; expected: unknown }[] };
const functions: Record<string, (...args: never[]) => unknown> = {
	inspectXml, renderXml, compareXml, inspectZipBase64,
	convertMarkup: ((text: string, names: [number, string][]) => convertMarkup(text, new Map(names))) as never,
};
describe('golden acceptance vectors', () => {
	it('has 20 or more cases', () => { expect(vectors.cases.length).toBeGreaterThanOrEqual(20); });
	for (const c of vectors.cases) it(c.name, () => {
		expect(functions[c.function]!(...c.args as never[])).toEqual(c.expected);
	});
});
