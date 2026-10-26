import { formatTime, type Cue } from './cues';

export type Answer = { kind: 'cloze'; start: number; end: number } | { kind: 'qa'; question: string; answer: string };
export interface Card {
	source: string;
	cue: Cue;
	answer: Answer;
}
export interface CardTemplate { name: string; body: string }
export const DEFAULT_TEMPLATE = 'Sentence: {{sentence}}\n\nQuestion: {{question}}\n\nAnswer: {{answer}}';

export function exactCloze(text: string, start: number, end: number): string {
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) throw new Error('Select one nonempty text span.');
	if (text.includes('{{') || text.includes('}}') || text.slice(start, end).includes('::') || text.slice(start, end).endsWith('}')) throw new Error('This text has reserved cloze markers. Use a question and answer.');
	return text.slice(0, start) + '{{c1::' + text.slice(start, end) + '}}' + text.slice(end);
}

export function escapeMarkdown(text: string): string {
	return text.replace(/([\\`*_[\]<>|#!])/g, '\\$1');
}

export function validateTemplate(body: string): void {
	if (!body.trim() || body.length > 10000) throw new Error('A template must have 1 to 10000 characters.');
	const tokens = [...body.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]);
	if (tokens.some((t) => !['sentence', 'question', 'answer'].includes(t ?? ''))) throw new Error('Use only sentence, question and answer placeholders.');
	if (!body.includes('{{sentence}}')) throw new Error('The template must include {{sentence}}.');
}

/** Metadata stays outside the template so a custom body cannot remove the source. */
export function renderCards(cards: Card[], template = DEFAULT_TEMPLATE): string {
	if (!cards.length) throw new Error('Select at least one cue and set its answer.');
	validateTemplate(template);
	const blocks = cards.map((card, index) => {
		const a = card.answer;
		if (a.kind === 'qa' && (!a.question.trim() || !a.answer.trim())) throw new Error('Enter a question and an answer.');
		const sentence = a.kind === 'cloze' ? exactCloze(card.cue.text, a.start, a.end) : card.cue.text;
		const values: Record<string, string> = { sentence: escapeMarkdown(sentence), question: a.kind === 'qa' ? escapeMarkdown(a.question.trim()) : 'Complete the hidden span.', answer: escapeMarkdown(a.kind === 'qa' ? a.answer.trim() : card.cue.text.slice(a.start, a.end)) };
		const body = template.replace(/\{\{(sentence|question|answer)\}\}/g, (_, key: string) => values[key]!);
		return `## Card ${index + 1}\n\nSource path: ${escapeMarkdown(card.source)}\n\nCue number: ${card.cue.number}\n\nStart: ${formatTime(card.cue.start)}\n\nEnd: ${formatTime(card.cue.end)}\n\n${body}`;
	});
	return '# Subtitle sentence cards\n\n' + blocks.join('\n\n---\n\n') + '\n';
}

/** Refuse paths that could leave the vault or enter the app config folder. */
export function validateOutputPath(path: string, configDir: string): void {
	if (!path || path.startsWith('/') || path.includes('\\') || /[:*?"<>|]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32) || !path.endsWith('.md')) throw new Error('Use a vault path with a .md extension.');
	const parts = path.split('/');
	if (parts.some((part) => !part.trim() || part === '.' || part === '..') || path === configDir || path.startsWith(configDir + '/')) throw new Error('Use a note path outside the app config folder.');
}

export function availablePath(path: string, exists: (path: string) => boolean): string {
	if (!exists(path)) return path;
	const stem = path.slice(0, -3);
	for (let n = 2; n < 10000; n++) {
		const candidate = `${stem} ${n}.md`;
		if (!exists(candidate)) return candidate;
	}
	throw new Error('Could not find a free output path.');
}
