import { diffArrays } from 'diff';

export const MAX_BYTES = 100 * 1024;
export const MAX_EDITS = 1000;
export const TIMEOUT_MS = 1000;

export interface ReviewOptions {
	timeout?: number;
	maxEditLength?: number;
	author?: string;
	summary?: boolean;
}
export interface Review {
	text: string;
	additions: number;
	deletions: number;
	substitutions: number;
	changed: boolean;
}

/** Keep word runs and whitespace intact. Do not normalize Unicode or line ends. */
export function tokenize(text: string): string[] {
	return text.match(/[\p{L}\p{M}\p{N}]+|\s+|[^\p{L}\p{M}\p{N}\s]/gu) ?? [];
}

export function validateProse(text: string, input: string): void {
	if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error(`${input} exceeds the 100 KB input limit.`);
	const rules: [RegExp, string][] = [
		[/\{(?:\+\+|--|~~|>>|==)/u, 'existing CriticMarkup'],
		[/[{}]/u, 'braces'],
		[/`/u, 'inline code or a code fence'],
		[/^\uFEFF?---(?:\r?\n|$)/u, 'frontmatter'],
		[/\[|\]|https?:\/\//iu, 'a link or image'],
		[/[*_~<>|\\#$]|%%/u, 'Markdown structure'],
		[/^\s*(?:[-+]\s|\d+[.)]\s|[-=]{3,}\s*$)/mu, 'a list or Markdown rule'],
		[/^(?: {4}|\t)[^\r\n]*\S/mu, 'an indented code block'],
	];
	if ([...text].some((c) => (c.charCodeAt(0) < 32 && !'\t\r\n'.includes(c)) || c.charCodeAt(0) === 127)) throw new Error(`Unsupported ${input}: a control character. Use plain prose.`);
	for (const [pattern, reason] of rules) {
		if (pattern.test(text)) throw new Error(`Unsupported ${input}: ${reason}. Use plain prose.`);
	}
}

/** Interpret the generated subset of CriticMarkup. Comments do not change either input. */
export function restoreReview(text: string, accept: boolean): string {
	return text.replace(/\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{>>([\s\S]*?)<<\}/gu,
		(_match: string, add: string | undefined, del: string | undefined, old: string | undefined, next: string | undefined) => {
			if (add !== undefined) return accept ? add : '';
			if (del !== undefined) return accept ? '' : del;
			if (old !== undefined) return accept ? next ?? '' : old;
			return '';
		});
}

/** Build first, then prove both reconstructions before a caller can write a file. */
export function makeReview(baseline: string, final: string, options: ReviewOptions = {}): Review {
	const started = performance.now();
	validateProse(baseline, 'baseline');
	validateProse(final, 'final input');
	const author = options.author?.trim() ?? '';
	if (author.length > 80 || /[{}\r\n<>]/u.test(author)) throw new Error('Author label must have 80 characters or less and no braces, angle brackets or line ends.');
	const counts = { additions: 0, deletions: 0, substitutions: 0 };
	if (baseline === final) return { text: final, ...counts, changed: false };
	const timeout = Math.min(TIMEOUT_MS, Math.max(0, options.timeout ?? TIMEOUT_MS));
	const maxEditLength = Math.min(MAX_EDITS, Math.max(0, options.maxEditLength ?? MAX_EDITS));
	const before = tokenize(baseline);
	const after = tokenize(final);
	const remaining = timeout - (performance.now() - started);
	if (remaining <= 0) throw new Error('Diff work limit: 1 second or 1,000 token edits. Baseline kept.');
	const parts = diffArrays(before, after, { timeout: remaining, maxEditLength });
	if (!parts) throw new Error('Diff work limit: 1 second or 1,000 token edits. Baseline kept.');
	let text = '';
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]!;
		const value = part.value.join('');
		if (part.removed && parts[i + 1]?.added) {
			text += `{~~${value}~>${parts[++i]!.value.join('')}~~}`;
			counts.substitutions++;
		} else if (part.removed) {
			text += `{--${value}--}`;
			counts.deletions++;
		} else if (part.added) {
			text += `{++${value}++}`;
			counts.additions++;
		} else text += value;
	}
	if (author || options.summary) {
		const label = [author ? `Author: ${author}` : '', options.summary ? `Changes: ${counts.additions} additions, ${counts.deletions} deletions, ${counts.substitutions} substitutions` : ''].filter(Boolean).join('; ');
		text = `{>>${label}<<}${text}`;
	}
	if (restoreReview(text, true) !== final || restoreReview(text, false) !== baseline) throw new Error('Restore check failed. Baseline kept. No review file.');
	if (performance.now() - started > timeout) throw new Error('Diff work limit: 1 second or 1,000 token edits. Baseline kept.');
	return { text, ...counts, changed: true };
}
