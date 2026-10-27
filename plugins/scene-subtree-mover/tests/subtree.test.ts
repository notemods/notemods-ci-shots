import { afterEach, describe, expect, it, vi } from 'vitest';
import { readIndex } from '../src/index-file';
import { resetPro } from '../src/pro';
import { checkRestore, moveSubtree, readTree, writeTree, type SceneArray } from '../src/tree';
import { fixture } from './fixtures';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('moves between parent groups', () => {
	it('keeps the input tree when a move succeeds or fails', () => {
		const tree = readTree(['A', ['a1', ['x']], 'B']);
		const original = writeTree(tree);
		expect(writeTree(moveSubtree(tree, { path: [0], parent: [1], position: 0 }))).toEqual(['B', ['A', ['a1', ['x']]]]);
		expect(() => moveSubtree(tree, { path: [0], parent: [0, 0], position: 0 })).toThrow('descendants');
		expect(writeTree(tree)).toEqual(original);
	});
	it('rejects a move beyond the depth limit without changing the input', () => {
		let scenes: SceneArray = ['leaf'];
		for (let i = 0; i < 64; i++) scenes = [`Level ${i}`, scenes];
		scenes.push('Moved', ['child']);
		const tree = readTree(scenes);
		expect(() => moveSubtree(tree, { path: [1], parent: Array(65).fill(0), position: 0 })).toThrow('too deep');
		expect(writeTree(tree)).toEqual(scenes);
	});
	it('rejects a new child array beyond the entry limit', () => {
		const scenes = Array.from({ length: 10000 }, (_, i) => `Scene ${i}`);
		const tree = readTree(scenes);
		expect(() => moveSubtree(tree, { path: [0], parent: [1], position: 0 })).toThrow('10000');
		expect(writeTree(tree)).toEqual(scenes);
	});
	it('keeps saved restore checks strict after a parent change', () => {
		const tree = readTree(['A', ['a1'], 'B']);
		const moved = moveSubtree(tree, { path: [0, 0], parent: [1], position: 0 });
		expect(() => checkRestore(moved, tree)).toThrow('parent relationships');
	});
	it('applies a free parent change with one exact backup and one checked write', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveSubtree(preview.before, { path: [0, 0], parent: [1], position: 0 });
		const process = vi.spyOn(f.app.vault, 'process');
		const create = vi.spyOn(f.app.vault, 'create');
		const result = await f.plugin.applyPreview(preview);
		expect(result.changed).toBe(true);
		expect(create).toHaveBeenCalledTimes(1);
		expect(process).toHaveBeenCalledTimes(1);
		expect(await f.app.vault.read(f.app.vault.getFileByPath(result.backupPath!)!)).toBe(f.source);
		expect(readIndex(await f.app.vault.read(f.file)).longform.scenes).toEqual(['A', [], 'B', ['a1', ['x']], 'C']);
	});
	it('keeps an external edit made during the backup', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveSubtree(preview.before, { path: [0], parent: [1], position: 0 });
		const create = f.app.vault.create.bind(f.app.vault);
		vi.spyOn(f.app.vault, 'create').mockImplementation(async (...args) => {
			const backup = await create(...args);
			await f.app.vault.modify(f.file, f.source + '\nExternal edit.\n');
			return backup;
		});
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('Conflict:');
		expect(await f.app.vault.read(f.file)).toBe(f.source + '\nExternal edit.\n');
	});
});
