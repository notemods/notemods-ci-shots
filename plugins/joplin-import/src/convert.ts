// Pure conversion: from the archive model to a list of output files. No vault access. The caller gives a
// function that tells if a path exists, so the plan marks each existing path as skipped.
import type { Archive, Note } from './joplin';

export interface PlannedNote { id: string; path: string; text: string; status: 'new' | 'existing' }
export interface PlannedAttachment { id: string; path: string; data: Uint8Array; status: 'new' | 'existing' }
export interface Report {
	missingResources: string[];
	missingNotes: string[];
	unsupported: string[];
	tags: string[];
	notebooks: string[];
}
export interface Plan {
	folder: string;
	folders: string[];
	notes: PlannedNote[];
	attachments: PlannedAttachment[];
	report: Report;
	counts: Counts;
}
export interface Counts { notes: number; notebooks: number; tags: number; resources: number }

export const RESOURCE_DIR = '_resources';

/** The counts that the preview shows before import. */
export function counts(a: Archive): Counts {
	return { notes: a.notes.length, notebooks: a.folders.length, tags: a.tags.length, resources: a.resources.size };
}

/** UTF-8 bytes of a name part. Linux and Android file systems refuse a file name above 255 bytes. */
export const MAX_NAME_BYTES = 200;

const utf8 = new TextEncoder();

/**
 * A file or folder name part: no characters that Obsidian or the file system refuse, no leading dots. The cut keeps
 * whole code points (no lone surrogate) and stays at or below max characters and MAX_NAME_BYTES UTF-8 bytes, so the
 * note name with "--<id>.md" stays below 255 bytes.
 */
