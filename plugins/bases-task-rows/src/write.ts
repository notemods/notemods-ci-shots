// Pure write logic: replace whole lines in a file's text only when each line is still what the view read.

export interface LineEdit {
	/** 0-based line number. */
	line: number;
	/** The line as the view read it (with "\r" in CRLF files). */
	expected: string;
	/** The new line (same line ending as expected). */
	next: string;
}

export interface EditResult {
	content: string;
	applied: number[];
	/** Lines that changed in the file since the view read them. They are left as they are. */
	conflicts: number[];
}

/**
 * Applies line edits to the text of one file. A line is replaced only when it is byte-identical to `expected`;
 * any other line, and every line ending, is kept exactly. Lines are split on "\n" so "\r" stays with its line.
 */
export function applyLineEdits(content: string, edits: readonly LineEdit[]): EditResult {
	const lines = content.split('\n');
	const applied: number[] = [];
	const conflicts: number[] = [];
	for (const e of edits) {
		if (!Number.isInteger(e.line) || e.line < 0 || lines[e.line] !== e.expected || e.next.includes('\n')) {
			conflicts.push(e.line);
			continue;
		}
		// Keep the line ending the file uses for this line, whatever the edit produced.
		const cr = e.expected.endsWith('\r');
		const next = cr && !e.next.endsWith('\r') ? `${e.next}\r` : !cr && e.next.endsWith('\r') ? e.next.slice(0, -1) : e.next;
		lines[e.line] = next;
		applied.push(e.line);
	}
	return { content: applied.length ? lines.join('\n') : content, applied, conflicts };
}
