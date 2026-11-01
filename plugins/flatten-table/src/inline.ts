// A small inline Markdown tokenizer for table cells. Pure, so it is unit tested.
// It covers what people put in table cells: [[links]], [text](url), `code`, **bold**, *italic*, ~~strike~~, ==mark==, #tags.
// Anything else stays plain text. Nesting is not parsed: the inner text of bold or italic is plain text.

export type Token =
	| { kind: 'text'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'wikilink'; target: string; text: string }
	| { kind: 'link'; href: string; text: string }
	| { kind: 'tag'; text: string }
	| { kind: 'strong' | 'em' | 'del' | 'mark'; text: string };

const RULES: { re: RegExp; make: (m: RegExpExecArray) => Token }[] = [
	{ re: /^(`+)([\s\S]*?[^`])\1(?!`)/, make: (m) => ({ kind: 'code', text: m[2]!.trim() }) },
	{
		re: /^!?\[\[([^\]|#^]*)((?:[#^][^\]|]*)?)(?:\|([^\]]*))?\]\]/,
		make: (m) => ({ kind: 'wikilink', target: m[1]! + m[2]!, text: m[3] ?? (m[1]! + m[2]!.replace(/^[#^]/, ' > ')).trim() }),
	},
	{ re: /^\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => ({ kind: 'link', href: m[2]!, text: m[1]! }) },
	{ re: /^\*\*(?=\S)([\s\S]*?\S)\*\*/, make: (m) => ({ kind: 'strong', text: m[1]! }) },
	{ re: /^__(?=\S)([\s\S]*?\S)__/, make: (m) => ({ kind: 'strong', text: m[1]! }) },
	{ re: /^\*(?=\S)([\s\S]*?\S)\*/, make: (m) => ({ kind: 'em', text: m[1]! }) },
	{ re: /^_(?=\S)([\s\S]*?\S)_(?!\w)/, make: (m) => ({ kind: 'em', text: m[1]! }) },
	{ re: /^~~(?=\S)([\s\S]*?\S)~~/, make: (m) => ({ kind: 'del', text: m[1]! }) },
	{ re: /^==(?=\S)([\s\S]*?\S)==/, make: (m) => ({ kind: 'mark', text: m[1]! }) },
	{ re: /^#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*/u, make: (m) => ({ kind: 'tag', text: m[0] }) },
];

/** Characters where a token can start. Text runs up to the next one. */
const START = /[`![*_~=#]/;

/** Splits a cell into tokens. Plain text between tokens is merged into one text token. */
export function tokenize(cell: string): Token[] {
	const out: Token[] = [];
	const push = (t: string) => {
		const last = out[out.length - 1];
		if (last && last.kind === 'text') last.text += t;
		else out.push({ kind: 'text', text: t });
	};
	let s = cell;
	for (let guard = 0; s.length > 0 && guard < 10_000; guard++) {
		const atWordStart = out.length === 0 || /\s$/.test(out[out.length - 1]?.kind === 'text' ? (out[out.length - 1] as { text: string }).text : ' ');
		let hit: { tok: Token; len: number } | null = null;
		for (const r of RULES) {
			if (r.re.source.startsWith('^#') && !atWordStart) continue;
			const m = r.re.exec(s);
			if (m) {
				hit = { tok: r.make(m), len: m[0].length };
				break;
			}
		}
		if (hit) {
			out.push(hit.tok);
			s = s.slice(hit.len);
			continue;
		}
		const next = s.slice(1).search(START);
		const n = next < 0 ? s.length : next + 1;
		push(s.slice(0, n));
		s = s.slice(n);
	}
	// The loop guard stops a very long cell early. The rest stays as plain text, so no text is lost.
	if (s.length > 0) push(s);
	return out;
}
