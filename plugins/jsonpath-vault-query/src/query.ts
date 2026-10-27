import { compile, search } from 'jmespath';

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 500;
export const MAX_COLUMNS = 50;
export const MAX_TEXT = 100_000;
export interface Table { columns: string[]; rows: Record<string, unknown>[]; total: number; omittedColumns: number }

function safeNumbers(value: unknown): void {
	const stack = [value];
	while (stack.length) {
		const v = stack.pop();
		if (typeof v === 'number' && (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))) throw new Error('Integer outside the safe range, or non-finite number. Store the value as a string.');
		if (Array.isArray(v)) for (const child of v as unknown[]) stack.push(child);
		else if (v !== null && typeof v === 'object') for (const child of Object.values(v)) stack.push(child);
	}
}
function parseRecord(text: string): unknown {
	// JSON strings and numeric tokens are separate. Check numeric tokens before JSON.parse rounds them.
	const tokens = text.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
	for (const t of tokens) if (!t.startsWith('"')) safeNumbers(Number(t));
	const value: unknown = JSON.parse(text);
	safeNumbers(value);
	return value;
}
export function parseInput(text: string, path: string): unknown {
	if (text.startsWith('\uFEFF')) text = text.slice(1);
	if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Input exceeds 5 MiB.');
	if (!/\.(json|jsonl)$/i.test(path)) throw new Error('Choose a JSON or JSONL file.');
	if (/\.jsonl$/i.test(path)) {
		const records: unknown[] = [];
		const lines = text.split(/\r?\n/);
		for (let i = 0;i < lines.length;i++) {
			const line = lines[i]!;
			if (!line.trim()) continue;
			try { records.push(parseRecord(line)); }
			catch (e) { throw new Error(`JSONL line ${i + 1}: ${errorText(e)}`); }
		}
		return records;
	}
	try { return parseRecord(text); }
	catch (e) { throw new Error(`JSON: ${errorText(e)}`); }
}
export function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }
export function validateExpression(expression: string): void {
	if (!expression.trim()) throw new Error('Enter a JMESPath expression.');
	if (expression.length > 10_000) throw new Error('Expression exceeds 10,000 characters.');
	compile(expression);
}
export function runQuery(text: string, path: string, expression: string): unknown {
	validateExpression(expression);
	const result = search(parseInput(text, path), expression);
	safeNumbers(result);
	return result;
}
export function tableResult(value: unknown): Table | null {
	if (!Array.isArray(value) || !value.length || !value.every((v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v))) return null;
	const rows = value as Record<string, unknown>[];
	const keys = new Set<string>();
	for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
	return { columns: [...keys].slice(0, MAX_COLUMNS), rows: rows.slice(0, MAX_ROWS), total: rows.length, omittedColumns: Math.max(0, keys.size - MAX_COLUMNS) };
}
export function cellText(value: unknown): string {
	return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
}
export function combineResults(results: unknown[]): unknown[] {
	return results.flatMap((v) => Array.isArray(v) ? v as unknown[] : [v]);
}
export function report(value: unknown, kind: 'csv' | 'md'): string {
	const table = tableResult(value);
	let rows: Record<string, unknown>[] = table ? value as Record<string, unknown>[] : (Array.isArray(value) ? value : [value]).map((v: unknown) => ({ result: v }));
	let columns = table ? [...new Set(rows.flatMap((r) => Object.keys(r)))] : ['result'];
	if (!columns.length) {
		columns = ['result'];
		rows = rows.map((row) => ({ result: row }));
	}
	const csv = (v: unknown) => {
		let s = cellText(v);
		// Only text can start a formula. A negative number stays a number.
		if (typeof v === 'string' && (/^[=+@-]/.test(s) || /^[\t\r\n]/.test(s))) s = "'" + s;
		return '"' + s.replace(/"/g, '""') + '"';
	};
	const md = (v: unknown) => cellText(v).replace(/&/g, '&amp;').replace(/#/g, '&#35;').replace(/%/g, '&#37;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\r\n|\r|\n/g, '<br>').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
	if (kind === 'csv') return [columns.map(csv).join(','), ...rows.map((r) => columns.map((c) => csv(r[c])).join(','))].join('\r\n') + '\r\n';
	return [columns.map(md).join(' | '), columns.map(() => '---').join(' | '), ...rows.map((r) => columns.map((c) => md(r[c])).join(' | '))].map((r) => '| ' + r + ' |').join('\n') + '\n';
}
