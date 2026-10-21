import { countWords, readableText, scanLines } from './core/index';

export type CountMode = 'source' | 'rendered';

export interface WordCountStats {
	wordCount: number;
	readingTimeMinutes: number;
	readingTimeSeconds: number;
}

/** Counts a note body and estimates its reading time with the same text rules. */
export function deriveStats(
	markdown: string,
	mode: CountMode = 'source',
	includeCodeBlocks = false,
	wordsPerMinute = 200,
	cjkCharsPerMinute = 500,
): WordCountStats {
	const text = mode === 'rendered'
		? readableText(markdown, includeCodeBlocks)
		: scanLines(markdown).filter((line) => !line.inFrontmatter).map((line) => line.text).join('\n');
	const { words, cjkChars } = countWords(text);
	const wpm = positive(wordsPerMinute, 200);
	const cpm = positive(cjkCharsPerMinute, 500);
	const exactSeconds = (words / wpm + cjkChars / cpm) * 60;
	const readingTimeSeconds = Math.ceil(Math.round(exactSeconds * 1e6) / 1e6);
	return {
		wordCount: words + cjkChars,
		readingTimeMinutes: readingTimeSeconds === 0 ? 0 : Math.ceil(readingTimeSeconds / 60),
		readingTimeSeconds,
	};
}

function positive(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}
