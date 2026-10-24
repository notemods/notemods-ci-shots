// Patch 1.0.2: auto import retries a read error once after 2 s, but a refused pack fails at once.
// A refused pack (bad zip, bomb, unsafe path) gives the same result after 2 s, so a retry only holds the queue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { App } from 'obsidian-test-mocks/obsidian';

const state = vi.hoisted(() => ({ scans: 0, mode: 'refused' as 'refused' | 'transient' }));

vi.mock('../src/writer', async (original) => {
	const real = await original<typeof import('../src/writer')>();
	const { readPack } = await import('../src/bundle');
	return {
		...real,
		readVaultPack: vi.fn(async (_app: unknown, file: { name: string }) => {
			state.scans++;
			// Real scans: bytes that are not a zip give a PackError from readPack.
			if (state.mode === 'refused') return readPack(file.name, strToU8('this is not a zip file'));
			if (state.scans === 1) throw new Error('EBUSY: the file is still open');
			return readPack(file.name, zipSync({ 'text.md': strToU8(`Note ${file.name}\n`) }));
		}),
		writeBundle: vi.fn(async (_app: unknown, _bundle: unknown, source: string) => ({ source, notePath: `${source}.md`, assets: 0, rewritten: 0, missing: 0, warnings: [] })),
	};
});

const { default: TextbundleFilesPlugin } = await import('../src/main');
const { PackError } = await import('../src/bundle');
const manifest = (await import('../manifest.json')).default;

/** Two stable size checks of 500 ms each come before the queue reads the pack. */
const STABLE_WAIT = 1000;
const RETRY_MS = 2000;

async function start(path: string) {
	const app = App.createConfigured__({ files: { [path]: 'pack bytes' } });
	const plugin = new TextbundleFilesPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	const run = { done: false, result: undefined as unknown };
	void plugin.autoImport(path).then((result) => {
		run.done = true;
		run.result = result;
	});
	return run;
}

describe('auto import retry (1.0.2)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		state.scans = 0;
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('scans a refused pack once and does not wait 2 s', async () => {
		state.mode = 'refused';
		const run = await start('Synced/broken.textpack');
		await vi.advanceTimersByTimeAsync(STABLE_WAIT + 100);
		expect(run.done).toBe(true);
		expect(run.result).toBeNull();
		expect(state.scans).toBe(1);
		// No retry timer is left, and no second scan comes later.
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
		expect(state.scans).toBe(1);
	});

	it('the refused pack error is a PackError', async () => {
		const { readPack } = await import('../src/bundle');
		expect(() => readPack('x.textpack', strToU8('this is not a zip file'))).toThrow(PackError);
	});

	it('retries a read error once after 2 s', async () => {
		state.mode = 'transient';
		const run = await start('Synced/syncing.textpack');
		await vi.advanceTimersByTimeAsync(STABLE_WAIT + 100);
		expect(state.scans).toBe(1);
		expect(run.done).toBe(false);
		await vi.advanceTimersByTimeAsync(RETRY_MS - 200);
		expect(state.scans).toBe(1);
		expect(run.done).toBe(false);
		await vi.advanceTimersByTimeAsync(200);
		expect(state.scans).toBe(2);
		expect(run.done).toBe(true);
		expect(run.result).toMatchObject({ notePath: 'Synced/syncing.textpack.md' });
	});
});
