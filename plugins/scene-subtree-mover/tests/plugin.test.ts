import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFrontMatterInfo } from 'obsidian-test-mocks/obsidian';
import { resetPro, isPro, PRO_UI, SPONSORS, onProChange } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { checkedUpdate, readIndex, replaceScenes } from '../src/index-file';
import { checkRestore, moveTree, readTree, sceneChoices, treeLines, writeTree } from '../src/tree';
import { enablePro, fixture, sourceFor } from './fixtures';

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

describe('safe source transaction', () => {
	it('creates a full backup before one process write and keeps metadata', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 2 });
		const order: string[] = [];
		const create = f.app.vault.create.bind(f.app.vault);
		const process = f.app.vault.process.bind(f.app.vault);
		vi.spyOn(f.app.vault, 'create').mockImplementation(async (...args) => { order.push('backup'); return create(...args); });
		vi.spyOn(f.app.vault, 'process').mockImplementation(async (...args) => { order.push('process'); return process(...args); });
		const result = await f.plugin.applyPreview(preview);
		expect(order).toEqual(['backup', 'process']);
		expect(result.changed).toBe(true);
		expect(f.app.vault.getMarkdownFiles().map((file) => file.path)).toEqual(['Book/Index.md']);
		expect(result.backupPath).toMatch(/^Book\/Index\.scene-backup-.*\.md\.bak$/);
		expect(await f.app.vault.read(f.app.vault.getFileByPath(result.backupPath!)!)).toBe(f.source);
		const data = readIndex(await f.app.vault.read(f.file));
		expect(data.data.custom).toEqual({ progress: 12, note: 'Do not change' });
		expect(data.data.tags).toEqual(['draft', 'writing']);
		expect(data.longform.sceneFolder).toBe('Scenes');
	});

	it('does not write or back up an unchanged order', async () => {
		const f = fixture();
		const create = vi.spyOn(f.app.vault, 'create');
		const process = vi.spyOn(f.app.vault, 'process');
		expect(await f.plugin.applyPreview(await f.plugin.readPreview(f.file as never))).toEqual({ changed: false, backupPath: null });
		expect(create).not.toHaveBeenCalled();
		expect(process).not.toHaveBeenCalled();
	});

	it('rejects a renamed source before backup', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 1 });
		await f.app.vault.rename(f.file, 'Book/Renamed.md');
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('path changed');
		expect(await f.app.vault.read(f.file)).toBe(f.source);
		expect(f.app.vault.getFiles()).toHaveLength(1);
	});

	it('rejects a repeated click while a backup is pending', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 1 });
		let unblock!: () => void;
		let entered!: () => void;
		const gate = new Promise<void>((resolve) => { unblock = resolve; });
		const seen = new Promise<void>((resolve) => { entered = resolve; });
		const create = f.app.vault.create.bind(f.app.vault);
		vi.spyOn(f.app.vault, 'create').mockImplementation(async (...args) => { entered(); await gate; return create(...args); });
		const first = f.plugin.applyPreview(preview);
		await seen;
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('in progress');
		unblock();
		expect((await first).changed).toBe(true);
	});

	it('can retry after a failed backup', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 1 });
		vi.spyOn(f.app.vault, 'create').mockRejectedValueOnce(new Error('Disk full'));
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('Disk full');
		expect((await f.plugin.applyPreview(preview)).changed).toBe(true);
	});

	it('rejects a stale source in the synchronous checked update', () => {
		const original = sourceFor(['A', 'B']);
		expect(() => checkedUpdate(original + 'edit', original, readTree(['B', 'A']))).toThrow('Conflict:');
	});
});

describe('index data', () => {
	it.each(['\n', '\r\n'])('keeps the body text with %j line endings', (eol) => {
		const original = sourceFor(['A', ['a1'], 'B'], eol);
		const updated = replaceScenes(original, readTree(['B', 'A', ['a1']]));
		expect(updated.slice(getFrontMatterInfo(updated).contentStart)).toBe(original.slice(getFrontMatterInfo(original).contentStart));
		expect(readIndex(updated).longform.scenes).toEqual(['B', 'A', ['a1']]);
	});

	it('keeps unrelated YAML aliases separate from the scene replacement', () => {
		const original = '---\nlongform: &draft\n  scenes: [A, B]\ncopy: *draft\n---\nBody';
		const updated = readIndex(replaceScenes(original, readTree(['B', 'A'])));
		expect(updated.data.copy).toEqual({ scenes: ['A', 'B'] });
		expect(updated.longform.scenes).toEqual(['B', 'A']);
	});

	it('refuses an index with a whole number that a YAML write would change', async () => {
		const source = '---\nzotero: 12345678901234567890\nlongform:\n  scenes: [A, B]\n---\nBody';
		expect(() => readIndex(source)).toThrow('zotero');
		expect(() => replaceScenes(source, readTree(['B', 'A']))).toThrow('quotes');
		const f = fixture(['A', 'B'], source);
		await expect(f.plugin.readPreview(f.file as never)).rejects.toThrow('2^53');
		expect(readIndex('---\nzotero: "12345678901234567890"\nsafe: 9007199254740991\nlongform:\n  scenes: [A, B]\n---\nBody').data.safe).toBe(9007199254740991);
	});

	it.each(['# No frontmatter', '---\ntitle: Book\n---\nBody', '---\nlongform: null\n---\nBody', '---\nlongform:\n  scenes: false\n---\nBody'])('rejects unsupported index %j', (source) => {
		expect(() => readIndex(source)).toThrow();
	});

	it('rejects malformed YAML without a write', () => {
		expect(() => readIndex('---\nlongform: [\n---\nBody')).toThrow();
	});

	it('shows escaped scene text as plain text and identifies nested paths', () => {
		const tree = readTree(['<img src=x>', ['a1', ['x']], 'B']);
		expect(sceneChoices(tree)).toEqual([
			{ path: [0], label: '<img src=x>' },
			{ path: [0, 0], label: '<img src=x> / a1' },
			{ path: [0, 0, 0], label: '<img src=x> / a1 / x' },
			{ path: [1], label: 'B' },
		]);
		expect(treeLines(tree)).toEqual(['1. <img src=x>', '  1. a1', '    1. x', '2. B']);
	});

	it('rejects cycles and excessive depth and entry count', () => {
		const cycle: unknown[] = ['A']; cycle.push(cycle);
		expect(() => readTree(cycle)).toThrow('cycle');
		let deep: unknown[] = ['leaf'];
		for (let i = 0; i < 66; i++) deep = ['A', deep];
		expect(() => readTree(deep)).toThrow('too deep');
		expect(() => readTree(Array.from({ length: 10001 }, (_, i) => `Scene ${i}`))).toThrow('10000');
	});

	it('does not mutate the input when a scene moves', () => {
		const tree = readTree(['A', ['a1'], 'B']);
		const before = JSON.stringify(tree);
		moveTree(tree, { path: [0], position: 1 });
		expect(JSON.stringify(tree)).toBe(before);
	});
});

