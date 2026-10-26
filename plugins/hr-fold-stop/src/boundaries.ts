import { TreeFragment, type ChangedRange } from '@lezer/common';
import { parser } from '@lezer/markdown';

export interface ScanLine {
	i: number;
	kind: 'blank' | 'text' | 'rule' | 'fence' | 'frontmatter' | 'heading' | 'marker';
	/** Heading level, or the marker level (the digit, 1 when the marker has no digit). */
	level: number;
}

/** `%% fold-stop %%` or `%% fold-stop N %%` with N from 1 to 6, on its own line. */
const MARKER = /^ {0,3}%%[ \t]*fold-stop(?: ([1-6]))?[ \t]*%%[ \t\r]*$/i;

/** Level of an end marker line, or 0 when the line is not a marker. */
export function markerLevel(text: string): number {
	const match = MARKER.exec(text);
	return match ? Number(match[1] ?? 1) : 0;
}

/** Number of `%%` delimiters outside inline code. An odd count opens or closes a multi-line comment. */
function commentDelimiters(text: string): number {
	return text.replace(/`[^`]*`/g, '').split('%%').length - 1;
}

export interface TopLevelParse {
	scan: ScanLine[];
	/** Parser fragments for the next incremental parse. */
	fragments: readonly TreeFragment[];
	/** End offset of the masked YAML lines. 0 when the note has no frontmatter. */
	maskEnd: number;
}

/** Read only root Markdown blocks. Mask YAML with spaces to keep offsets. */
export function scanTopLevel(doc: string): ScanLine[] {
	return parseTopLevel(doc).scan;
}

/**
 * Parse with the fragments of the last parse, so an edit in a large note does not parse all text again.
 * `mapMaskEnd` maps the old YAML end through the edit. A different YAML end makes a full parse.
 */
export function parseTopLevel(doc: string, prev?: TopLevelParse, changes?: readonly ChangedRange[], mapMaskEnd?: (pos: number) => number): TopLevelParse {
	const texts = doc.split('\n');
	const scan: ScanLine[] = texts.map((text, i) => ({ i, kind: text.trim() ? 'text' : 'blank', level: 0 }));
	let offset = 0;
	const starts = texts.map(text => { const start = offset; offset += text.length + 1; return start; });
	const lineAt = (pos: number): number => {
		let low = 0, high = starts.length;
		while (low + 1 < high) { const mid = (low + high) >> 1; if (starts[mid]! <= pos) low = mid; else high = mid; }
		return low;
	};
	let source = doc;
	let maskEnd = 0;
	if (/^\uFEFF?---[ \t]*\r?$/.test(texts[0] ?? '')) {
		let end = 1;
		while (end < texts.length && !/^(---|\.\.\.)[ \t]*\r?$/.test(texts[end]!)) end++;
		const count = Math.min(end + 1, texts.length);
		for (let i = 0; i < count; i++) scan[i]!.kind = 'frontmatter';
		source = texts.map((text, i) => i < count ? text.replace(/[^\r]/g, ' ') : text).join('\n');
		maskEnd = count < texts.length ? starts[count]! : doc.length;
	}
	let fragments: readonly TreeFragment[] | undefined;
	if (prev && changes && mapMaskEnd && mapMaskEnd(prev.maskEnd) === maskEnd) {
		fragments = TreeFragment.applyChanges(prev.fragments, wholeLines(changes, starts, lineAt, doc.length));
	}
	const tree = parser.parse(source, fragments);
	const paragraph = new Uint8Array(texts.length);
	for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
		const first = lineAt(node.from);
		const last = lineAt(Math.max(node.from, node.to - 1));
		if (node.name === 'Paragraph') paragraph.fill(1, first, last + 1);
		else if (node.name === 'HorizontalRule') scan[first]!.kind = 'rule';
		else if (/^(ATX|Setext)Heading[1-6]$/.test(node.name)) {
			scan[first]!.kind = 'heading';
			scan[first]!.level = Number(node.name.slice(-1));
		} else if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
			for (let i = first; i <= last; i++) scan[i]!.kind = 'fence';
		}
	}
	// End markers: lines of root paragraphs only, never inside an open multi-line %% comment.
	let inComment = false;
	for (let i = 0; i < texts.length; i++) {
		const line = scan[i]!;
		// Most lines have no %%. Skip them before the regex work, because this loop runs on each keystroke.
		if (line.kind === 'fence' || line.kind === 'frontmatter' || !texts[i]!.includes('%%')) continue;
		const level = !inComment && paragraph[i] ? markerLevel(texts[i]!) : 0;
		if (level) { line.kind = 'marker'; line.level = level; }
		else if (commentDelimiters(texts[i]!) % 2) inComment = !inComment;
	}
	return { scan, fragments: TreeFragment.addTree(tree, fragments), maskEnd };
}

/**
 * Grow each change to whole lines, from one line before to one line after.
 * Markdown blocks start at line starts. A fragment that opens inside a changed line can reuse a wrong block.
 * The text outside a change is the same in both versions, so the old side moves by the same amount.
 */
function wholeLines(changes: readonly ChangedRange[], starts: number[], lineAt: (pos: number) => number, length: number): ChangedRange[] {
	const out: ChangedRange[] = [];
	for (const c of changes) {
		const fromB = starts[Math.max(0, lineAt(c.fromB) - 1)]!;
		const toB = starts[lineAt(c.toB) + 2] ?? length;
		let range = { fromA: Math.max(0, c.fromA - (c.fromB - fromB)), toA: c.toA + (toB - c.toB), fromB, toB };
		const last = out[out.length - 1];
		if (last && range.fromB <= last.toB) {
			out.pop();
			range = { fromA: last.fromA, toA: range.toA, fromB: last.fromB, toB: range.toB };
		}
		out.push(range);
	}
	return out;
}

/**
 * The first boundary after the heading: a top-level rule, an equal or higher heading,
 * or, when end markers are on, a marker whose level is at or above the heading level.
 */
export function foldStopLine(scan: ScanLine[], headingIndex: number, level: number, endMarkers = true): number | null {
	for (let k = headingIndex + 1; k < scan.length; k++) {
		const line = scan[k]!;
		if (line.kind === 'rule' || ((line.kind === 'heading' || (endMarkers && line.kind === 'marker')) && line.level <= level)) return k;
	}
	return null;
}

export type StopKind = 'heading' | 'rule' | 'marker';

export function foldStopForText(text: string, headingLine: number, level: number, endMarkers = true): { stop: number | null; kind: StopKind | null } {
	const scan = scanTopLevel(text);
	const index = headingLine - 1;
	if (scan[index]?.kind !== 'heading') return { stop: null, kind: null };
	const stop = foldStopLine(scan, index, level, endMarkers);
	return stop === null ? { stop: null, kind: null } : { stop: stop + 1, kind: scan[stop]!.kind as StopKind };
}
