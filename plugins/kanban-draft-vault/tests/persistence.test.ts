import { describe, expect, it, vi } from 'vitest';
import { SaveQueue } from '../src/persistence';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => { resolve = r; });
	return { promise, resolve };
}

describe('serialized local saves', () => {
	it('retains the newest complete text when an older write is pending', async () => {
		const block = deferred();
		const writes: { text: string }[] = [];
		let active = 0;
		let maxActive = 0;
		const queue = new SaveQueue<{ text: string }>(async (snapshot) => {
			active++; maxActive = Math.max(maxActive, active);
			if (!writes.length) await block.promise;
			writes.push(snapshot); active--;
		}, () => {});
		queue.request({ text: 'Call' });
		await Promise.resolve();
		queue.request({ text: 'Call Ana' });
		queue.request({ text: 'Call Ana\nAsk about the plan' });
		block.resolve();
		expect(await queue.flush()).toBe(true);
		expect(maxActive).toBe(1);
		expect(writes).toEqual([{ text: 'Call' }, { text: 'Call Ana\nAsk about the plan' }]);
	});
	it('uses immutable snapshots and persists dismissal after a pending capture', async () => {
		const block = deferred();
		const disk: unknown[] = [];
		const queue = new SaveQueue<{ drafts: string[] }>(async (snapshot) => {
			if (!disk.length) await block.promise;
			disk.push(snapshot);
		}, () => {});
		const state = { drafts: ['Call Ana'] };
		queue.request(state); await Promise.resolve();
		state.drafts.push('later mutation');
		queue.request({ drafts: [] }); block.resolve();
		await queue.flush();
		expect(disk).toEqual([{ drafts: ['Call Ana'] }, { drafts: [] }]);
	});
	it('reports a disk failure and can retry the newest in-memory state', async () => {
		const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
		const changed = vi.fn();
		const queue = new SaveQueue<{ text: string }>(write, changed);
		queue.request({ text: 'old' });
		expect(await queue.flush()).toBe(false);
		expect(queue.busy).toBe(false);
		queue.request({ text: 'complete' });
		expect(await queue.flush()).toBe(true);
		expect(write).toHaveBeenLastCalledWith({ text: 'complete' });
		expect(changed).toHaveBeenCalledTimes(4);
	});
});