describe('saved orders and Pro access', () => {
	it('loads default data and rejects invalid stored orders', async () => {
		const f = fixture();
		await f.plugin.loadSettings();
		expect(f.plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ orders: [null, { name: 'Bad', indexPath: 'Index.md', savedAt: 'now', scenes: [5] }] })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});

	it('gates save, restore and several moves while leaving a single move free', async () => {
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		await expect(f.plugin.saveOrder('Draft', preview)).rejects.toThrow('needs Pro');
		expect(() => f.plugin.restoreOrder({ name: 'Draft', indexPath: preview.path, scenes: ['A'], savedAt: 'now' }, preview)).toThrow('needs Pro');
		preview.after = moveTree(preview.before, { path: [0], position: 1 });
		preview.proAction = true;
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('needs Pro');
		preview.proAction = false;
		expect((await f.plugin.applyPreview(preview)).changed).toBe(true);
	});

	it('saves the proposed order, replaces a matching name and reloads it', async () => {
		enablePro();
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 1 });
		await f.plugin.saveOrder(' Draft two ', preview);
		await f.plugin.saveOrder('Draft two', preview);
		expect(f.plugin.settings.orders).toHaveLength(1);
		expect(f.plugin.settings.orders[0]?.scenes).toEqual(['B', 'A', ['a1', ['x']], 'C']);
		expect(await f.app.vault.read(f.file)).toBe(f.source);
		f.plugin.settings = { orders: [] };
		await f.plugin.loadSettings();
		expect(f.plugin.settings.orders[0]?.name).toBe('Draft two');
	});

	it('refuses to save a stale preview and an empty name', async () => {
		enablePro();
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		await expect(f.plugin.saveOrder(' ', preview)).rejects.toThrow('order name');
		await f.app.vault.modify(f.file, f.source + 'edit');
		await expect(f.plugin.saveOrder('Draft', preview)).rejects.toThrow('Conflict:');
		expect(f.plugin.settings.orders).toEqual([]);
	});

	it('requires matching index path and topology to restore', async () => {
		enablePro();
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		const saved = { name: 'Original', indexPath: preview.path, scenes: writeTree(preview.before), savedAt: 'now' };
		expect(f.plugin.restoreOrder(saved, preview)).toEqual(preview.before);
		expect(() => f.plugin.restoreOrder({ ...saved, indexPath: 'Other.md' }, preview)).toThrow('index path');
		expect(() => checkRestore(preview.before, readTree(['A', 'B']))).toThrow('different scenes');
	});

	it('cancels a Pro update if access ends during backup creation', async () => {
		const state = enablePro();
		const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 1 });
		preview.proAction = true;
		const create = f.app.vault.create.bind(f.app.vault);
		vi.spyOn(f.app.vault, 'create').mockImplementation(async (...args) => { const backup = await create(...args); state.set(false); return backup; });
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('needs Pro');
		expect(await f.app.vault.read(f.file)).toBe(f.source);
	});

	it('checks Pro again inside a queued process callback', async () => {
		const state = enablePro(); const f = fixture();
		const preview = await f.plugin.readPreview(f.file as never);
		preview.after = moveTree(preview.before, { path: [0], position: 1 }); preview.proAction = true;
		const process = f.app.vault.process.bind(f.app.vault);
		vi.spyOn(f.app.vault, 'process').mockImplementation(async (...args) => { state.set(false); return process(...args); });
		await expect(f.plugin.applyPreview(preview)).rejects.toThrow('needs Pro');
		expect(await f.app.vault.read(f.file)).toBe(f.source);
	});

	it('uses the reference Sponsors config and releases Pro listeners', () => {
		expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
		expect(PRO_UI.priceText).toContain('$5 a month, or $15 once');
		const state = enablePro(); const listener = vi.fn(); const stop = onProChange(listener);
		state.set(false); expect(listener).toHaveBeenCalledTimes(1); expect(isPro()).toBe(false);
		stop(); state.set(true); expect(listener).toHaveBeenCalledTimes(1);
		resetPro(); expect(isPro()).toBe(false);
	});
});
