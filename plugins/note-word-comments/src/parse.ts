// Markdown note to a small document model. No Obsidian import: tests and the golden vectors run this directly.
// Supported (free): plain paragraphs, ATX headings, inline %% comments %% on the previous word.
// Supported (Pro, with pro: true): pipe tables and local image embeds. Each other structure is a problem.

export interface ParseOptions {
	/** Author of each comment without a label (or each comment when labels is false). */
	author: string;
	/** Pro: tables and local images are supported. */
	pro?: boolean;
	/** Pro: "Name: text" at the start of a comment sets its author. */
	labels?: boolean;
	/** First comment id. A joined export continues the ids of the note before. */
	firstId?: number;
}

export interface NoteComment {
	id: number;
	author: string;
	text: string;
	/** The word that the comment marks. */
	anchor: string;
	/** 1-based line of the opening %%. */
	line: number;
}

/** One piece of a paragraph: plain text, a line break, or a word with comments. */
export type Run = { text: string } | { br: true } | { anchor: string; ids: number[] };

export type Block =
	| { kind: 'heading'; level: number; runs: Run[] }
	| { kind: 'paragraph'; runs: Run[] }
	| { kind: 'table'; rows: Run[][][] }
	| { kind: 'image'; target: string; alt: string; width: number | null };

export interface Problem {
	line: number;
	message: string;
}

export interface ParsedNote {
	blocks: Block[];
	comments: NoteComment[];
	problems: Problem[];
}

const MARK = '';
const LABEL = /^([\p{L}\p{N}][\p{L}\p{N} .'-]{0,39}):\s+(\S[\s\S]*)$/u;
const IMAGE_EXT = /\.(png|jpe?g|gif|bmp)$/i;

/** Text of a note without a leading YAML front matter block. Returns the text and the count of removed lines. */
export function stripFrontmatter(text: string): { body: string; offset: number } {
	const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return { body: text, offset: 0 };
	return { body: text.slice(m[0].length), offset: m[0].split('\n').length - 1 };
}

/** The author label and the remaining text of a comment, or null if the comment has no label. */
export function splitLabel(text: string): { author: string; text: string } | null {
	const m = LABEL.exec(text);
	if (!m || /^https?$/i.test(m[1]!)) return null;
	return { author: m[1]!.trim(), text: m[2]!.trim() };
}

/** Problems with Markdown that the export does not support, for one line of text outside comments. */
export function inlineProblems(line: string, pro: boolean): string[] {
	const out: string[] = [];
	const add = (msg: string) => {
		if (!out.includes(msg)) out.push(msg);
	};
	if (/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/.test(line)) add(pro ? 'image inside text (put the image on its own line)' : 'image (Pro)');
	if (/(?<!!)\[\[[^\]]*\]\]/.test(line)) add('internal link');
	if (/(?<!!)\[[^\]]*\]\([^)]*\)/.test(line)) add('Markdown link');
	if (/\[\^[^\]]+\]/.test(line)) add('footnote');
	if (/`/.test(line)) add('inline code');
	if (/\*\*\S|\S\*\*|__\S[\s\S]*?\S__/.test(line)) add('bold text');
	if (/(^|[^*\w])\*(?!\s)[^*]+?(?<!\s)\*(?!\w)|(^|[^\p{L}\p{N}_])_(?!\s)[^_]+?(?<!\s)_(?![\p{L}\p{N}_])/u.test(line)) add('italic text');
	if (/~~\S/.test(line)) add('strikethrough');
	if (/==\S[\s\S]*?\S==/.test(line)) add('highlight');
	if (/\$\$|\$\S[^$]*?\S\$|\$\S\$/.test(line)) add('math');
	if (/<!--|-->/.test(line)) add('HTML comment');
	if (/<\/?[a-zA-Z][^>]*>/.test(line)) add('HTML');
	if (/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(line)) add('HTML entity');
	if (/\\[!-/:-@[-`{-~]/.test(line)) add('backslash escape');
	return out;
}

