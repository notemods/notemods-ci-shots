// Entry of the solver worker. esbuild.config.mjs bundles this file with nerdamer into one string,
// and runner.ts starts it from a Blob. The plugin stops the worker when a solve takes too long.
import type { SolverReply, SolverRequest } from './protocol';
import { insertText, parseTable, solveEquation, substituteTable, symbolTex } from './solve';

export function handle(req: SolverRequest): SolverReply {
	if (req.kind === 'table') {
		const t = parseTable(req.table);
		return { id: req.id, kind: 'table', result: substituteTable(req.equation, req.symbol, req.solutions, t.header, t.rows) };
	}
	const r = solveEquation(req.equation, req.symbol);
	return { id: req.id, kind: 'solve', result: r.ok ? { ...r, insert: insertText(symbolTex(r.symbol), r.solutions) } : r };
}

interface WorkerScope {
	onmessage: ((ev: MessageEvent<SolverRequest>) => void) | null;
	postMessage(msg: SolverReply): void;
}

declare const self: WorkerScope;
self.onmessage = (ev) => self.postMessage(handle(ev.data));
