// Pure solver logic on top of nerdamer 2.0.0. The worker (worker.ts) and the unit tests call it.
// main.ts does not import this file: nerdamer runs only in the worker, so a slow solve cannot block the editor.
import nerdamer from 'nerdamer';

export interface Solution {
	/** nerdamer text form, for example "-a^-1*(b-c)". */
	text: string;
	/** TeX of the solution, for example "-\\frac{b-c}{a}". */
	tex: string;
}

export type SolveResult =
	| {
			ok: true;
			symbol: string;
			solutions: Solution[];
			/** At least one solution holds the imaginary unit i. */
			complex: boolean;
			/** The solutions are a family with an integer index k. */
			family: boolean;
			/** The other symbols, kept as parameters, in sorted order. */
			params: string[];
	  }
	| { ok: false; error: string };

export const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Longest equation text that the solver accepts. */
export const MAX_INPUT = 500;

/** The parts of a nerdamer Expression that this file uses (nerdamer types the result as a wider union). */
interface Expr {
	text(options?: { decimal?: boolean }): string;
	toTeX(): string;
	variables(): string[];
	evaluate(): Expr;
	solveFor(symbol: string): unknown;
}

function expr(text: string, values?: Record<string, string>): Expr {
	return nerdamer(text, values) as unknown as Expr;
}

function parse(text: string): Expr | null {
	try {
		return expr(text);
	} catch {
		return null;
	}
}

function cleanTex(tex: string, text: string, index: string): string {
	// A numeric root (nerdamer gives a long decimal) prints as a short decimal, not as a long fraction.
	if (/^-?\d+\.\d+$/.test(text)) return shortNumber(text);
	return tex.replace(/_\{\{n\}\}/g, index).replace(/\\mathrm\{log\}/g, '\\ln');
}

function cleanText(text: string, index: string): string {
	return text.replace(/(?<![\w$])_n(?![\w$])/g, index);
}

/** Numeric value of a real constant solution, or null when it has symbols or i. */
function realValue(text: string): number | null {
	if (/[A-Za-z_]/.test(text)) return null;
	try {
		const v = Number(expr(text).evaluate().text({ decimal: true }));
		return Number.isFinite(v) ? v : null;
	} catch {
		return null;
	}
}