/** Problem for a block-level line, or null. Tables and images are handled by the caller. */
function lineProblem(line: string): string | null {
	if (/^\s*(```|~~~)/.test(line)) return 'fenced code block';
	if (/^( {4}|\t)\S/.test(line)) return 'indented code block';
	if (/^\s*>/.test(line)) return 'block quote or callout';
	if (/^\s*([-*+]|\d+[.)])\s/.test(line) || /^\s*[-*+]$/.test(line)) return 'list';
	if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return 'horizontal rule';
	if (/^\s*=+\s*$/.test(line)) return 'Setext heading';
	return null;
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = (line: string) => /^\s*\|(\s*:?-{1,}:?\s*\|)+\s*$/.test(line);

function splitCells(line: string): string[] {
	return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** decodeURI, or the text as it is when it has a bad percent escape such as "50%.png". */
function safeDecode(s: string): string {
	try {
		return decodeURI(s);
	} catch {
		return s;
	}
}

/** An image embed alone on a line: ![[a.png]], ![[a.png|300]] or ![alt](a.png). Null for another line. */
export function imageLine(line: string): { target: string; alt: string; width: number | null } | null {
	const w = /^\s*!\[\[([^\]|#]+)(?:\|(\d+)(?:x\d+)?)?\]\]\s*$/.exec(line);
	if (w) return { target: w[1]!.trim(), alt: w[1]!.trim(), width: w[2] ? Number(w[2]) : null };
	const m = /^\s*!\[([^\]]*)\]\(<?([^)>]+?)>?\)\s*$/.exec(line);
	if (m) return { target: safeDecode(m[2]!.trim()), alt: m[1]!.trim(), width: null };
	return null;
}

/**
 * Parses a note into blocks and comments. Each %% comment %% marks the word before it in the same paragraph.
 * The comment text leaves the body, and the white space between the word and the comment goes too.
 */
export function parseNote(text: string, opts: ParseOptions): ParsedNote {
	const problems: Problem[] = [];
	const comments: NoteComment[] = [];
	const pro = opts.pro === true;
	const { body: src, offset } = stripFrontmatter(text.replace(/\r\n?/g, '\n'));
	const lineAt = (i: number) => offset + src.slice(0, i).split('\n').length;
	// The note can contain the MARK character itself. Report it and replace it, so that marks and comments stay in step.
	for (let at = src.indexOf(MARK); at >= 0; at = src.indexOf(MARK, at + 1)) problems.push({ line: lineAt(at), message: 'private use character U+E000' });
	const raw = src.split(MARK).join('\uFFFD');

	// 1. Take the comments out of the text. Each comment becomes one MARK character.
	const pending: { text: string; line: number; nl: number }[] = [];
	let body = '';
	let i = 0;
	while (i < raw.length) {
		const open = raw.indexOf('%%', i);
		if (open < 0) {
			body += raw.slice(i);
			break;
		}
		body += raw.slice(i, open);
		const close = raw.indexOf('%%', open + 2);
		const line = lineAt(open);
		if (close < 0) {
			problems.push({ line, message: 'comment has no closing %%' });
			body += raw.slice(open + 2);
			break;
		}
		const inner = raw.slice(open + 2, close);
		if (/\n[ \t]*\n/.test(inner)) problems.push({ line, message: 'comment crosses a paragraph' });
		else if (inner.trim() === '') problems.push({ line, message: 'empty comment' });
		pending.push({ text: inner.replace(/\s+/g, ' ').trim(), line, nl: inner.split('\n').length - 1 });
		body += MARK;
		i = close + 2;
	}

	// 2. Lines to blocks.
	const lines = body.split('\n');
	const blocks: Block[] = [];
	let para: string[] = [];
	let markIndex = 0;
	let nextId = opts.firstId ?? 0;
	// Line number of each body line. Comments that span lines move the later lines down.
	const lineNo: number[] = [];
	{
		let n = offset + 1;
		let m = 0;
		for (const l of lines) {
			lineNo.push(n);
			n += 1;
			for (const ch of l) if (ch === MARK) n += pending[m++]!.nl;
		}
	}

	/** Builds runs for a text with MARK characters. A comment without a word before it is a problem. */
	const toRuns = (src: string): Run[] => {
		const runs: Run[] = [];
		let buf = '';
		const flush = () => {
			if (buf) runs.push({ text: buf });
			buf = '';
		};
		for (const ch of src) {
			if (ch === '\n') {
				flush();
				runs.push({ br: true });
				continue;
			}
			if (ch !== MARK) {
				buf += ch;
				continue;
			}
			const c = pending[markIndex++]!;
			buf = buf.replace(/\s+$/, '');
			const last = runs[runs.length - 1];
			let anchorRun: { anchor: string; ids: number[] } | null = null;
			if (!buf && last && 'anchor' in last) anchorRun = last;
			else {
				const word = /(\S+)$/u.exec(buf)?.[1] ?? '';
				if (!word) {
					if (c.text) problems.push({ line: c.line, message: 'no previous word in this paragraph' });
					continue;
				}
				const bare = word.replace(/\p{P}+$/u, '');
				const anchor = bare || word;
				const rest = word.slice(anchor.length);
				buf = buf.slice(0, buf.length - word.length);
				flush();
				anchorRun = { anchor, ids: [] };
				runs.push(anchorRun);
				if (rest) buf = rest;
			}
			if (!c.text) continue;
			let author = opts.author;
			let ctext = c.text;
			if (opts.labels) {
				const l = splitLabel(c.text);
				if (l) {
					author = l.author;
					ctext = l.text;
				}
			}
			const id = nextId++;
			anchorRun.ids.push(id);
			comments.push({ id, author, text: ctext, anchor: anchorRun.anchor, line: c.line });
		}
		flush();
		return runs;
	};

	const endPara = () => {
		if (para.length === 0) return;
		const runs = toRuns(para.join('\n'));
		if (runs.length) blocks.push({ kind: 'paragraph', runs });
		para = [];
	};

	const skipMarks = (s: string) => {
		for (const ch of s) if (ch === MARK) markIndex++;
	};

	let fence = false;
	for (let k = 0; k < lines.length; k++) {
		const line = lines[k]!;
		const n = lineNo[k]!;
		const plain = line.split(MARK).join(' ');
		if (fence) {
			skipMarks(line);
			if (/^\s*(```|~~~)/.test(line)) fence = false;
			continue;
		}
		if (plain.trim() === '' && !line.includes(MARK)) {
			endPara();
			continue;
		}
		// A closing # sequence needs white space before it: "# C#" keeps its "#".
		const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
		if (heading) {
			endPara();
			// "### ###" is an empty heading.
			const htext = /^#+$/.test(heading[2]!) ? '' : heading[2]!;
			for (const p of inlineProblems(htext.split(MARK).join(' '), pro)) problems.push({ line: n, message: p });
			const runs = toRuns(htext);
			blocks.push({ kind: 'heading', level: heading[1]!.length, runs });
			continue;
		}
		if (isTableRow(plain) && k + 1 < lines.length && isTableRule(lines[k + 1]!.split(MARK).join(' '))) {
			endPara();
			const start = k;
			const rowLines: string[] = [line];
			k += 2;
			skipMarks(lines[start + 1]!);
			while (k < lines.length && isTableRow(lines[k]!.split(MARK).join(' '))) rowLines.push(lines[k++]!);
			k--;
			if (!pro) {
				problems.push({ line: n, message: 'Markdown table (Pro)' });
				for (const r of rowLines) skipMarks(r);
				continue;
			}
			const rows: Run[][][] = [];
			rowLines.forEach((r, ri) => {
				const ln = lineNo[ri === 0 ? start : start + ri + 1]!;
				const cells = splitCells(r);
				const row: Run[][] = [];
				for (const cell of cells) {
					for (const p of inlineProblems(cell.split(MARK).join(' '), pro)) problems.push({ line: ln, message: `${p} in a table` });
					row.push(toRuns(cell));
				}
				rows.push(row);
			});
			blocks.push({ kind: 'table', rows });
			continue;
		}
		const img = imageLine(plain);
		if (img && !line.includes(MARK)) {
			endPara();
			if (/^[a-z][a-z0-9+.-]*:/i.test(img.target)) problems.push({ line: n, message: 'image from a web address' });
			else if (!IMAGE_EXT.test(img.target)) problems.push({ line: n, message: 'embedded note or file that is not a PNG, JPEG, GIF or BMP image' });
			else if (!pro) problems.push({ line: n, message: 'image (Pro)' });
			else blocks.push({ kind: 'image', ...img });
			continue;
		}
		if (/^\s*!\[\[[^\]]*\]\]\s*$/.test(plain)) {
			endPara();
			skipMarks(line);
			problems.push({ line: n, message: 'embedded note or file' });
			continue;
		}
		const lp = lineProblem(plain);
		if (lp) {
			endPara();
			if (lp === 'fenced code block') fence = true;
			if (lp === 'horizontal rule' || lp === 'Setext heading') {
				// "---" under a text line is a Setext heading too.
				problems.push({ line: n, message: para.length || (k > 0 && lines[k - 1]!.trim() && /^\s*[-=]+\s*$/.test(plain)) ? 'Setext heading or horizontal rule' : lp });
			} else problems.push({ line: n, message: lp });
			skipMarks(line);
			continue;
		}
		if (isTableRow(plain)) {
			endPara();
			skipMarks(line);
			problems.push({ line: n, message: pro ? 'table without a header rule' : 'Markdown table (Pro)' });
			continue;
		}
		for (const p of inlineProblems(plain, pro)) problems.push({ line: n, message: p });
		para.push(line.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''));
	}
	endPara();

	// Comment problems from step 1 come first in line order with the rest.
	problems.sort((a, b) => a.line - b.line);
	return { blocks, comments, problems: dedupe(problems) };
}

