// Pure preamble logic: find the TeX part of a file, read the macro definitions, and expand a sample call.
// No Obsidian import here, so vitest and the golden vectors run it directly.

/** Commands that make TeX load an extension or another file. The plugin rejects a file that has one. */
export const BLOCKED_COMMANDS = ['require', 'usepackage', 'RequirePackage', 'input', 'include'] as const;

/** Commands that the plugin reads as a definition. */
export type DefKind = 'newcommand' | 'renewcommand' | 'providecommand' | 'def' | 'DeclareMathOperator';
const DEFINERS: ReadonlySet<string> = new Set<DefKind>(['newcommand', 'renewcommand', 'providecommand', 'def', 'DeclareMathOperator']);

export interface MacroDef {
	/** Control sequence name without the backslash. */
	name: string;
	kind: DefKind;
	/** Number of arguments, 0 to 9. */
	args: number;
	/** Default value of the first argument, or null when the first argument is required. */
	optional: string | null;
	/** Replacement text. For DeclareMathOperator, the operator text. */
	body: string;
	/** The definition as it is in the file, given to the engine. */
	source: string;
	/** 1-based line of the definition. */
	line: number;
}

export interface Issue {
	line: number;
	message: string;
}

export interface Preamble {
	defs: MacroDef[];
	/** Definitions that the plugin cannot read. The other definitions still load. */
	errors: Issue[];
	/** Package or file commands. When this list is not empty, the plugin loads no definition from the file. */
	blocked: Issue[];
}

/** File types that the plugin reads. */
export function isPreambleExtension(ext: string): boolean {
	return ext === 'md' || ext === 'tex' || ext === 'sty';
}

/**
 * The TeX part of a file, with the same line numbers as the file. Other lines become empty.
 * A .tex or .sty file is TeX from start to end. In a Markdown file, the TeX part is the text in $$ blocks and in
 * code blocks marked tex or latex. A Markdown file with no such block is TeX after its front matter.
 */
export function extractTex(text: string, ext: string): string {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	if (ext !== 'md') return lines.join('\n');
	let start = 0;
	if (lines[0]?.trim() === '---') {
		const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'));
		if (end > 0) start = end + 1;
	}
	const out: string[] = lines.map(() => '');
	let found = false;
	let fence: string | null = null;
	let fenceTex = false;
	let inMath = false;
	for (let i = start; i < lines.length; i++) {
		const line = lines[i]!;
		if (fence !== null) {
			if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') {
				fence = null;
				continue;
			}
			if (fenceTex) out[i] = line;
			continue;
		}
		const open = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
		if (open && !inMath) {
			fence = open[1]!;
			fenceTex = /^(tex|latex)$/i.test(open[2]!);
			if (fenceTex) found = true;
			continue;
		}
		// Split the line at each $$ and keep the parts inside math.
		const parts = line.split('$$');
		let kept = '';
		for (let p = 0; p < parts.length; p++) {
			if (p > 0) {
				inMath = !inMath;
				found = true;
				kept += '  ';
			}
			kept += inMath ? parts[p] : ' '.repeat(parts[p]!.length);
		}
		out[i] = kept.trimEnd();
	}
	if (found) return out.join('\n');
	return lines.map((l, i) => (i < start ? '' : l)).join('\n');
}

/** Removes TeX comments (an unescaped % to the end of its line). Keeps the line breaks. */
export function stripComments(src: string): string {
	return src
		.split('\n')
		.map((line) => {
			for (let i = 0; i < line.length; i++) {
				if (line[i] === '\\') i++;
				else if (line[i] === '%') return line.slice(0, i);
			}
			return line;
		})
		.join('\n');
}

