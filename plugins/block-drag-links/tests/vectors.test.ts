import { describe, expect, it } from 'vitest';
import vectors from './vectors/block-drag-links.json';
import { applyInsertion, blocksInRange, buildLink, collectIds, findBlock, headingSubpath, idInsertion, newBlockId, readableBlockId } from '../src/blocks';

/** A random source that returns the numbers of seq in a loop. */
function seqRand(seq: number[]): () => number {
	let i = 0;
	return () => seq[i++ % seq.length] ?? 0;
}

const fns: Record<string, (...args: never[]) => unknown> = {
	findBlock,
	idInsertion,
	applyInsertion,
	headingSubpath,
	buildLink,
	readableBlockId,
	blocksInRange,
	collectIds,
	newBlockId: ((taken: string[], seq: number[]) => newBlockId(taken, seqRand(seq))) as never,
};

describe('golden vectors (packages/spec/vectors/block-drag-links.json)', () => {
	it('covers acceptance cases A1 to A9', () => {
		for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(40);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[])) ?? null).toEqual(c.expected);
		});
	}
});