/** True when text holds the imaginary unit i as its own token. */
export function hasImaginary(text: string): boolean {
	return /(?<![A-Za-z0-9_])i(?![A-Za-z0-9_(])/.test(text);
}

/** Splits "lhs=rhs" into an expression equal to 0. No "=" means "expr = 0". Returns null for two or more "=". */
export function toZeroForm(input: string): string | null {
	const parts = input.split('=');
	if (parts.length > 2) return null;
	if (parts.length === 1) return parts[0]!.trim();
	const lhs = parts[0]!.trim();
	const rhs = parts[1]!.trim();
	if (!lhs || !rhs) return null;
	return `(${lhs})-(${rhs})`;
}

/**
 * Solves equation for symbol. Other symbols stay as parameters.
 * Errors are short sentences for the modal. The function does not throw.
 */
export function solveEquation(equation: string, symbol: string): SolveResult {
	const input = equation.trim();
	const sym = symbol.trim();
	if (!input) return { ok: false, error: 'Type an equation' };
	if (input.length > MAX_INPUT) return { ok: false, error: `The equation is longer than ${MAX_INPUT} characters` };
	if (!SYMBOL_RE.test(sym)) return { ok: false, error: 'Type one symbol, for example x' };
	const zero = toZeroForm(input);
	if (zero === null) return { ok: false, error: 'Cannot parse the equation' };
	const sides = input.split('=').map((s) => s.trim());
	if (sides.some((s) => parse(s) === null)) return { ok: false, error: 'Cannot parse the equation' };
	const whole = parse(zero);
	if (!whole) return { ok: false, error: 'Cannot parse the equation' };
	let vars: string[];
	try {
		vars = [...new Set(sides.flatMap((side) => parse(side)!.variables()))].sort();
	} catch {
		return { ok: false, error: 'Cannot parse the equation' };
	}
	if (!vars.includes(sym)) return { ok: false, error: `${sym} is not in the equation` };
	let list: Expr[];
	let family = false;
	try {
		const set = expr(input.includes('=') ? input : `${input}=0`).solveFor(sym) as { elements: Expr[]; solutionForm: string; partial?: boolean };
		if (set.solutionForm === 'all') return { ok: false, error: `The equation is true for each value of ${sym}` };
		family = set.solutionForm === 'parametric';
		list = set.elements;
	} catch {
		return { ok: false, error: `Cannot solve the equation for ${sym}` };
	}
	if (list.length === 0) return { ok: false, error: `No solution for ${sym}` };
	const params = vars.filter((v) => v !== sym);
	const index = params.includes('k') ? 'n_0' : 'k';
	let solutions: Solution[];
	try {
		solutions = list.map((e) => ({ text: cleanText(e.text(), index), tex: cleanTex(e.toTeX(), e.text(), index) }));
	} catch {
		return { ok: false, error: `Cannot solve the equation for ${sym}` };
	}
	const values = solutions.map((s) => realValue(s.text));
	if (values.every((v) => v !== null)) {
		solutions = solutions.map((s, i) => ({ s, v: values[i]! })).sort((a, b) => a.v - b.v).map((x) => x.s);
	}
	return { ok: true, symbol: sym, solutions, complex: solutions.some((s) => hasImaginary(s.text)), family, params };
}

/** TeX of a symbol name: "x" stays "x", "v0" becomes "v_{0}", "alpha" stays "alpha" as nerdamer prints it. */
export function symbolTex(symbol: string): string {
	try {
		return expr(symbol).toTeX();
	} catch {
		return symbol;
	}
}

/** The text to insert: "$$a = \frac{F}{m}$$", or with two or more solutions "$$x = 2 \quad\text{or}\quad x = 3$$". */
export function insertText(symbolTeX: string, solutions: Solution[]): string {
	return `$$${solutions.map((s) => `${symbolTeX} = ${s.tex}`).join(' \\quad\\text{or}\\quad ')}$$`;
}

/** Parses "F=10, m=2" (or one pair per line) into values. Returns null for a bad pair. */
export function parseParams(text: string): Record<string, string> | null {
	const out: Record<string, string> = {};
	for (const part of text.split(/[,;\n]/)) {
		const p = part.trim();
		if (!p) continue;
		const m = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(p);
		if (!m || parse(m[2]!) === null) return null;
		out[m[1]!] = m[2]!.trim();
	}
	return out;
}

export interface TableResult {
	ok: boolean;
	error?: string;
	markdown?: string;
}

/** Shortest form of a value: an integer or a decimal with up to 6 significant digits after rounding. */
function shortNumber(text: string): string {
	const n = Number(text);
	if (!Number.isFinite(n)) return text;
	return String(Number(n.toPrecision(6)));
}

/**
 * Value of a solution with params put in, as plain text. Returns null when the value does not
 * solve the equation with these params (for example a division by zero gave a wrong value).
 */
export function substitute(zeroForm: string, symbol: string, solution: string, values: Record<string, string>): string | null {
	const sub = expr(solution, values).evaluate();
	const full = sub.text({ decimal: true });
	const residual = Number(expr(`abs(${zeroForm})`, { ...values, [symbol]: `(${full})` }).evaluate().text({ decimal: true }));
	const size = Number(expr(`abs(${full})`).evaluate().text({ decimal: true }));
	if (!Number.isFinite(residual) || !(residual <= 1e-7 * (1 + (Number.isFinite(size) ? size : 0)))) return null;
	return /[A-Za-z]/.test(full.replace(/(?<![A-Za-z0-9_])i(?![A-Za-z0-9_(])/g, '')) ? sub.text() : full.replace(/-?\d+(\.\d+)?(e[-+]?\d+)?/g, (m) => shortNumber(m));
}

/**
 * Puts each row of parameter values into each solution and gives a Markdown table:
 * one column for each parameter, then one column for the symbol.
 * header: the parameter names, rows: values in the same sequence.
 */
export function substituteTable(equation: string, symbol: string, solutions: string[], header: string[], rows: string[][]): TableResult {
	const zero = toZeroForm(equation.trim());
	if (zero === null || parse(zero) === null) return { ok: false, error: 'Cannot parse the equation' };
	if (header.length === 0) return { ok: false, error: 'Type the parameter names in the first line' };
	if (rows.length === 0) return { ok: false, error: 'Type one or more rows of values' };
	if (rows.length > 200) return { ok: false, error: 'Use 200 rows or fewer' };
	for (const h of header) if (!SYMBOL_RE.test(h)) return { ok: false, error: `${h} is not a symbol name` };
	if (header.includes(symbol)) return { ok: false, error: `${symbol} is the symbol to solve for. Remove its column` };
	const esc = (s: string) => s.replace(/\|/g, '\\|');
	const lines = [`| ${[...header, symbol].map(esc).join(' | ')} |`, `| ${[...header, symbol].map(() => '---').join(' | ')} |`];
	for (const [r, row] of rows.entries()) {
		if (row.length !== header.length) return { ok: false, error: `Row ${r + 1} has ${row.length} ${row.length === 1 ? 'value' : 'values'}, not ${header.length}` };
		const values: Record<string, string> = {};
		for (const [i, h] of header.entries()) {
			if (parse(row[i]!) === null) return { ok: false, error: `Row ${r + 1} has a bad value: ${row[i]!}` };
			values[h] = row[i]!;
		}
		const cells: string[] = [];
		for (const s of solutions) {
			try {
				const v = substitute(zero, symbol, s, values);
				if (v !== null && !cells.includes(v)) cells.push(v);
			} catch {
				// No value for this solution with these params.
			}
		}
		const cell = cells.length ? cells.join(', ') : 'undefined';
		lines.push(`| ${[...row, cell].map(esc).join(' | ')} |`);
	}
	return { ok: true, markdown: lines.join('\n') };
}

/** Parses table text: first line names (comma or tab separated), next lines values. */
export function parseTable(text: string): { header: string[]; rows: string[][] } {
	const split = (l: string) =>
		l
			.replace(/^\s*\|/, '')
			.replace(/\|\s*$/, '')
			.split(/[,\t|]/)
			.map((c) => c.trim());
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !/^\|?\s*:?-{3,}/.test(l));
	if (lines.length === 0) return { header: [], rows: [] };
	return { header: split(lines[0]!).filter((c) => c), rows: lines.slice(1).map(split) };
}

/** The text that Insert puts in the note, or the error that the modal shows. */
export function solveToInsert(equation: string, symbol: string): { insert: string } | { error: string } {
	const r = solveEquation(equation, symbol);
	return r.ok ? { insert: insertText(symbolTex(r.symbol), r.solutions) } : { error: r.error };
}

/**
 * The note text after the user runs the command on the selection [from, to), types symbol and taps a button.
 * "cancel" and a failed solve give the same text back. The modal does the same with Editor.replaceSelection.
 */
export function noteAfter(note: string, from: number, to: number, symbol: string, action: 'insert' | 'cancel'): string {
	if (action === 'cancel') return note;
	const r = solveToInsert(note.slice(from, to), symbol);
	return 'insert' in r ? note.slice(0, from) + r.insert + note.slice(to) : note;
}
