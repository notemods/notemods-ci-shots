// Runs solver requests in a Web Worker with a time limit. When the limit passes, the worker is stopped
// (terminate) and the next request starts a new one. So a solve that does not end cannot block the editor.
import type { SolveReply, SolverReply, SolverRequest } from './protocol';
import type { TableResult } from './solve';

/** The parts of a Worker that the runner uses. Tests give a fake. */
export interface WorkerLike {
	onmessage: ((ev: MessageEvent<SolverReply>) => void) | null;
	onerror: ((ev: ErrorEvent) => void) | null;
	postMessage(msg: SolverRequest): void;
	terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

type Pending = { resolve: (r: SolverReply['result']) => void; timer: number; kind: SolverRequest['kind'] };

export function timeoutMessage(ms: number): string {
	const s = ms / 1000;
	return `The solve took longer than ${s} ${s === 1 ? 'second' : 'seconds'} and was stopped`;
}

export const START_ERROR = 'The solver could not start on this device';

/** Makes a worker from the bundled worker source, through a Blob URL. No file or network is used. */
export function blobWorkerFactory(source: string): WorkerFactory {
	return () => {
		const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
		let worker: Worker;
		try {
			worker = new Worker(url);
		} catch (e) {
			URL.revokeObjectURL(url);
			throw e;
		}
		const terminate = worker.terminate.bind(worker);
		// The Blob URL stays valid while the worker runs, and goes away when the worker stops.
		worker.terminate = () => {
			terminate();
			URL.revokeObjectURL(url);
		};
		return worker;
	};
}

export class SolverRunner {
	private worker: WorkerLike | null = null;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();

	constructor(
		private readonly factory: WorkerFactory,
		/** Time limit in ms for one request. */
		public timeoutMs: number,
	) {}

	solve(equation: string, symbol: string): Promise<SolveReply> {
		return this.send({ id: 0, kind: 'solve', equation, symbol }) as Promise<SolveReply>;
	}

	table(equation: string, symbol: string, solutions: string[], table: string): Promise<TableResult> {
		return this.send({ id: 0, kind: 'table', equation, symbol, solutions, table });
	}

	/** Stops the worker and ends each open request with an error. */
	stop(error = 'The solver was stopped'): void {
		this.worker?.terminate();
		this.worker = null;
		for (const [id, p] of this.pending) {
			window.clearTimeout(p.timer);
			p.resolve({ ok: false, error });
			this.pending.delete(id);
		}
	}

	private start(): WorkerLike | null {
		if (this.worker) return this.worker;
		let w: WorkerLike;
		try {
			w = this.factory();
		} catch (e) {
			console.error('Pocket Symbolic Solver: worker start failed', e);
			return null;
		}
		w.onmessage = (ev) => {
			const p = this.pending.get(ev.data.id);
			if (!p) return;
			window.clearTimeout(p.timer);
			this.pending.delete(ev.data.id);
			p.resolve(ev.data.result);
		};
		w.onerror = (ev) => {
			console.error('Pocket Symbolic Solver: worker error', ev.message);
			this.stop('The solver stopped with an error');
		};
		this.worker = w;
		return w;
	}

	private send(req: SolverRequest): Promise<SolverReply['result']> {
		return new Promise((resolve) => {
			const w = this.start();
			if (!w) {
				resolve({ ok: false, error: START_ERROR });
				return;
			}
			const id = this.nextId++;
			const timer = window.setTimeout(() => this.stop(timeoutMessage(this.timeoutMs)), this.timeoutMs);
			this.pending.set(id, { resolve, timer, kind: req.kind });
			w.postMessage({ ...req, id });
		});
	}
}
