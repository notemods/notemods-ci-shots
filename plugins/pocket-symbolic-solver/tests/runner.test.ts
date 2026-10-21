import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SolverReply, SolverRequest } from '../src/protocol';
import { START_ERROR, SolverRunner, timeoutMessage, type WorkerLike } from '../src/runner';
import { handle } from '../src/worker';

/** A fake worker that answers with the real handler, after a delay or never. */
class FakeWorker implements WorkerLike {
	onmessage: ((ev: MessageEvent<SolverReply>) => void) | null = null;
	onerror: ((ev: ErrorEvent) => void) | null = null;
	terminated = false;
	sent: SolverRequest[] = [];
	constructor(private readonly delayMs: number | null) {}
	postMessage(msg: SolverRequest): void {
		this.sent.push(msg);
		if (this.delayMs === null) return;
		window.setTimeout(() => {
			if (!this.terminated) this.onmessage?.({ data: handle(msg) } as MessageEvent<SolverReply>);
		}, this.delayMs);
	}
	terminate(): void {
		this.terminated = true;
	}
}

afterEach(() => {
	vi.useRealTimers();
});

describe('SolverRunner', () => {
	it('returns the solve result and the insert text from the worker', async () => {
		const w = new FakeWorker(1);
		const r = await new SolverRunner(() => w, 1000).solve('F=m*a', 'a');
		expect(r).toMatchObject({ ok: true, insert: '$$a = \\frac{F}{m}$$' });
	});

	it('stops a worker that does not answer in the time limit and starts a new one next time', async () => {
		vi.useFakeTimers();
		const workers: FakeWorker[] = [];
		const runner = new SolverRunner(() => {
			const w = new FakeWorker(workers.length === 0 ? null : 1);
			workers.push(w);
			return w;
		}, 2000);
		const p = runner.solve('x^2=4', 'x');
		await vi.advanceTimersByTimeAsync(2000);
		expect(await p).toEqual({ ok: false, error: timeoutMessage(2000) });
		expect(workers[0]!.terminated).toBe(true);
		const q = runner.solve('x^2=4', 'x');
		await vi.advanceTimersByTimeAsync(5);
		expect(await q).toMatchObject({ ok: true });
		expect(workers).toHaveLength(2);
	});

	it('gives a clear error when the worker cannot start', async () => {
		const runner = new SolverRunner(() => {
			throw new Error('no workers');
		}, 1000);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		expect(await runner.solve('x=1', 'x')).toEqual({ ok: false, error: START_ERROR });
	});

	it('ends open requests when the worker reports an error', async () => {
		const w = new FakeWorker(null);
		const runner = new SolverRunner(() => w, 10000);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const p = runner.solve('x=1', 'x');
		w.onerror?.({ message: 'boom' } as ErrorEvent);
		expect(await p).toEqual({ ok: false, error: 'The solver stopped with an error' });
		expect(w.terminated).toBe(true);
	});

	it('runs a table request (Pro) through the worker', async () => {
		const runner = new SolverRunner(() => new FakeWorker(1), 1000);
		const t = await runner.table('F=m*a', 'a', ['F*m^-1'], 'F, m\n10, 2');
		expect(t).toEqual({ ok: true, markdown: '| F | m | a |\n| --- | --- | --- |\n| 10 | 2 | 5 |' });
	});

	it('says "1 second" for a one-second limit', () => {
		expect(timeoutMessage(1000)).toBe('The solve took longer than 1 second and was stopped');
		expect(timeoutMessage(5000)).toBe('The solve took longer than 5 seconds and was stopped');
	});
});
