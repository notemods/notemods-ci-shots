import { parseYaml, stringifyYaml } from 'obsidian';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { isScalar, parseDocument, visit } from 'yaml';

export type Format = 'yaml' | 'json' | 'toml';
export const FORMATS: Record<Format, string> = { yaml: 'YAML', json: 'JSON', toml: 'TOML' };
export const COMMENT_WARNING = 'Comments and YAML scalar styles will not be retained.';
export const MAX_INPUT = 1_000_000;
export type Data = null | string | boolean | number | Data[] | { [key: string]: Data };

export function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Checks the plain data model before a writer can omit a value. */
export function checkData(value: unknown, target: Format, path = '$', ancestors = new Set<object>(), depth = 0): asserts value is Data {
	const fail = (reason: string): never => { throw new Error(`${path}: ${reason}`); };
	if (depth > 100) fail('Data is deeper than 100 levels.');
	if (value === null) {
		if (target === 'toml') fail('TOML cannot represent null.');
		return;
	}
	if (typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('Number is outside the safe conversion range.');
		if (Object.is(value, -0)) fail('Negative zero is not supported.');
		return;
	}
	if (typeof value !== 'object') fail('Unsupported value type.');
	const obj = value as object;
	if (ancestors.has(obj)) fail('Cyclic aliases are not supported.');
	if (!Array.isArray(obj) && Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) fail('Dates and non-plain objects are not supported.');
	ancestors.add(obj);
	if (Array.isArray(obj)) obj.forEach((v: unknown, i) => checkData(v, target, `${path}[${i}]`, ancestors, depth + 1));
	else for (const [key, v] of Object.entries(obj)) checkData(v, target, `${path}[${JSON.stringify(key)}]`, ancestors, depth + 1);
	ancestors.delete(obj);
}

export function equalData(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
	const aa = a as Record<string, unknown>;
	const bb = b as Record<string, unknown>;
	const keys = Object.keys(aa);
	return keys.length === Object.keys(bb).length && keys.every((k) => Object.hasOwnProperty.call(bb, k) && equalData(aa[k], bb[k]));
}

/** Significant digits and exponent of an unsigned decimal, so 1.10 and 11e-1 give the same text. */
function decimalKey(text: string): string {
	const [mantissa = '', exponent = '0'] = text.replace(/^[+-]/, '').toLowerCase().split('e');
	const [whole = '', fraction = ''] = mantissa.split('.');
	const digits = (whole + fraction).replace(/^0+/, '');
	const significant = digits.replace(/0+$/, '');
	return `${significant}e${Number(exponent) - fraction.length + digits.length - significant.length}`;
}

/** Check decimal tokens before a parser can round them. */
function checkNumericToken(token: string): void {
	const raw = token.replace(/_/g, '');
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return;
	const n = Number(raw);
	if (n !== 0 && Math.abs(n) <= Number.MAX_SAFE_INTEGER && decimalKey(raw) !== decimalKey(String(n))) throw new Error(`Number ${token} has more digits than the conversion keeps.`);
	if (n !== 0) return;
	if (/[1-9]/.test(raw.split(/[eE]/)[0] ?? '')) throw new Error('Number underflows the safe conversion range.');
	if (raw.startsWith('-')) throw new Error('Negative zero is not supported.');
}

/** Read only numeric tokens on the value side. Strings, comments and table names are skipped. */
function auditTomlNumbers(text: string): void {
	let rhs = false;
	let depth = 0;
	for (let i = 0; i < text.length;) {
		const c = text[i]!;
		if (c === '"' || c === "'") {
			const triple = text.slice(i, i + 3) === c.repeat(3);
			const delimiter = c.repeat(triple ? 3 : 1);
			i += delimiter.length;
			while (i < text.length) {
				if (c === '"' && text[i] === '\\') { i += 2; continue; }
				if (text.slice(i, i + delimiter.length) === delimiter) {
					i += delimiter.length;
					if (triple) { let extra = 0; while (extra < 2 && text[i] === c) { i++; extra++; } }
					break;
				}
				i++;
			}
			continue;
		}
		if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
		if (c === '=') rhs = true;
		if (rhs && (c === '[' || c === '{')) depth++;
		if (rhs && (c === ']' || c === '}')) depth--;
		if (c === '\n' && depth === 0) rhs = false;
		if ('=,[]{} \t\r\n'.includes(c)) { i++; continue; }
		const start = i;
		while (i < text.length && !'=,[]{}# \t\r\n'.includes(text[i]!)) i++;
		if (rhs && !/^\s*=/.test(text.slice(i))) checkNumericToken(text.slice(start, i));
	}
}

