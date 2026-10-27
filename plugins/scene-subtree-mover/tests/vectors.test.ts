import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from './vectors/scene-subtree-mover.json';
import { checkRestore, moveAfter, moveTree, readTree, writeTree, moveSubtree, type SubtreeMove } from '../src/tree';
import { applyFixture } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('verified acceptance vectors', () => {
	for (const vector of vectors.cases) it(vector.name, async () => {
		const args = vector.args as unknown[];
		let result: unknown;
		try {
			switch (vector.function) {
				case 'readTree': result = writeTree(readTree(args[0])); break;
				case 'moveSubtree': result = writeTree(moveSubtree(readTree(args[0]), args[1] as SubtreeMove)); break;
				case 'moveTree': result = writeTree(moveTree(readTree(args[0]), args[1] as { path: number[]; position: number })); break;
				case 'moveAfter': result = writeTree(moveAfter(readTree(args[0]), args[1] as number[], args[2] as number[])); break;
				case 'checkRestore': checkRestore(readTree(args[0]), readTree(args[1])); result = true; break;
				case 'batch': {
					let tree = readTree(args[0]);
					for (const move of args[1] as { path: number[]; position: number }[]) tree = moveTree(tree, move);
					result = writeTree(tree); break;
				}
				case 'applyPreview': result = await applyFixture(args[0] as Parameters<typeof applyFixture>[0]); break;
				default: throw new Error(`Unknown vector function ${vector.function}`);
			}
		} catch (error) { result = { error: (error as Error).message }; }
		expect(result).toEqual(vector.expected);
	});
});
