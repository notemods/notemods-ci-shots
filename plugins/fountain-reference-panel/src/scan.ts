// Pure Fountain reference logic. No Obsidian imports: the golden vectors and unit tests call these functions directly.
// A reference is [[>target]] or [[>target|display text]]. Other [[...]] items are Fountain notes and are not references.

/** One [[>target]] reference in the active (not boneyard) text of a script. */
export interface FountainRef {
	/** The target as written, with a heading or block part if one is present. */
	target: string;
	/** The target without the #heading part. This goes to MetadataCache.getFirstLinkpathDest. */
	linkpath: string;
	/** The display text after "|", or else the target. */
	display: string;
	/** Line number in the script, from 1. */
	line: number;
	/** The scene heading above the reference, or "" before the first scene heading. */
	scene: string;
	/** The line of the reference, with references replaced by their display text and Fountain notes removed. */
	context: string;
	/** The previous non-blank line in the same scene, cleaned the same way, or "". */
	before: string;
}

/** A reference with its script path and its resolved target path (null when no file matches). */
export interface ResolvedRef extends FountainRef {
	source: string;
	dest: string | null;
}

/** One script for a scan. text is the saved content; error is the read failure message. */
export interface ScriptInput {
	path: string;
	text?: string;
	error?: string;
}

export interface ScanResult {
	/** Number of scripts in the scan, including the scripts that could not be read. */
	scripts: number;
	refs: ResolvedRef[];
	/** Number of references whose target matched no file. */
	unresolved: number;
	failures: { path: string; error: string }[];
}

const MAX_CONTEXT = 200;
const REF = /\[\[>([^\]\n|]*)(?:\|([^\]\n]*))?\]\]/g;
const NOTE = /\[\[(?!>)[^\]\n]*\]\]/g;
const SCENE = /^(?:int\.?\/ext|i\/e|int|ext|est)[. ]/i;
const FORCED_SCENE = /^\.[^.\s]/;
const SCENE_NUMBER = /\s*#[^#\s]*#\s*$/;

function clip(s: string): string {
	return s.length > MAX_CONTEXT ? `${s.slice(0, MAX_CONTEXT - 3)}...` : s;
}

/** Replaces each reference with its display text, removes Fountain notes and collapses white space. */
export function cleanLine(line: string): string {
	const out = line.replace(REF, (_m: string, t: string, d: string | undefined) => (d !== undefined && d.trim() !== '' ? d.trim() : t.trim())).replace(NOTE, ' ');
	return clip(out.replace(/\s+/g, ' ').trim());
}

/** The scene heading text of a line, or null if the line is not a scene heading. */
export function sceneHeading(line: string): string | null {
	const t = line.trim();
	let h: string;
	if (FORCED_SCENE.test(t)) h = t.slice(1);
	else if (SCENE.test(t)) h = t;
	else return null;
	return cleanLine(h.replace(SCENE_NUMBER, ''));
}

/**
 * Finds the [[>target]] references in the saved text of one Fountain script.
 * A small state machine removes /* boneyard *\/ text first, also when a boneyard block spans lines.
 * A scene heading must follow a blank line or the start of the file, as the Fountain syntax requires.
 */
export function parseFountain(text: string): FountainRef[] {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const refs: FountainRef[] = [];
	let inBoneyard = false;
	let prevBlank = true;
	let scene = '';
	let before = '';
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? '';
		let active = '';
		let hadBoneyard = inBoneyard;
		let p = 0;
		while (p < raw.length) {
			if (inBoneyard) {
				const end = raw.indexOf('*/', p);
				if (end < 0) {
					p = raw.length;
				} else {
					inBoneyard = false;
					p = end + 2;
				}
			} else {
				const start = raw.indexOf('/*', p);
				if (start < 0) {
					active += raw.slice(p);
					p = raw.length;
				} else {
					active += raw.slice(p, start);
					inBoneyard = true;
					hadBoneyard = true;
					p = start + 2;
				}
			}
		}
		const blank = active.trim() === '';
		// A line that holds only boneyard text does not count as a line of the script.
		if (blank && hadBoneyard) continue;
		if (blank) {
			prevBlank = true;
			continue;
		}
		const heading = prevBlank ? sceneHeading(active) : null;
		if (heading !== null) {
			scene = heading;
			before = '';
		}
		const context = cleanLine(active);
		for (const m of active.matchAll(REF)) {
			const target = (m[1] ?? '').trim();
			const hash = target.indexOf('#');
			const linkpath = (hash < 0 ? target : target.slice(0, hash)).trim();
			if (linkpath === '') continue;
			const alias = (m[2] ?? '').trim();
			refs.push({ target, linkpath, display: alias !== '' ? alias : target, line: i + 1, scene, context, before: heading !== null ? '' : before });
		}
		if (heading === null) before = context;
		prevBlank = false;
	}
	return refs;
}

