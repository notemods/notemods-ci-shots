import { beforeEach, describe, expect, it, vi } from 'vitest';
import BasesMultiEditPlugin from '../src/main';
import { CHANGED_FILE, applyChanges, transform, type Action, type Stamp } from '../src/edit';
import { previewChanges } from '../src/preview';
import { normalizeSettings } from '../src/settings';
import { bindPro } from '../src/pro';

interface Note { data: Record<string, unknown>; body: string; mtime: number }
const size = (n: Note): number => JSON.stringify(n.data).length + n.body.length;

/** A small vault that acts like processFrontMatter: read, callback, then write and change mtime. A throw writes nothing. */
function vault(count: number) {
	const notes = new Map<string, Note>();
	for (let i = 0; i < count; i++) notes.set(`Notes/${i}.md`, { data: { tags: i % 3 ? ['project', `n${i}`] : 'project', status: 'todo' }, body: `Body ${i}`, mtime: 1000 });
	let clock = 2000;
	const writes: string[] = [];
	let beforeWrite: (path: string) => void = () => undefined;
	const stamp = (path: string): Stamp | null => { const n = notes.get(path); return n ? { mtime: n.mtime, size: size(n) } : null; };
	const processFrontMatter = async (path: string, fn: (data: Record<string, unknown>) => void): Promise<void> => {
		beforeWrite(path);
		const n = notes.get(path);
		if (!n) throw new Error('Markdown note no longer exists');
		const copy = structuredClone(n.data);
		fn(copy);
		n.data = copy; n.mtime = clock++; writes.push(path);
	};
	/** Another device writes the note: new body, new mtime. */
	const sync = (path: string): void => { const n = notes.get(path)!; n.body += ' synced'; n.mtime = clock++; };
	return { notes, writes, stamp, processFrontMatter, sync, onWrite: (f: (path: string) => void) => { beforeWrite = f; } };
}
type Vault = ReturnType<typeof vault>;

function plugin(v: Vault): BasesMultiEditPlugin {
	const app = {
		vault: { getFileByPath: (path: string) => v.notes.has(path) ? { path, extension: 'md', stat: v.stamp(path) } : null },
		fileManager: { processFrontMatter: (file: { path: string }, fn: (data: Record<string, unknown>) => void) => v.processFrontMatter(file.path, fn) },
	};
	const host = { app, settings: { actions: [] }, history: [], busy: false, stopped: false, dialogs: new Set() };
	return Object.assign(Object.create(BasesMultiEditPlugin.prototype), host) as BasesMultiEditPlugin;
}
const tagAction = (patch: Partial<Action> = {}): Action => ({ property: 'tags', operation: 'append', type: 'list', input: '["review"]', ...patch });
const plan = (v: Vault, action: Action) => previewChanges([...v.notes.keys()], action, async path => structuredClone(v.notes.get(path)!.data), v.stamp);

beforeEach(() => bindPro(null));

describe('500 notes in one batch', () => {
	it('500 notes change and one undo restores all', async () => {
		const v = vault(500), p = plugin(v);
		const original = structuredClone([...v.notes.values()].map(n => n.data));
		const preview = await plan(v, tagAction());
		expect(preview.changes).toHaveLength(500);
		expect(v.writes).toEqual([]);
		const message = await p.apply(tagAction(), preview.changes);
		expect(message).toContain('500 notes changed. 0 skipped.');
		expect([...v.notes.values()].every(n => Array.isArray(n.data.tags) && n.data.tags.at(-1) === 'review')).toBe(true);
		expect(p.history).toHaveLength(1);
		expect(await p.undo()).toContain('500 notes restored. 0 skipped.');
		expect([...v.notes.values()].map(n => n.data)).toEqual(original);
		expect(p.history).toEqual([]);
	});
	it('replace renames one tag in 500 notes and undo restores all', async () => {
		const v = vault(500), p = plugin(v);
		const original = structuredClone([...v.notes.values()].map(n => n.data));
		const action = tagAction({ operation: 'replace-items', find: '["project"]', input: '["area"]' });
		const preview = await plan(v, action);
		await p.apply(action, preview.changes);
		expect(v.notes.get('Notes/0.md')!.data.tags).toBe('area');
		expect(v.notes.get('Notes/1.md')!.data.tags).toEqual(['area', 'n1']);
		await p.undo();
		expect([...v.notes.values()].map(n => n.data)).toEqual(original);
	});
	it('preview writes nothing', async () => {
		const v = vault(50);
		await plan(v, tagAction());
		await plan(v, tagAction({ operation: 'remove-property' }));
		expect(v.writes).toEqual([]);
	});
});

