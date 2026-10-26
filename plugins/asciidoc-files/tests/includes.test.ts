import { describe, expect, it } from 'vitest';
import vectors from './vectors/asciidoc-files.json';
import { MAX_DEPTH, MAX_INCLUDES, expandIncludes, expandWithReader, parseIncludeAttrs, parseLineRanges, pickTags } from '../src/adoc/includes';

type Args = Parameters<typeof expandIncludes>;

describe('golden vectors (packages/spec/vectors/asciidoc-files.json)', () => {
	for (const c of vectors.cases) {
		it(c.name, () => {
			expect(expandIncludes(...(c.args as unknown as Args))).toEqual(c.expected);
		});
	}
});

describe('include attributes', () => {
	it('splits on commas outside quotes and lowercases keys', () => {
		expect(parseIncludeAttrs('lines="1..3,5", TAG=x, opts=optional')).toEqual({ lines: '1..3,5', tag: 'x', opts: 'optional' });
	});
	it('reads open ranges and drops bad parts', () => {
		expect(parseLineRanges('1;4..-1;7..;x;9..3')).toEqual([
			[1, 1],
			[4, Infinity],
			[7, Infinity],
		]);
	});
	it('tags: negation alone keeps everything else, ** keeps untagged lines, * keeps tagged lines only', () => {
		const lines = ['a', '// tag::x[]', 'x1', '// end::x[]', '// tag::y[]', 'y1', '// end::y[]', 'b'];
		expect(pickTags(lines, '!x')).toEqual(['a', 'y1', 'b']);
		expect(pickTags(lines, '**')).toEqual(['a', 'x1', 'y1', 'b']);
		expect(pickTags(lines, '*')).toEqual(['x1', 'y1']);
		expect(pickTags(lines, 'x;y')).toEqual(['x1', 'y1']);
	});
});

describe('expandWithReader', () => {
	it('reads nested includes level by level from an async vault', async () => {
		const vault: Record<string, string> = { 'a.adoc': 'A\ninclude::b.adoc[]', 'b.adoc': 'B\ninclude::sub/c.adoc[]', 'sub/c.adoc': 'C' };
		const reads: string[] = [];
		const r = await expandWithReader('Top\ninclude::a.adoc[]', 'top.adoc', (p) => (reads.push(p), Promise.resolve(vault[p] ?? null)));
		expect(r.text).toBe('Top\nA\nB\nC');
		expect(r.includes.map((i) => i.status)).toEqual(['ok', 'ok', 'ok']);
		expect(reads).toEqual(['a.adoc', 'b.adoc', 'sub/c.adoc']);
	});
	it('a self-including file stops at the cycle without a read', async () => {
		let reads = 0;
		const r = await expandWithReader('include::self.adoc[]', 'self.adoc', () => (reads++, Promise.resolve('x')));
		expect(r.includes[0]?.status).toBe('cycle');
		expect(reads).toBe(0);
	});
	it('an include bomb stops at the include cap', () => {
		const files: Record<string, string> = { 'b.adoc': Array.from({ length: 40 }, () => 'include::c.adoc[]').join('\n'), 'c.adoc': Array.from({ length: 40 }, () => 'x').join('\n') };
		const r = expandIncludes(Array.from({ length: 40 }, () => 'include::b.adoc[]').join('\n'), 'a.adoc', files);
		expect(r.includes.length).toBeLessThanOrEqual(MAX_INCLUDES + 1);
		expect(r.includes.some((i) => i.status === 'depth')).toBe(true);
	});
	it('clamps maxDepth to 1..8', () => {
		const r = expandIncludes('include::b.adoc[]', 'a.adoc', { 'b.adoc': 'B' }, { maxDepth: 99 });
		expect(r.includes[0]?.status).toBe('ok');
		expect(MAX_DEPTH).toBe(8);
	});
});
