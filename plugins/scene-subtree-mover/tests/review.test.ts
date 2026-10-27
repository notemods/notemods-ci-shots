import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneMoverModal } from '../src/modal';
import { resetPro } from '../src/pro';
import { checkRestore, moveTree, readTree, type SceneArray } from '../src/tree';
import { enablePro, fixture } from './fixtures';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('review regressions', () => {
	it('checks a restore at the supported depth without exponential strings', () => {
		let scenes: SceneArray = ['leaf', 'sibling'];
		for (let i = 0; i < 64; i++) scenes = [`Level ${i}`, scenes];
		const current = readTree(scenes);
		const saved = moveTree(current, { path: Array(65).fill(0), position: 1 });
		// Stop the old implementation before its repeated escaping exhausts memory.
		const stringify = JSON.stringify;
		vi.spyOn(JSON, 'stringify').mockImplementation((value) => {
			const text = stringify(value);
			if (text.length > 100000) throw new Error('Restore comparison exceeds the test memory limit');
			return text;
		});
		expect(() => checkRestore(current, saved)).not.toThrow();
		let leaf = saved;
		for (let i = 0; i < 64; i++) leaf = leaf[0]!.children!;
		leaf[0]!.name = 'different';
		expect(() => checkRestore(current, saved)).toThrow('different scenes');
	});

	it('keeps both orders when two mover windows save at the same time', async () => {
		enablePro();
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		await Promise.all([f.plugin.saveOrder('First', preview), f.plugin.saveOrder('Second', preview)]);
		await f.plugin.loadSettings();
		expect(f.plugin.settings.orders.map((order) => order.name)).toEqual(['First', 'Second']);
	});

	it('continues the save queue after a failed save', async () => {
		enablePro();
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		vi.spyOn(f.plugin, 'saveData').mockRejectedValueOnce(new Error('Disk full'));
		const results = await Promise.allSettled([f.plugin.saveOrder('Failed', preview), f.plugin.saveOrder('Kept', preview)]);
		expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
		await f.plugin.loadSettings();
		expect(f.plugin.settings.orders.map((order) => order.name)).toEqual(['Kept']);
	});

	it('moves and restores a tree with 10000 entries', () => {
		const current = readTree(Array.from({ length: 10000 }, (_, i) => `Scene ${i}`));
		const saved = moveTree(current, { path: [0], position: 9999 });
		expect(saved[9999]!.name).toBe('Scene 0');
		expect(() => checkRestore(current, saved)).not.toThrow();
	});

	it('does not open a pending mover after plugin unload', async () => {
		const f = fixture();
		const opened = vi.spyOn(SceneMoverModal.prototype, 'open').mockImplementation(() => undefined);
		const pending = f.plugin.openMover(f.file as never);
		f.plugin.onunload();
		await pending;
		expect(opened).not.toHaveBeenCalled();
	});

	it('does not start a refresh timer when layout becomes ready after unload', async () => {
		const f = fixture();
		let ready!: () => unknown;
		vi.spyOn(f.app.workspace, 'onLayoutReady').mockImplementation((callback) => { ready = callback; });
		await f.plugin.onload();
		const refresh = vi.spyOn(f.plugin.pro!, 'refresh');
		const interval = vi.spyOn(window, 'setInterval').mockReturnValue(1);
		f.plugin.onunload();
		ready();
		expect(refresh).not.toHaveBeenCalled();
		expect(interval).not.toHaveBeenCalled();
	});

	it('does not write the index if the plugin unloads while the backup is made', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 1 });
		const create = f.app.vault.create.bind(f.app.vault);
		vi.spyOn(f.app.vault, 'create').mockImplementation(async (...args) => {
			const backup = await create(...args);
			f.plugin.onunload();
			return backup;
		});
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('unloaded');
		expect(await f.app.vault.read(f.file)).toBe(f.source);
	});
});