function dedupe(list: Problem[]): Problem[] {
	const seen = new Set<string>();
	return list.filter((p) => {
		const k = `${p.line}\u0000${p.message}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

/** Plain text of runs, as the DOCX body shows it. Line breaks become "\n". */
export function runsText(runs: Run[]): string {
	return runs.map((r) => ('br' in r ? '\n' : 'anchor' in r ? r.anchor : r.text)).join('');
}

/** Short summary of a parse for previews and golden vectors. */
export function summarize(p: ParsedNote): { body: string[]; comments: { id: number; author: string; text: string; anchor: string }[]; problems: string[] } {
	const body: string[] = [];
	for (const b of p.blocks) {
		if (b.kind === 'heading') body.push(`${'#'.repeat(b.level)} ${runsText(b.runs)}`);
		else if (b.kind === 'paragraph') body.push(runsText(b.runs));
		else if (b.kind === 'table') body.push(b.rows.map((r) => `| ${r.map(runsText).join(' | ')} |`).join('\n'));
		else body.push(`[image ${b.target}]`);
	}
	return {
		body,
		comments: p.comments.map(({ id, author, text, anchor }) => ({ id, author, text, anchor })),
		problems: p.problems.map((x) => `line ${x.line}: ${x.message}`),
	};
}

/** parseNote, then summarize. The golden vectors call this function. */
export function summarizeNote(text: string, opts: ParseOptions): ReturnType<typeof summarize> {
	return summarize(parseNote(text, opts));
}
