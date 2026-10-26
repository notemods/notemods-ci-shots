// Plans and writes an export: read notes, parse, load Pro images, pick a free file name, write the DOCX.
// The source notes are only read. The plugin writes one new file and changes no other file.
import { normalizePath, type App, type TFile } from 'obsidian';
import { readImageHeader, toDocxBytes, type ImageData } from './docx';
import { parseNote, type Block, type NoteComment } from './parse';

export interface NoteSource {
	file: TFile;
	/** Text to export. For the active note this is the editor text, so unsaved edits are in the file. */
	text: string;
}

export interface PlanOptions {
	author: string;
	pro: boolean;
	labels: boolean;
}

export interface ExportPlan {
	sources: NoteSource[];
	notes: Block[][];
	comments: NoteComment[];
	/** "Draft.md line 3: fenced code block". Export is possible only when this is empty. */
	problems: string[];
	images: Map<string, ImageData>;
	/** Vault path of the new DOCX file. */
	path: string;
	title: string;
	author: string;
}

/** First path "<folder>/<base>.docx", "<folder>/<base> (2).docx", ... that no file or folder uses. */
export function freeDocxPath(app: App, folder: string, base: string): string {
	const dir = folder === '/' || folder === '' ? '' : `${folder}/`;
	for (let n = 1; ; n++) {
		const p = normalizePath(`${dir}${base}${n === 1 ? '' : ` (${n})`}.docx`);
		if (!app.vault.getAbstractFileByPath(p)) return p;
	}
}

/** Reads, parses and checks the notes. Writes nothing. */
export async function planExport(app: App, sources: NoteSource[], opts: PlanOptions, outName?: string): Promise<ExportPlan> {
	const notes: Block[][] = [];
	const comments: NoteComment[] = [];
	const problems: string[] = [];
	const images = new Map<string, ImageData>();
	for (const s of sources) {
		const parsed = parseNote(s.text, { author: opts.author, pro: opts.pro, labels: opts.labels, firstId: comments.length });
		for (const p of parsed.problems) problems.push(`${s.file.name} line ${p.line}: ${p.message}`);
		comments.push(...parsed.comments);
		notes.push(parsed.blocks);
		for (const b of parsed.blocks) {
			if (b.kind !== 'image' || images.has(b.target)) continue;
			const dest = app.metadataCache.getFirstLinkpathDest(b.target, s.file.path);
			if (!dest) {
				problems.push(`${s.file.name}: image ${b.target} is not in the vault`);
				continue;
			}
			const data = new Uint8Array(await app.vault.readBinary(dest));
			const head = readImageHeader(data);
			if (!head) problems.push(`${s.file.name}: image ${b.target} is not a PNG, JPEG, GIF or BMP file that the plugin can read`);
			else images.set(b.target, { ...head, data });
		}
	}
	if (sources.length === 0) problems.push('Select one or more notes');
	const first = sources[0]?.file;
	const folder = first?.parent?.path ?? '';
	const title = outName ?? first?.basename ?? 'Export';
	return { sources, notes, comments, problems, images, path: freeDocxPath(app, folder, title), title, author: opts.author };
}

/** Writes the DOCX of a plan without problems to a new file. Returns the new file. */
export async function writeExport(app: App, plan: ExportPlan): Promise<TFile> {
	if (plan.problems.length) throw new Error('The export has problems');
	const bytes = await toDocxBytes({ title: plan.title, creator: plan.author, notes: plan.notes, comments: plan.comments, images: plan.images });
	// Check the name again: a file can appear while the preview is open.
	const path = app.vault.getAbstractFileByPath(plan.path) ? freeDocxPath(app, plan.path.includes('/') ? plan.path.slice(0, plan.path.lastIndexOf('/')) : '', plan.title) : plan.path;
	return app.vault.createBinary(path, bytes);
}