/** AST checks reject duplicate keys, tags and non-string mapping keys before parseYaml. */
function auditYaml(text: string): void {
	const doc = parseDocument(text, { uniqueKeys: true, intAsBigInt: true });
	const issue = doc.errors[0] ?? doc.warnings[0];
	if (issue) throw new Error(issue.message);
	visit(doc, {
		Node(_key, node) {
			if (node.tag && !['tag:yaml.org,2002:str', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float', 'tag:yaml.org,2002:null', 'tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq'].includes(node.tag)) throw new Error('Unsupported YAML tag.');
			if (isScalar(node) && (typeof node.value === 'number' || typeof node.value === 'bigint') && node.source) checkNumericToken(node.source);
			if (isScalar(node) && typeof node.value === 'bigint' && (node.value > BigInt(Number.MAX_SAFE_INTEGER) || node.value < BigInt(-Number.MAX_SAFE_INTEGER))) throw new Error('Number is outside the safe conversion range.');
		},
		Pair(_key, pair) {
			if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('YAML mapping keys must be strings.');
		},
	});
	// Limits alias expansion. Cycles are checked on the public parser result.
	doc.toJS({ maxAliasCount: 100 });
}

export function parseData(text: string, format: Format): Data {
	if (!text.trim()) throw new Error('Select data before conversion.');
	if (text.length > MAX_INPUT) throw new Error('Input is larger than 1,000,000 characters.');
	let value: unknown;
	if (format === 'yaml') {
		auditYaml(text);
		value = parseYaml(text) as unknown;
	} else if (format === 'json') {
		value = JSON.parse(text) as unknown;
		// JSON objects also need duplicate-key checks. The YAML flow parser retains their keys.
		auditYaml(text);
		for (const token of text.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []) {
			if (!token.startsWith('"')) checkNumericToken(token);
		}
	} else { value = parseToml(text); auditTomlNumbers(text); }
	checkData(value, 'json');
	return value;
}

/** Keep the line end of the selection. A JSON line must not join a closing fence. */
export function fitLineEnd(output: string, selection: string, target: Format): string {
	if (selection.endsWith('\n')) return output.endsWith('\n') ? output : `${output}\n`;
	if (!output.endsWith('\n')) return output;
	const trimmed = output.slice(0, -1);
	// A YAML keep block scalar at the end can own the last line break.
	try { return target !== 'yaml' || equalData(parseData(output, 'yaml'), parseData(trimmed, 'yaml')) ? trimmed : output; } catch { return output; }
}

export function convert(text: string, source: Format, target: Format): { text: string; data: Data; warning: string } {
	const data = parseData(text, source);
	checkData(data, target);
	if (target === 'toml' && (data === null || typeof data !== 'object' || Array.isArray(data))) throw new Error('$: TOML requires an object at the root.');
	// smol-toml 1.9 adds a final newline; keep the existing preview output.
	const output = target === 'json' ? JSON.stringify(data, null, 2) : target === 'yaml' ? stringifyYaml(data) : stringifyToml(data as Parameters<typeof stringifyToml>[0]).replace(/\n$/, '');
	if (!equalData(data, target === 'toml' ? parseToml(output) : parseData(output, target))) throw new Error('$: Output changes the data. Conversion was blocked.');
	return { text: output, data, warning: COMMENT_WARNING };
}