class Reader {
	pos = 0;
	constructor(readonly src: string) {}
	get done(): boolean {
		return this.pos >= this.src.length;
	}
	peek(): string {
		return this.src[this.pos] ?? '';
	}
	/** Offsets of the line breaks, made at the first line() call, so a large file does not take quadratic time. */
	private breaks: number[] | null = null;
	line(at = this.pos): number {
		if (this.breaks === null) {
			this.breaks = [];
			for (let i = this.src.indexOf('\n'); i >= 0; i = this.src.indexOf('\n', i + 1)) this.breaks.push(i);
		}
		// The count of line breaks before at, by binary search.
		let lo = 0;
		let hi = this.breaks.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (this.breaks[mid]! < at) lo = mid + 1;
			else hi = mid;
		}
		return lo + 1;
	}
	skipSpace(): void {
		while (!this.done && /\s/.test(this.peek())) this.pos++;
	}
	/** Reads \name and returns name, or null. A name is letters, or one character that is not a letter. */
	controlSequence(): string | null {
		if (this.peek() !== '\\') return null;
		const m = /^\\([A-Za-z]+|[^A-Za-z\s])/.exec(this.src.slice(this.pos));
		if (!m) return null;
		this.pos += m[0].length;
		return m[1]!;
	}
	/** Reads a {balanced group} and returns its inner text, or null when the group does not close. */
	group(): string | null {
		if (this.peek() !== '{') return null;
		let depth = 0;
		const from = this.pos;
		for (let i = this.pos; i < this.src.length; i++) {
			const c = this.src[i];
			if (c === '\\') i++;
			else if (c === '{') depth++;
			else if (c === '}' && --depth === 0) {
				this.pos = i + 1;
				return this.src.slice(from + 1, i);
			}
		}
		return null;
	}
	/** Reads [text] and returns text, or null when there is no bracket. Throws when the bracket does not close. */
	bracket(): string | null {
		if (this.peek() !== '[') return null;
		const end = this.src.indexOf(']', this.pos);
		if (end < 0) throw new Error('missing ]');
		const text = this.src.slice(this.pos + 1, end);
		this.pos = end + 1;
		return text;
	}
	/** Moves to the next line that can start a new definition. */
	skipLine(): void {
		const nl = this.src.indexOf('\n', this.pos);
		this.pos = nl < 0 ? this.src.length : nl + 1;
	}
}

/** Lines that use a blocked command, in file order. */
export function findBlocked(src: string): Issue[] {
	const out: Issue[] = [];
	const re = new RegExp(String.raw`\\(${BLOCKED_COMMANDS.join('|')})(?![A-Za-z])`, 'g');
	const lines = src.split('\n');
	lines.forEach((line, i) => {
		for (const m of line.matchAll(re)) out.push({ line: i + 1, message: `\\${m[1]} loads a package or a file. The plugin does not load packages.` });
	});
	return out;
}