/** Scans the scripts. resolve(linkpath, sourcePath) gives the path of the target file, or null. */
export function scanScripts(scripts: ScriptInput[], resolve: (linkpath: string, sourcePath: string) => string | null): ScanResult {
	const result: ScanResult = { scripts: scripts.length, refs: [], unresolved: 0, failures: [] };
	for (const s of [...scripts].sort((a, b) => a.path.localeCompare(b.path))) {
		if (typeof s.text !== 'string') {
			result.failures.push({ path: s.path, error: s.error ?? 'The file could not be read.' });
			continue;
		}
		for (const ref of parseFountain(s.text)) {
			const dest = resolve(ref.linkpath, s.path);
			if (dest === null) result.unresolved++;
			result.refs.push({ ...ref, source: s.path, dest });
		}
	}
	return result;
}

/** The references whose resolved target is the note at activePath, by script path and then line. */
export function incoming(scan: ScanResult, activePath: string): ResolvedRef[] {
	return scan.refs.filter((r) => r.dest !== null && r.dest === activePath).sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line);
}

/** One table row of a golden vector: the visible fields of a reference row. */
export interface RowView {
	source: string;
	line: number;
	scene: string;
	display: string;
	context: string;
	before: string;
}

export function rowView(r: ResolvedRef): RowView {
	return { source: r.source, line: r.line, scene: r.scene, display: r.display, context: r.context, before: r.before };
}

/**
 * The golden vector entry point. links maps a script path to a map of linkpath to target path; this stands in
 * for MetadataCache.getFirstLinkpathDest(linkpath, scriptPath). A missing entry is an unresolved target.
 */
export function findIncoming(scripts: ScriptInput[], links: Record<string, Record<string, string>>, activePath: string | null, folders: string[] = []): { rows: RowView[]; status: string; unresolved: number; scripts: number; failed: string[] } {
	const picked = scripts.filter((s) => inFolders(s.path, folders));
	const scan = scanScripts(picked, (linkpath, source) => links[source]?.[linkpath] ?? null);
	const rows = activePath !== null && activePath.endsWith('.md') ? incoming(scan, activePath) : [];
	return {
		rows: rows.map(rowView),
		status: panelStatus(scan, activePath, rows, folders.length > 0),
		unresolved: scan.unresolved,
		scripts: scan.scripts,
		failed: scan.failures.map((f) => f.path),
	};
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * The status line above the list. An empty list never shows alone: the status says if no note is open,
 * if no scan ran, if no script was found, or if some scripts could not be read.
 */
export function panelStatus(scan: ScanResult | null, activePath: string | null, rows: ResolvedRef[], filtered = false): string {
	if (activePath === null || !activePath.endsWith('.md')) return 'Open a Markdown note to see the Fountain references to it.';
	if (scan === null) return 'Not scanned yet. Select Refresh to scan the saved .fountain files.';
	const where = filtered ? ' in the project folders' : '';
	if (scan.scripts === 0) return `No saved .fountain files were found${where}. Nothing was scanned.`;
	const read = scan.scripts - scan.failures.length;
	const parts: string[] = [];
	if (rows.length > 0) {
		const sources = new Set(rows.map((r) => r.source)).size;
		parts.push(`${plural(rows.length, 'reference', 'references')} from ${plural(sources, 'script', 'scripts')}.`);
	} else if (scan.failures.length > 0) {
		parts.push(read > 0 ? `No references found in ${plural(read, 'readable script', 'readable scripts')}. The list can be incomplete.` : 'No script could be read, so references can be missing.');
	} else {
		parts.push('No references to this note.');
	}
	parts.push(`${plural(scan.scripts, 'script', 'scripts')} scanned${where}, ${plural(scan.unresolved, 'unresolved target', 'unresolved targets')}.`);
	if (scan.failures.length > 0) parts.push(`${plural(scan.failures.length, 'script', 'scripts')} could not be read.`);
	return parts.join(' ');
}

/** Folder list from the settings text: one folder for each line or comma, no leading or trailing "/". */
export function parseFolders(text: string): string[] {
	const out: string[] = [];
	for (const part of text.split(/[\n,]/)) {
		const f = part.trim().replace(/^\/+|\/+$/g, '');
		if (f !== '' && !out.includes(f)) out.push(f);
	}
	return out;
}

/** True if the path is in one of the folders or their subfolders. An empty list matches each path. */
export function inFolders(path: string, folders: string[]): boolean {
	return folders.length === 0 || folders.some((f) => path.startsWith(`${f}/`));
}

function cell(s: string): string {
	return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/** Pro: a Markdown report of the incoming references for each selected note. */
export function reportMarkdown(notes: string[], scan: ScanResult, stamp: string): string {
	const out: string[] = ['# Fountain reference report', '', `Scanned ${stamp}: ${plural(scan.scripts, 'script', 'scripts')}, ${plural(scan.unresolved, 'unresolved target', 'unresolved targets')}, ${plural(scan.failures.length, 'read failure', 'read failures')}.`];
	for (const f of scan.failures) out.push(`- Could not read ${f.path}: ${cell(f.error)}`);
	for (const note of notes) {
		out.push('', `## ${note}`, '');
		const rows = incoming(scan, note);
		if (rows.length === 0) {
			out.push('No references.');
			continue;
		}
		out.push('| Script | Line | Scene | Text |', '| --- | --- | --- | --- |');
		for (const r of rows) out.push(`| ${cell(r.source)} | ${r.line} | ${cell(r.scene)} | ${cell(r.context)} |`);
	}
	return `${out.join('\n')}\n`;
}
