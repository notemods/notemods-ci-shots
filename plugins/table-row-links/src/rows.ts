// Pure functions for Markdown table row anchors.
export const MARKER_PREFIX = '%%row:';
export const MARKER_RE = /%%row:([a-z0-9]{6})%%/;
export const ID_RE = /^[a-z0-9]{6}$/;

export interface RowAnchorResult {
	available: boolean;
	changed: boolean;
	line: string;
	id: string;
	label: string;
	link: string;
	rowIndex: number;
}

/** Cell boundaries ignore escaped pipes. Version 1 needs both outer pipes. */
function boundaries(line: string): number[] {
	const out: number[] = [];
	let slashes = 0;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '|' && slashes % 2 === 0) out.push(i);
		slashes = c === '\\' ? slashes + 1 : 0;
	}
	return out;
}

export function cells(line: string): string[] | null {
	const b = boundaries(line);
	if (b.length < 2 || line.slice(0, b[0]).trim() || line.slice(b[b.length - 1]! + 1).trim()) return null;
	return b.slice(0, -1).map((start, i) => line.slice(start + 1, b[i + 1]));
}

export function isDivider(line: string): boolean {
	return cells(line)?.every((x) => /^:?-+:?$/.test(x.trim())) ?? false;
}

export function codeFences(lines: string[]): boolean[] {
	let fence: { char: string; length: number } | null = null;
	return lines.map((line) => {
		const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) {
			if (m && m[1]![0] === fence.char && m[1]!.length >= fence.length && !m[2]!.trim()) fence = null;
			return true;
		}
		if (m) {
			fence = { char: m[1]![0]!, length: m[1]!.length };
			return true;
		}
		return /^ {4}|^\t/.test(line);
	});
}

/** A data row follows a header and a divider, outside code. Maps each data row line to its 1-based index in its table. */
export function rowIndexes(lines: string[]): Map<number, number> {
	const code = codeFences(lines);
	const out = new Map<number, number>();
	let index = 0;
	for (let i = 0; i < lines.length; i++) {
		if (code[i] || !cells(lines[i]!)) { index = 0; continue; }
		// Inside a table body, a row of dashes such as | - | is data, not a new divider.
		if (index > 0) { out.set(i, index++); continue; }
		if (isDivider(lines[i]!) && i > 0 && !code[i - 1] && cells(lines[i - 1]!) !== null && !isDivider(lines[i - 1]!) && !out.has(i - 1)) index = 1;
	}
	return out;
}

export function dataRows(lines: string[]): number[] {
	return [...rowIndexes(lines).keys()];
}

/** Anchors belong in the first cell. */
export function markerId(line: string): string {
	return MARKER_RE.exec(cells(line)?.[0] ?? '')?.[1] ?? '';
}

export function newRowId(): string {
	const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
	return s;
}

export function rowLabel(line: string, index: number): string {
	const text = (cells(line)?.[0] ?? '').replace(MARKER_RE, '').trim();
	// Count code points, so the limit does not split an emoji.
	return text === '' ? `Row ${index}` : Array.from(text).slice(0, 40).join('');
}

function uriPart(text: string): string {
	return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function rowLink(label: string, vault: string, file: string, id: string): string {
	const safe = label.replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1');
	return `[${safe}](obsidian://table-row?vault=${uriPart(vault)}&file=${uriPart(file)}&row=${id})`;
}

export function rowAnchor(lines: string[], index: number, vault: string, path: string, fixedId?: string): RowAnchorResult {
	const line = lines[index] ?? '';
	if (!rowIndexes(lines).has(index)) return { available: false, changed: false, line, id: '', label: '', link: '', rowIndex: 0 };
	const rowIndex = rowIndexes(lines).get(index) ?? 0;
	let id = markerId(line);
	const changed = id === '';
	if (changed) {
		const used = new Set(lines.map(markerId));
		id = fixedId && ID_RE.test(fixedId) ? fixedId : newRowId();
		while (used.has(id)) id = newRowId();
		const b = boundaries(line);
		const cell = line.slice(b[0]! + 1, b[1]);
		const marker = cell.trim() ? `${cell.trimEnd()} ${MARKER_PREFIX}${id}%%${cell.slice(cell.trimEnd().length) || ' '}` : ` ${MARKER_PREFIX}${id}%% `;
		lines[index] = line.slice(0, b[0]! + 1) + marker + line.slice(b[1]);
	}
	const label = rowLabel(lines[index]!, rowIndex);
	return { available: true, changed, line: lines[index]!, id, label, link: rowLink(label, vault, path, id), rowIndex };
}

export function findMarkedLine(text: string, id: string): number {
	if (!ID_RE.test(id)) return -1;
	const lines = text.split('\n');
	return dataRows(lines).find((i) => markerId(lines[i]!) === id) ?? -1;
}

export function markedRows(text: string | string[]): { id: string; line: number; label: string }[] {
	const lines = Array.isArray(text) ? text : text.split('\n');
	return [...rowIndexes(lines)].flatMap(([line, index]) => {
		const id = markerId(lines[line]!);
		return id ? [{ id, line, label: rowLabel(lines[line]!, index) }] : [];
	});
}

/** Reference checks happen in the plugin. The caller supplies ids to keep. */
export function removeUnusedAnchors(text: string, referenced: ReadonlySet<string> = new Set()): { text: string; removed: number } {
	const lines = text.split('\n');
	let removed = 0;
	for (const i of dataRows(lines)) {
		const id = markerId(lines[i]!);
		if (!id || referenced.has(id)) continue;
		lines[i] = lines[i]!.replace(` ${MARKER_PREFIX}${id}%%`, '').replace(`${MARKER_PREFIX}${id}%%`, '');
		removed++;
	}
	return { text: lines.join('\n'), removed };
}
