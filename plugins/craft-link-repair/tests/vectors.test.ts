import { describe, it, expect } from 'vitest';
import vectors from './vectors/craft-link-repair.json';
import { planRepair, type RepairOptions, type SourceFile } from '../src/repair';

describe('acceptance vectors', () => {
	for (const test of vectors.cases) it(test.name, () => {
		const [files, options] = test.args;
		expect(planRepair(files as SourceFile[], options as RepairOptions)).toEqual(test.expected);
	});
});