function readDefinition(r: Reader, kind: DefKind, start: number): MacroDef {
	const line = r.line(start);
	let name: string | null;
	let args = 0;
	let optional: string | null = null;
	if (kind === 'def') {
		name = r.controlSequence();
		if (!name) throw new Error('\\def needs a control sequence name');
		const params = /^(?:#[1-9])*/.exec(r.src.slice(r.pos))![0];
		r.pos += params.length;
		args = params.length / 2;
		for (let i = 0; i < args; i++) if (params[i * 2 + 1] !== String(i + 1)) throw new Error(`\\def\\${name} has its parameters out of sequence`);
	} else {
		if (kind !== 'DeclareMathOperator' && r.peek() === '*') r.pos++;
		if (kind === 'DeclareMathOperator' && r.peek() === '*') r.pos++;
		r.skipSpace();
		if (r.peek() === '{') {
			const inner = r.group();
			if (inner === null) throw new Error(`\\${kind} has a name group with no }`);
			const m = /^\s*\\([A-Za-z]+|[^A-Za-z\s])\s*$/.exec(inner);
			if (!m) throw new Error(`\\${kind} needs one control sequence as its name, not {${inner}}`);
			name = m[1]!;
		} else {
			name = r.controlSequence();
			if (!name) throw new Error(`\\${kind} needs a control sequence name`);
		}
		if (kind !== 'DeclareMathOperator') {
			r.skipSpace();
			const n = r.bracket();
			if (n !== null) {
				if (!/^\s*[0-9]\s*$/.test(n)) throw new Error(`\\${kind}{\\${name}} has [${n}] as its argument count. Use a number from 0 to 9.`);
				args = Number(n.trim());
				r.skipSpace();
				const d = r.bracket();
				if (d !== null) {
					if (args === 0) throw new Error(`\\${kind}{\\${name}} has a default value but no argument`);
					optional = d;
				}
			}
		}
	}
	r.skipSpace();
	if (r.peek() !== '{') throw new Error(`\\${kind}{\\${name}} has no replacement text`);
	const body = r.group();
	if (body === null) throw new Error(`\\${kind}{\\${name}} has a replacement text with no closing }`);
	for (const m of body.matchAll(/#(\d)/g)) {
		const k = Number(m[1]);
		if (k < 1 || k > args) throw new Error(`\\${kind}{\\${name}} uses #${k} but has ${args} argument${args === 1 ? '' : 's'}`);
	}
	return { name, kind, args, optional, body, source: r.src.slice(start, r.pos).trim(), line };
}

/** Reads the definitions of a TeX preamble. Each problem goes to errors or blocked, with its line. */
export function parsePreamble(tex: string): Preamble {
	const src = stripComments(tex);
	const blocked = findBlocked(src);
	const defs: MacroDef[] = [];
	const errors: Issue[] = [];
	const r = new Reader(src);
	for (;;) {
		r.skipSpace();
		if (r.done) break;
		const start = r.pos;
		const cs = r.controlSequence();
		if (cs === null || !DEFINERS.has(cs)) {
			const shown = r.src.slice(start, r.src.indexOf('\n', start) < 0 ? undefined : r.src.indexOf('\n', start)).trim();
			errors.push({ line: r.line(start), message: `"${shown.length > 40 ? shown.slice(0, 40) + '...' : shown}" is not a macro definition` });
			r.pos = start;
			r.skipLine();
			continue;
		}
		try {
			defs.push(readDefinition(r, cs as DefKind, start));
		} catch (e) {
			errors.push({ line: r.line(start), message: e instanceof Error ? e.message : String(e) });
			r.pos = start;
			r.skipLine();
		}
	}
	return { defs, errors, blocked };
}

/**
 * The definition to give the engine. MathJax 3 and 4 have no \providecommand, so it goes to the engine as \newcommand.
 * The plugin gives it only when the command is not defined yet (see main.ts).
 */
export function engineSource(def: MacroDef): string {
	return def.kind === 'providecommand' ? def.source.replace(/^\\providecommand/, '\\newcommand') : def.source;
}

/** Text of a sample call: required arguments get the letters a, b, c and so on. */
export function sampleCall(def: MacroDef): string {
	const letters = 'abcdefghi';
	const first = def.optional === null ? 0 : 1;
	let s = `\\${def.name}`;
	for (let i = first; i < def.args; i++) s += `{${letters[i]}}`;
	return s;
}

/** The longest expansion, in characters, and the most expansion steps. A loop of macros stops at these limits. */
export const EXPAND_MAX_CHARS = 20_000;
export const EXPAND_MAX_STEPS = 500;

/**
 * Expands the macros of a library in src without the engine, so a preview defines nothing in the engine.
 * Commands that the library does not define stay as they are. Returns an error when the expansion is too long.
 */
export function expand(src: string, defs: readonly MacroDef[]): { text: string; error: string | null } {
	const map = new Map<string, MacroDef>();
	for (const d of defs) if (!(d.kind === 'providecommand' && map.has(d.name))) map.set(d.name, d);
	let text = src;
	let steps = 0;
	let pos = 0;
	while (pos < text.length) {
		const at = text.indexOf('\\', pos);
		if (at < 0) break;
		const r = new Reader(text);
		r.pos = at;
		const name = r.controlSequence();
		const def = name === null ? undefined : map.get(name);
		if (!def) {
			pos = r.pos > at ? r.pos : at + 1;
			continue;
		}
		if (++steps > EXPAND_MAX_STEPS) return { text, error: `The expansion of \\${def.name} does not stop after ${EXPAND_MAX_STEPS} steps` };
		const values: string[] = [];
		if (def.kind === 'DeclareMathOperator') {
			text = text.slice(0, at) + `\\operatorname{${def.body}}` + text.slice(r.pos);
			pos = at + '\\operatorname{'.length;
			continue;
		}
		for (let i = 0; i < def.args; i++) {
			if (i === 0 && def.optional !== null) {
				const save = r.pos;
				r.skipSpace();
				let v: string | null = null;
				try {
					v = r.bracket();
				} catch {
					v = null;
				}
				if (v === null) r.pos = save;
				values.push(v ?? def.optional);
				continue;
			}
			r.skipSpace();
			if (r.peek() === '{') {
				const g = r.group();
				if (g === null) return { text, error: `An argument of \\${def.name} has no closing }` };
				values.push(g);
			} else if (r.peek() === '\\') {
				const from = r.pos;
				r.controlSequence();
				values.push(text.slice(from, r.pos));
			} else if (!r.done) {
				values.push(r.peek());
				r.pos++;
			} else {
				return { text, error: `\\${def.name} needs ${def.args} argument${def.args === 1 ? '' : 's'}` };
			}
		}
		const replaced = def.body.replace(/#(\d)/g, (_, k: string) => values[Number(k) - 1] ?? '');
		text = text.slice(0, at) + replaced + text.slice(r.pos);
		if (text.length > EXPAND_MAX_CHARS) return { text: text.slice(0, 200), error: `The expansion of \\${def.name} is longer than ${EXPAND_MAX_CHARS} characters` };
		pos = at;
	}
	return { text, error: null };
}

/** One line for a notice or the preview: "line 4: message". */
export function formatIssue(i: Issue): string {
	return `line ${i.line}: ${i.message}`;
}