describe('a note that changes during the run', () => {
	it('skips a note that sync changed during the run', async () => {
		const v = vault(500), p = plugin(v);
		const preview = await plan(v, tagAction());
		v.onWrite(path => { if (path === 'Notes/10.md') v.sync('Notes/300.md'); });
		const synced = structuredClone(v.notes.get('Notes/300.md')!);
		const message = await p.apply(tagAction(), preview.changes);
		expect(message).toContain('499 notes changed. 1 skipped.');
		expect(message).toContain(`Notes/300.md: ${CHANGED_FILE}`);
		expect(v.notes.get('Notes/300.md')!.data).toEqual(synced.data);
		expect(v.notes.get('Notes/300.md')!.body).toContain('synced');
		expect(v.writes).not.toContain('Notes/300.md');
		expect(p.history[0]!.changes).toHaveLength(499);
	});
	it('skips a note that was written between the stamp and the preview read', async () => {
		const v = vault(2);
		const preview = await previewChanges(['Notes/0.md'], tagAction(), async path => { v.sync(path); return structuredClone(v.notes.get(path)!.data); }, v.stamp);
		const r = await applyChanges({ update: (path, cb) => v.processFrontMatter(path, cb), stamp: v.stamp }, preview.changes, 'tags');
		expect(r.completed).toEqual([]);
		expect(r.skipped).toEqual([`Notes/0.md: ${CHANGED_FILE}`]);
	});
	it('skips a deleted note', async () => {
		const v = vault(2), p = plugin(v);
		const preview = await plan(v, tagAction());
		v.notes.delete('Notes/1.md');
		const message = await p.apply(tagAction(), preview.changes);
		expect(message).toContain('1 note changed. 1 skipped.');
	});
	it('undo keeps a body change from sync and restores the property', async () => {
		const v = vault(3), p = plugin(v);
		const original = structuredClone(v.notes.get('Notes/1.md')!.data);
		await p.apply(tagAction(), (await plan(v, tagAction())).changes);
		v.sync('Notes/1.md');
		expect(await p.undo()).toContain('3 notes restored. 0 skipped.');
		expect(v.notes.get('Notes/1.md')!.data).toEqual(original);
		expect(v.notes.get('Notes/1.md')!.body).toContain('synced');
	});
	it('unload in flight stops the run', async () => {
		const v = vault(20), p = plugin(v);
		const preview = await plan(v, tagAction());
		v.onWrite(path => { if (path === 'Notes/4.md') p.onunload(); });
		const message = await p.apply(tagAction(), preview.changes);
		// The write in flight (Notes/4.md) completes. No later note is written.
		expect(v.writes).toHaveLength(5);
		expect(message).toContain('5 notes changed. 15 skipped.');
		expect(message).toContain('The plugin was unloaded.');
	});
});

describe('result text for skipped notes', () => {
	it('free tells the user to undo first when a note is skipped', async () => {
		const v = vault(3), p = plugin(v);
		const preview = await plan(v, tagAction());
		v.sync('Notes/2.md');
		expect(await p.apply(tagAction(), preview.changes)).toMatch(/2 notes changed\. 1 skipped\.\n.*\nUndo the batch first if you need it\.$/);
	});
	it('no undo hint when nothing is skipped or with Pro', async () => {
		const v = vault(3), p = plugin(v);
		expect(await p.apply(tagAction(), (await plan(v, tagAction())).changes)).not.toContain('Undo the batch first');
		bindPro({ isPro: () => true } as never);
		const preview = await plan(v, tagAction({ input: '["x"]' }));
		v.sync('Notes/1.md');
		expect(await p.apply(tagAction({ input: '["x"]' }), preview.changes)).not.toContain('Undo the batch first');
	});
});

describe('replace list items input', () => {
	const replace = (patch: Partial<Action>) => tagAction({ operation: 'replace-items', find: '["a"]', input: '["b"]', ...patch });
	it.each([
		['empty find', { find: '[]' }, 'Find items'],
		['missing find', { find: undefined }, 'JSON list'],
		['text find', { find: 'draft' }, 'JSON list'],
		['empty value', { input: '[]' }, 'new item'],
		['text type', { type: 'text' as const, input: 'b' }, 'list type'],
	])('replace input errors: %s', async (_name, patch, message) => {
		let reads = 0;
		await expect(previewChanges(['a.md'], replace(patch), async () => { reads++; return {}; })).rejects.toThrow(message);
		expect(reads).toBe(0);
	});
	it('rejects a complex old value', () => expect(() => transform({ exists: true, value: { a: 1 } }, replace({}))).toThrow('existing property'));
	it('ignores Find items for other operations', () => expect(transform({ exists: true, value: ['a'] }, tagAction({ find: 'not json' }))).toEqual({ exists: true, value: ['a', 'review'] }));
	it('saved replace actions keep Find items', () => {
		const a = replace({});
		expect(normalizeSettings({ actions: [a, { ...tagAction(), find: '["x"]' }, { ...a, find: 5 }] })).toEqual({ actions: [a, tagAction(), { property: 'tags', operation: 'replace-items', type: 'list', input: '["b"]' }] });
	});
	it('Pro save drops a stale Find items from another operation', async () => {
		bindPro({ isPro: () => true } as never);
		const p = plugin(vault(1));
		Object.assign(p, { saveData: vi.fn(async () => undefined) });
		await p.saveAction(tagAction({ operation: 'set', type: 'text', input: 'done', find: '["draft"]' }));
		expect(p.settings.actions).toEqual([tagAction({ operation: 'set', type: 'text', input: 'done' })]);
		expect('find' in p.settings.actions[0]!).toBe(false);
	});
	it('Pro saves a replace action', async () => {
		bindPro({ isPro: () => true } as never);
		const p = plugin(vault(1));
		Object.assign(p, { saveData: vi.fn(async () => undefined) });
		await p.saveAction(replace({}));
		expect(p.settings.actions).toEqual([replace({})]);
	});
});
