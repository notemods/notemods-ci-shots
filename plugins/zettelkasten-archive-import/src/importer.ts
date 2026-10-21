import { TFile, TFolder, normalizePath, type Vault } from 'obsidian';
import type { Archive } from './parser';
import { fileNames, renderNote, titleMap, safeFolder, validateRules, type Rules } from './model';

export interface PlannedNote { position: number; path: string; text: string; status: 'new' | 'existing' | 'conflict' }
export interface ImportPlan {
	archive: Archive;
	folder: string;
	rules: Rules;
	notes: PlannedNote[];
	missing: string[];
	unsupported: string[];
}
export interface ImportResult { created: number; skipped: number; errors: string[]; cancelled: boolean; remaining: number }
export interface CancelToken { cancelled: boolean }
export const BATCH = 50;

/** Read the zkn3_position property of the notes directly in the import folder. */
export async function existingPositions(vault: Vault, folder: string): Promise<Set<number>> {
	const result = new Set<number>();
	const dir = vault.getAbstractFileByPath(folder);
	if (!(dir instanceof TFolder)) return result;
	for (const file of dir.children) {
		if (!(file instanceof TFile) || file.extension !== 'md') continue;
		const text = await vault.cachedRead(file);
		const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
		const match = front ? /^zkn3_position:\s*(\d{1,6})\s*$/m.exec(front[1] ?? '') : null;
		if (match) result.add(Number(match[1]));
	}
	return result;
}

/** Convert each live note in memory and find existing notes. This step writes nothing. */
export async function prepareImport(vault: Vault, archive: Archive, folderInput: string, rules: Rules): Promise<ImportPlan> {
	const folder = safeFolder(folderInput);
	validateRules(rules);
	const names = fileNames(archive, rules);
	const titles = titleMap(archive);
	const known = await existingPositions(vault, folder);
	const missing: string[] = [];
	const unsupported: string[] = [];
	const notes: PlannedNote[] = [];
	let parentBlocked = false;
	const parts = folder.split('/');
	for (let i = 1; i <= parts.length; i++) {
		const found = vault.getAbstractFileByPath(parts.slice(0, i).join('/'));
		if (found && !(found instanceof TFolder)) parentBlocked = true;
	}
	for (const note of archive.notes) {
		const r = renderNote(note, names, folder, rules, titles);
		for (const n of r.missing) missing.push(`Note ${note.position}: missing target ${n || '(not a number)'}.`);
		if (r.unsupported.length) unsupported.push(`Note ${note.position}: ${r.unsupported.map((t) => `[${t}]`).join(' ')}`);
		const status = known.has(note.position) ? 'existing' : parentBlocked || vault.getAbstractFileByPath(r.path) ? 'conflict' : 'new';
		notes.push({ position: note.position, path: r.path, text: r.text, status });
	}
	return { archive, folder, rules: { ...rules }, notes, missing, unsupported };
}

async function ensureFolder(vault: Vault, folder: string): Promise<void> {
	let current = '';
	for (const part of folder.split('/')) {
		current = normalizePath(current ? `${current}/${part}` : part);
		const found = vault.getAbstractFileByPath(current);
		if (found && !(found instanceof TFolder)) throw new Error(`A file blocks folder ${current}.`);
		if (!found) await vault.createFolder(current);
	}
}

/**
 * Create new notes only, in batches. An existing note or file path is skipped and never overwritten.
 * The import stops between two batches when the token is cancelled, and the result reports the partial write.
 */
export async function writeImport(vault: Vault, plan: ImportPlan, token: CancelToken = { cancelled: false }, progress?: (done: number, total: number) => void): Promise<ImportResult> {
	const result: ImportResult = { created: 0, skipped: 0, errors: [], cancelled: false, remaining: 0 };
	const known = await existingPositions(vault, plan.folder);
	let folderReady = false;
	for (let i = 0; i < plan.notes.length; i++) {
		if (i % BATCH === 0 && i > 0) {
			progress?.(i, plan.notes.length);
			await new Promise<void>((resolve) => { window.setTimeout(resolve, 0); });
			if (token.cancelled) { result.cancelled = true; result.remaining = plan.notes.length - i; break; }
		}
		const item = plan.notes[i];
		if (!item) continue;
		if (known.has(item.position) || vault.getAbstractFileByPath(item.path)) { result.skipped++; continue; }
		try {
			if (!folderReady) { await ensureFolder(vault, plan.folder); folderReady = true; }
			await vault.create(item.path, item.text);
			known.add(item.position);
			result.created++;
		} catch (e) {
			result.errors.push(`Note ${item.position}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	progress?.(plan.notes.length - result.remaining, plan.notes.length);
	return result;
}
