import { NO_BLOCK, stepBlock, type BlockState } from './blocks';

/** The listing or literal block that a diagram style line applies to, after any title or attribute lines. */
function opensDiagram(lines: string[], from: number): boolean {
	for (let i = from; i < lines.length; i++) {
		const line = (lines[i] ?? '').trimEnd();
		if (/^(-{4,}|\.{4,})$/.test(line)) return true;
		if (!/^\.[^.\s]/.test(line) && !/^\[.*\]$/.test(line)) return false;
	}
	return false;
}

/** Give diagram blocks a language, so Asciidoctor keeps their source as code. */
export function prepareMermaid(source: string): string {
	const lines = source.split('\n');
	let state: BlockState = NO_BLOCK;
	return lines.map((line, i) => {
		const outside = !state.kind;
		state = stepBlock(state, line).state;
		// The diagram extension form: [mermaid] or [mermaid,target,format] above a listing or literal block.
		const style = /^\[mermaid(?:,[^\]]*)?\](\s*)$/.exec(line);
		if (outside && style && opensDiagram(lines, i + 1)) return `[source,mermaid]${style[1] ?? ''}`;
		return line;
	}).join('\n');
}

/** A fence longer than every backtick run keeps the whole source inside one block. */
export function mermaidMarkdown(source: string): string {
	let length = 3;
	for (const run of source.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1);
	const fence = '`'.repeat(length);
	return `${fence}mermaid\n${source}\n${fence}`;
}
