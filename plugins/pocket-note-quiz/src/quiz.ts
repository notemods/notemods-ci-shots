export type Mark = 'correct' | 'wrong' | null;
export type Filter = 'all' | 'wrong' | 'unmarked';
export interface Card {
	path: string;
	line: number;
	question: string;
	answer: string;
	mark: Mark;
}
export interface Response extends Card { result: Exclude<Mark, null> }
export const MARKS = { correct: '✅', wrong: '❌' } as const;

const MARK_END = /(?:✅|❌)+[ \t]*$/;
const BLOCK_ID = /\s\^[A-Za-z0-9-]+$/;

/** Splits a trailing block id off the line. A mark goes before it so that block links keep working. */
function splitBlockId(line: string): [string, string] {
	const m = BLOCK_ID.exec(line);
	return m ? [line.slice(0, m.index), m[0]] : [line, ''];
}
/** The original writes these emoji at the end with no separator. */
export function stripMark(line: string): string {
	const [body, id] = splitBlockId(line.replace(MARK_END, ''));
	return body.replace(MARK_END, '') + id;
}
function markOf(line: string): Mark {
	const end = MARK_END.exec(line)?.[0] ?? MARK_END.exec(splitBlockId(line)[0])?.[0] ?? '';
	const last = end.trimEnd();
	return last.endsWith(MARKS.wrong) ? 'wrong' : last.endsWith(MARKS.correct) ? 'correct' : null;
}
export function withMark(question: string, result: Exclude<Mark, null>): string {
	const [body, id] = splitBlockId(question);
	return body + MARKS[result] + id;
}
function parts(text: string): string[] { return text.split(/(\r\n|\n|\r)/); }

/** Answers continue to a blank line. Question markers inside answers are text. */
export function parseQuestions(text: string, marker = '?', path = ''): Card[] {
	if (!marker.trim()) return [];
	const lines = parts(text).filter((_, i) => i % 2 === 0);
	const excluded = new Set<number>();
	let fence = '';
	let fenceSize = 0;
	let frontmatter = lines[0] === '---' && lines.slice(1).some((l) => l === '---' || l === '...');
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		if (frontmatter) {
			excluded.add(i);
			if (i > 0 && (raw === '---' || raw === '...')) frontmatter = false;
			continue;
		}
		const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
		if (fence) {
			excluded.add(i);
			if (match && match[1]![0] === fence && match[1]!.length >= fenceSize && !match[2]!.trim()) fence = '';
			continue;
		}
		if (match) { excluded.add(i); fence = match[1]![0]!; fenceSize = match[1]!.length; }
	}
	const cards: Card[] = [];
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		if (excluded.has(i) || !raw.includes(marker)) continue;
		const line = i;
		const answer: string[] = [];
		while (i + 1 < lines.length && lines[i + 1]!.trim() !== '') answer.push(lines[++i]!);
		cards.push({ path, line, question: stripMark(raw), answer: answer.join('\n'), mark: markOf(raw) });
	}
	return cards;
}
export function filterQuestions(cards: Card[], filter: Filter): Card[] {
	return cards.filter((c) => filter === 'all' || (filter === 'wrong' ? c.mark === 'wrong' : c.mark === null));
}
export function answerText(answer: string): string { return answer || '(no answer)'; }

/** Compare the current parser position and question, then change only that line. */
export function applyMarks(text: string, responses: Response[], marker = '?'): { text: string; applied: number; skipped: number } {
	const p = parts(text);
	const current = new Map(parseQuestions(text, marker).map((c) => [c.line, c]));
	let applied = 0;
	let skipped = 0;
	for (const c of responses) {
		if (current.get(c.line)?.question !== c.question) { skipped++; continue; }
		p[c.line * 2] = withMark(c.question, c.result);
		applied++;
	}
	return { text: p.join(''), applied, skipped };
}
export function clearMarks(text: string, marker = '?'): string {
	const p = parts(text);
	for (const c of parseQuestions(text, marker)) p[c.line * 2] = c.question;
	return p.join('');
}
export function score(responses: Response[]): { correct: number; wrong: number; total: number } {
	const correct = responses.filter((c) => c.result === 'correct').length;
	return { correct, wrong: responses.length - correct, total: responses.length };
}
export function inFolder(path: string, folder: string): boolean {
	return !folder || path.startsWith(folder + '/');
}
export function scoreReport(responses: Response[], date: string): string {
	const s = score(responses);
	const notes = [...new Set(responses.map((c) => c.path))];
	return `# Pocket Note Quiz score\n\nDate: ${date}\n\nCorrect: ${s.correct}\nWrong: ${s.wrong}\nTotal: ${s.total}\n\n## Source notes\n\n${notes.map((p) => `- ${p}`).join('\n')}\n`;
}