export function safeName(title: string, max = 80): string {
	const s = Array.from(title, (ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/\.+$/, '').trim();
	void utf8;
	return s.slice(0, max).trim();
}

/** Checks the output folder input and returns it without slashes at the ends. Throws for an unsafe path. */
export function safeFolder(input: string): string {
	const f = input.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
	if (!f) throw new Error('Type an output folder name.');
	if (f.split('/').some((p) => p === '..' || p === '.' || p.startsWith('.') || p.trim() !== p || p === '')) throw new Error('The output folder must be a plain vault path, without "..", without hidden folders and without spaces at the ends of a name.');
	if (/[*?"<>|:#^[\]]/.test(f)) throw new Error('The output folder has a character that a vault path cannot have.');
	return f;
}

/** Obsidian tag text for a Joplin tag title, or null when the title has no usable characters. */
export function tagName(title: string): string | null {
	const t = title.trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-/]/gu, '').replace(/^\/+|\/+$/g, '');
	if (!t || /^\d+$/.test(t)) return null;
	return t;
}

/** 32-bit FNV-1a of the text, as 8 hex digits. The plugin writes it to find notes that you changed in the vault. */
export function fnv(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

const HASH_LINE = /^joplin_hash: ([0-9a-f]{8})\n/m;

/** Adds the hash line as the last frontmatter line. */
function withHash(front: string[], body: string): string {
	const plain = `---\n${front.join('\n')}\n---\n${body}`;
	return `---\n${front.join('\n')}\njoplin_hash: ${fnv(plain)}\n---\n${body}`;
}

/** True when the note text is as the import wrote it: its hash line matches the rest of the text. */
export function unchangedSinceImport(text: string): boolean {
	const m = HASH_LINE.exec(text);
	if (!m) return false;
	return fnv(text.replace(HASH_LINE, '')) === m[1];
}

/** Notebook id to folder path inside the output folder. Cycles and missing parents go to the top. */
export function folderPaths(a: Archive, root: string, report: Report): Map<string, string> {
	const byId = new Map(a.folders.map((f) => [f.id, f]));
	const out = new Map<string, string>();
	const used = new Map<string, Set<string>>();
	const resolve = (id: string, trail: Set<string>): string => {
		const done = out.get(id);
		if (done !== undefined) return done;
		const f = byId.get(id)!;
		let parent = root;
		if (f.parentId) {
			if (!byId.has(f.parentId)) report.notebooks.push(`Notebook "${f.title}" (${f.id}) has a missing parent ${f.parentId}. It is put at the top of the output folder.`);
			else if (trail.has(f.parentId)) report.notebooks.push(`Notebook "${f.title}" (${f.id}) is in a parent loop. It is put at the top of the output folder.`);
			else parent = resolve(f.parentId, new Set([...trail, id]));
		}
		const siblings = used.get(parent) ?? new Set<string>();
		used.set(parent, siblings);
		let name = safeName(f.title) || `Untitled--${f.id}`;
		if (siblings.has(name.toLowerCase())) name = `${name}--${f.id}`;
		siblings.add(name.toLowerCase());
		const path = `${parent}/${name}`;
		out.set(id, path);
		return path;
	};
	for (const f of [...a.folders].sort((x, y) => x.id.localeCompare(y.id))) resolve(f.id, new Set([f.id]));
	return out;
}

const LINK = /(!?)\[([^\]\n]*)\]\(:\/([0-9a-f]{32})(#[^)\s]*)?\)/g;

function label(text: string): string {
	return text.replace(/[|[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function wiki(embed: string, target: string, text: string): string {
	const l = label(text);
	return `${embed}[[${target}${l ? `|${l}` : ''}]]`;
}

/** Changes only lines outside fenced code blocks. The fence length and closing line must match. */
export function mapOutsideFences(body: string, transform: (line: string) => string): string {
	let fence: string | null = null;
	const lines = body.split('\n').map((line) => {
		const f = /^\s*(`{3,}|~{3,})/.exec(line);
		if (f) {
			if (fence === null) fence = f[1]!;
			else if (f[1]!.charAt(0) === fence.charAt(0) && f[1]!.length >= fence.length && line.slice(f[0].length).trim() === '') fence = null;
			return line;
		}
		if (fence !== null) return line;
		return transform(line);
	});
	return lines.join('\n');
}

/** Replaces Joplin links outside fences with vault links and returns the missing target IDs. */
export function convertLinks(body: string, notes: Map<string, string>, resources: Map<string, string>): { body: string; missing: string[] } {
	const missing: string[] = [];
	const converted = mapOutsideFences(body, (line) => line.replace(LINK, (all, bang: string, text: string, id: string, anchor: string | undefined) => {
		const note = notes.get(id);
		if (note !== undefined) return wiki(bang, `${note}${anchor ?? ''}`, text);
		const res = resources.get(id);
		if (res !== undefined) return wiki(bang, res, text);
		if (!missing.includes(id)) missing.push(id);
		return all;
	}));
	return { body: converted, missing };
}

/** The Markdown text of one imported note: fixed frontmatter fields, then the converted body. */
export function renderNote(n: Note, tags: string[], body: string): string {
	const front = [`title: ${JSON.stringify(n.title)}`, `joplin_id: ${n.id}`];
	if (n.created) front.push(`created: ${n.created}`);
	if (n.updated) front.push(`updated: ${n.updated}`);
	front.push(tags.length ? `tags:\n${tags.map((t) => `  - ${JSON.stringify(t)}`).join('\n')}` : 'tags: []');
	if (n.todo) front.push(`joplin_todo: ${n.todoDone ? 'done' : 'open'}`);
	return withHash(front, body);
}

/** Converts the archive in memory. exists(path) tells which output paths are present; the plan skips them. */
export function planImport(a: Archive, folderInput: string, exists: (path: string) => boolean): Plan {
	const folder = safeFolder(folderInput);
	const report: Report = { missingResources: [], missingNotes: [], unsupported: [...a.unsupported], tags: [], notebooks: [] };
	const folders = folderPaths(a, folder, report);
	const notePaths = new Map<string, string>();
	const noteIds = new Set(a.notes.map((n) => n.id));
	const markdown: Note[] = [];
	for (const n of a.notes) {
		if (n.markup === 'html') { report.unsupported.push(`HTML note "${n.title}" (${n.id}) is not imported. Only Markdown note bodies are converted.`); continue; }
		let dir = folder;
		if (n.parentId && folders.has(n.parentId)) dir = folders.get(n.parentId)!;
		else if (n.parentId) report.notebooks.push(`Note "${n.title}" (${n.id}) has a missing notebook ${n.parentId}. It is put at the top of the output folder.`);
		notePaths.set(n.id, `${dir}/${safeName(n.title) || 'Untitled'}--${n.id}`);
		markdown.push(n);
	}
	const resPaths = new Map<string, string>();
	const attachments: PlannedAttachment[] = [];
	for (const r of a.resources.values()) {
		if (!r.data) continue;
		const ext = safeName(r.ext, 12).replace(/\s/g, '');
		const path = `${folder}/${RESOURCE_DIR}/${r.id}${ext ? `.${ext}` : ''}`;
		resPaths.set(r.id, path);
		attachments.push({ id: r.id, path, data: r.data, status: exists(path) ? 'existing' : 'new' });
	}
	const renamed = new Set<string>();
	const notes: PlannedNote[] = markdown.map((n) => {
		const { body, missing } = convertLinks(n.body, notePaths, resPaths);
		for (const id of missing) {
			const r = a.resources.get(id);
			if (r) report.missingResources.push(`Resource "${r.title}" (${id}) in note "${n.title}": the archive has no file for it. The link stays as source text.`);
			else if (noteIds.has(id)) report.missingNotes.push(`Link to note ${id} in note "${n.title}": the target note is not imported. The link stays as source text.`);
			else report.missingResources.push(`Resource or note ${id} in note "${n.title}" is not in the archive. The link stays as source text.`);
		}
		const tags: string[] = [];
		for (const t of a.noteTags.get(n.id) ?? []) {
			const name = tagName(t);
			if (name === null) { if (!renamed.has(t)) report.tags.push(`Tag "${t}" has no usable characters and is not written.`); renamed.add(t); continue; }
			if (name !== t && !renamed.has(t)) { report.tags.push(`Tag "${t}" is written as "${name}".`); renamed.add(t); }
			if (!tags.includes(name)) tags.push(name);
		}
		const path = `${notePaths.get(n.id)!}.md`;
		return { id: n.id, path, text: renderNote(n, tags, body), status: exists(path) ? 'existing' : 'new' };
	});
	const all = new Set<string>([folder]);
	for (const p of [folder, ...folders.values()]) {
		const parts = p.split('/');
		for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
	}
	if (attachments.length) all.add(`${folder}/${RESOURCE_DIR}`);
	const folderList = [...all].sort((x, y) => x.split('/').length - y.split('/').length || x.localeCompare(y));
	return { folder, folders: folderList, notes, attachments, report, counts: counts(a) };
}

/** The report note text. stamp is the local time text of the import. */
export function reportText(plan: Plan, source: string, stamp: string, result: { created: number; attachments: number; skipped: number; errors: string[] }): string {
	const c = plan.counts;
	const out = [
		`# Joplin import report ${stamp}`,
		'',
		`Source archive: ${source}`,
		`Archive counts: ${c.notes} notes, ${c.notebooks} notebooks, ${c.tags} tags, ${c.resources} resources.`,
		`Created: ${result.created} notes and ${result.attachments} attachments. Skipped existing paths: ${result.skipped}. Errors: ${result.errors.length}.`,
		'The import reads the archive and does not change it.',
	];
	const section = (title: string, lines: string[]) => {
		if (!lines.length) return;
		out.push('', `## ${title}`, '', ...lines.map((l) => `- ${l}`));
	};
	section('Errors', result.errors);
	section('Missing resources', plan.report.missingResources);
	section('Missing note links', plan.report.missingNotes);
	section('Unsupported items', plan.report.unsupported);
	section('Changed tags', plan.report.tags);
	section('Notebook problems', plan.report.notebooks);
	return `${out.join('\n')}\n`;
}
