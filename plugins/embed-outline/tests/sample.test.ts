import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildOutline, outlineLines } from '../src/outline';
import { FREE, MANUSCRIPT_FREE, MANUSCRIPT_PRO, PRO } from './sample-expect';
import { fakeSource } from './scan';

// The sample vault of the README, the screenshots and the e2e test (test/e2e/vault/Embed Outline is a copy).
// test/e2e/outline.e2e.ts expects the same rows from the app's metadata cache.
const DIR = join(__dirname, '..', 'docs', 'sample-notes');

function readAll(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (d: string): void => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else out[`Embed Outline/${relative(DIR, p)}`] = readFileSync(p, 'utf8');
		}
	};
	walk(dir);
	return out;
}

describe('sample notes', () => {
	const files = readAll(DIR);
	it('free outline of the manuscript', () => {
		const o = buildOutline('Embed Outline/Manuscript.md', fakeSource(files), FREE);
		expect(outlineLines(o.items)).toEqual(MANUSCRIPT_FREE);
		expect([o.embeds, o.locked, o.broken]).toEqual([5, 1, 0]);
	});
	it('pro outline of the manuscript', () => {
		const o = buildOutline('Embed Outline/Manuscript.md', fakeSource(files), PRO);
		expect(outlineLines(o.items)).toEqual(MANUSCRIPT_PRO);
		expect([o.embeds, o.locked, o.broken, o.words]).toEqual([5, 0, 1, 439]);
	});
});
