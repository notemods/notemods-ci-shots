export interface WordStart { from: number; split: number; to: number }

/** UTF-16 offsets. A base letter and its combining marks stay together. */
export function wordStarts(text: string, strength: number, minimum: number): WordStart[] {
	const result: WordStart[] = [];
	for (const match of text.matchAll(/\p{L}[\p{L}\p{M}]*/gu)) {
		const word = match[0];
		const letters = Array.from(word).filter((c) => /\p{L}/u.test(c));
		if (letters.length < minimum || letters.some((c) => !/[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u.test(c))) continue;
		const count = Math.max(1, Math.round(letters.length * strength));
		const units = word.match(/\p{L}\p{M}*/gu) ?? [];
		const length = units.slice(0, count).join('').length;
		result.push({ from: match.index, split: match.index + length, to: match.index + word.length });
	}
	return result;
}
