// Delimited block tracking shared by the include expander, the outline scanner and the source highlighter.
// Verbatim blocks (listing, literal, passthrough, fenced code) and comment blocks hide section titles, anchors and
// xrefs. Comment blocks also hide include directives (Asciidoctor reads them with skip_processing).

export type BlockKind = 'verbatim' | 'comment';

export interface BlockState {
	/** The delimiter line that opened the current block, or "" outside any tracked block. */
	open: string;
	kind: BlockKind | null;
}

export const NO_BLOCK: BlockState = { open: '', kind: null };

const VERBATIM = /^(-{4,}|\.{4,}|\+{4,})$/;
const FENCE = /^(`{3,})/;
const COMMENT = /^(\/{4,})$/;

/** Delimiter kind of a line, or null when the line is not a tracked delimiter. */
function delimiterOf(line: string): { kind: BlockKind; delim: string } | null {
	const t = line.trimEnd();
	const c = COMMENT.exec(t);
	if (c) return { kind: 'comment', delim: c[1] ?? t };
	const v = VERBATIM.exec(t);
	if (v) return { kind: 'verbatim', delim: v[1] ?? t };
	const f = FENCE.exec(t);
	if (f) return { kind: 'verbatim', delim: f[1] ?? '```' };
	return null;
}

/**
 * State after a line, and whether that line is a delimiter.
 * Inside a block only the same delimiter closes it; anything else is content.
 */
export function stepBlock(state: BlockState, line: string): { state: BlockState; delimiter: boolean } {
	const d = delimiterOf(line);
	if (state.kind) {
		if (d && d.delim === state.open) return { state: NO_BLOCK, delimiter: true };
		return { state, delimiter: false };
	}
	if (d) return { state: { open: d.delim, kind: d.kind }, delimiter: true };
	return { state, delimiter: false };
}

/** Line comments start with exactly two slashes (four or more open a comment block). */
export function isLineComment(line: string): boolean {
	return /^\/\/(?!\/\/)/.test(line);
}
