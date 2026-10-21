import { convertHeadings, type HeadingCaseMode } from './core/index';

export interface LineRange {
	from: number;
	to: number;
}

export interface HeadingEdit {
	/** One change per heading line, ready for editor.transaction(). */
	changes: Array<{ from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }>;
	headings: number;
	message: string;
}

const MODE_NAME: Record<HeadingCaseMode, string> = { sentence: 'sentence case', title: 'title case' };

/** Works out which heading lines change. Pure, so it is tested without an editor. */
export function planHeadingEdit(text: string, mode: HeadingCaseMode, keep: string[], range: LineRange | null): HeadingEdit {
	const result = convertHeadings(text, { mode, keep, fromLine: range?.from, toLine: range?.to });
	const where = range ? 'in the selection' : 'in this note';
	let message: string;
	if (result.headings === 0) message = `No headings ${where}.`;
	else if (result.changes.length === 0)
		message = result.headings === 1 ? `The heading ${where} already uses ${MODE_NAME[mode]}.` : `All ${result.headings} headings ${where} already use ${MODE_NAME[mode]}.`;
	else message = `Changed ${result.changes.length} of ${result.headings} ${result.headings === 1 ? 'heading' : 'headings'} to ${MODE_NAME[mode]}.`;
	return {
		changes: result.changes.map((c) => ({
			from: { line: c.line, ch: 0 },
			to: { line: c.line, ch: c.before.length },
			text: c.after,
		})),
		headings: result.headings,
		message,
	};
}
