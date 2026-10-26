/** Single-line math in plain paragraphs. Offsets use UTF-16, as CodeMirror does. */
export interface Equation { from: number; to: number; line: number; text: string }

export function equations(source: string): Equation[] {
	const result: Equation[] = [];
	const lines = source.split('\n');
	let offset = 0;
	let fence = '';
	let fenceSize = 0;
	let display = false;
	let properties = lines[0]?.trim() === '---';
	let nested = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const start = offset;
		offset += line.length + 1;
		if (properties) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) properties = false; continue; }
		const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (f) {
			const run = f[1]!;
			if (!fence) { fence = run[0]!; fenceSize = run.length; }
			else if (run[0] === fence && run.length >= fenceSize && /^\s*$/.test(line.slice(f[0].length))) fence = '';
			continue;
		}
		if (fence) continue;
		if (!line.trim()) { nested = false; continue; }
		if (/^\s{0,3}(?:>|[-+*]\s|\d+[.)]\s)/.test(line)) nested = true;
		if (line.includes('$$')) { if ((line.match(/\$\$/g)?.length ?? 0) % 2) display = !display; continue; }
		if (display || nested || /^\s{0,3}(?:#|---\s*$|===\s*$)/.test(line) || /^(?: {4}|\t)/.test(line)) continue;
		// Ambiguous markup is left to Obsidian. Skip this line as a unit.
		if (/[`|<>]/.test(line) || line.includes('\\$') || /!?(?:\[|\])/.test(line)) continue;
		if (/^\s*(?:=+|-+)\s*$/.test(lines[i + 1] ?? '')) continue;
		const dollars: number[] = [];
		for (let j = 0; j < line.length; j++) if (line[j] === '$') dollars.push(j);
		if (dollars.length % 2) continue;
		for (let j = 0; j < dollars.length; j += 2) {
			const a = dollars[j]!;
			const b = dollars[j + 1]!;
			const text = line.slice(a + 1, b);
			if (!text.trim()) continue;
			result.push({ from: start + a, to: start + b + 1, line: i + 1, text });
		}
	}
	return result;
}

/** Folder paths have exact, case-sensitive segment boundaries. */
export function folderEnabled(path: string, rules: string, pro: boolean): boolean {
	if (!pro) return true;
	const entries = rules.split('\n').map((s) => s.trim()).filter(Boolean);
	let enabled = true;
	let depth = -1;
	for (const entry of entries) {
		const on = !entry.startsWith('-');
		const folder = entry.replace(/^[+-]/, '').replace(/^\/+|\/+$/g, '');
		if (folder && (path === folder || path.startsWith(folder + '/')) && folder.length >= depth) {
			enabled = on;
			depth = folder.length;
		}
	}
	return enabled;
}
