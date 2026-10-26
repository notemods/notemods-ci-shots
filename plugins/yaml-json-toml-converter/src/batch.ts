import { convert, type Format } from './convert';
export interface CodeBlock { index: number; line: number; source: Format; text: string }
export interface BatchItem { path: string; text: string }
/** Only labelled, unindented fences. A closing fence must match its opener. Each fence pairs, so an info string after the label does not shift the pairs. */
export function codeBlocks(document: string): CodeBlock[] {
	const lines = document.split('\n');
	const found: CodeBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = /^(?:(`{3,})(?=[^`]*$)|(~{3,}))(\S*)/.exec(lines[i] ?? '');
		if (!open) continue;
		const fence = open[1] ?? open[2] ?? '';
		const start = i;
		let end = i + 1;
		while (end < lines.length && !new RegExp(`^${fence[0]}{${fence.length},}\\s*$`).test(lines[end] ?? '')) end++;
		if (end === lines.length) break;
		const label = (open[3] ?? '').toLowerCase();
		if (['yaml', 'yml', 'json', 'toml'].includes(label)) found.push({ index: found.length + 1, line: start + 1, source: label === 'yml' ? 'yaml' : label as Format, text: lines.slice(start + 1, end).join('\n') });
		i = end;
	}
	return found;
}
export function batchPreview(blocks: CodeBlock[], target: Format): BatchItem[] {
	if (!blocks.length) throw new Error('Choose at least one code block.');
	if (blocks.length > 50) throw new Error('Choose 50 code blocks or fewer.');
	return blocks.map((b) => ({ path: `Converted block ${b.index}.${target}`, text: convert(b.text, b.source, target).text }));
}
