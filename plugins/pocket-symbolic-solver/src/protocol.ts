// Messages between the plugin (runner.ts) and the solver worker (worker.ts).
import type { SolveResult, TableResult } from './solve';

export type SolverRequest =
	| { id: number; kind: 'solve'; equation: string; symbol: string }
	| { id: number; kind: 'table'; equation: string; symbol: string; solutions: string[]; table: string };

/** A solve result with the text to insert, or a table result. */
export type SolveReply = SolveResult & { insert?: string };

export type SolverReply = { id: number; kind: 'solve'; result: SolveReply } | { id: number; kind: 'table'; result: TableResult };
