// Pure logic over the text of a .base file. No Obsidian imports, so tests and golden vectors run fast.
// The yaml package holds comments and unknown keys it does not touch, so a restore keeps them.
import { isMap, isSeq, parseDocument, type Document, type YAMLSeq } from 'yaml';

/** Top-level keys a checkpoint saves and restores next to the view entry. */
export const SHARED_KEYS = ['filters', 'formulas', 'properties', 'summaries'] as const;

export interface Checkpoint {
	label?: string;
	path: string;
	viewName: string;
	/** The saved view entry as plain JS (the whole map, so unknown keys inside the view come back too). */
	view: unknown;
	/** Saved shared top-level keys that exist in the file, as plain JS. */
	shared: Record<string, unknown>;
}

export type SaveResult = { ok: true; checkpoint: Checkpoint } | { ok: false; reason: string };
export type RestoreResult = { ok: true; text: string; changes: string[] } | { ok: false; reason: string };

/** Parses the file; null when the YAML has errors or views is missing or not a list. */
function docOf(text: string): Document | null {
	try {
		const doc = parseDocument(text);
		if (doc.errors.length > 0 || !isMap(doc.contents)) return null;
		if (!isSeq(doc.get('views'))) return null;
		doc.toJS(); // Refuse unresolved aliases and excessive alias expansion.
		return doc;
	} catch {
		return null;
	}
}

/** The name of a view entry, or null when the entry is not a map with a scalar name. */
function viewNameOf(entry: unknown): string | null {
	if (entry === null || typeof entry !== 'object') return null;
	const name = (entry as Record<string, unknown>)['name'];
	return typeof name === 'string' ? name : null;
}

/**
 * Reads the view names of the file. Returns null when the YAML is invalid or a name repeats,
 * because save and restore both need one unambiguous target view.
 */
export function viewNames(text: string): string[] | null {
	const doc = docOf(text);
	if (!doc) return null;
	const names: string[] = [];
	for (const item of (doc.toJS() as { views: unknown[] }).views) {
		const name = viewNameOf(item);
		if (name === null) return null;
		names.push(name);
	}
	const seen = new Set<string>();
	for (const n of names) {
		if (seen.has(n)) return null;
		seen.add(n);
	}
	return names;
}

/** True when a JSON copy keeps the value. YAML .inf and .nan become null in JSON plugin data. */
function jsonSafe(value: unknown): boolean {
	if (typeof value === 'number') return Number.isFinite(value);
	if (value === null || typeof value !== 'object') return true;
	return Object.values(value).every(jsonSafe);
}

/** Saves a copy of one view entry and of the shared keys. Refuses invalid YAML and repeated view names. */
export function saveCheckpoint(text: string, path: string, viewName: string): SaveResult {
	if (viewNames(text) === null) return { ok: false, reason: 'The file has invalid YAML or two views with the same name.' };
	const doc = docOf(text)!;
	const model = doc.toJS() as Record<string, unknown> & { views: unknown[] };
	for (const entry of model.views) {
		if (viewNameOf(entry) === viewName) {
			if (!jsonSafe(entry) || !SHARED_KEYS.every((key) => jsonSafe(model[key]))) {
				return { ok: false, reason: 'The view or a shared key holds .inf or .nan, which a checkpoint cannot keep.' };
			}
			const shared: Record<string, unknown> = {};
			for (const key of SHARED_KEYS) {
				const v = model[key];
				if (v !== undefined) shared[key] = JSON.parse(JSON.stringify(v));
			}
			return {
				ok: true,
				checkpoint: { path, viewName, view: JSON.parse(JSON.stringify(entry)), shared },
			};
		}
	}
	return { ok: false, reason: `No view named ${viewName}.` };
}

/** Names of the keys of a view entry (or shared block) whose saved value differs from the current one. */
export function changedKeys(saved: Record<string, unknown>, current: Record<string, unknown>): string[] {
	const keys = new Set([...Object.keys(saved), ...Object.keys(current)]);
	const out: string[] = [];
	for (const k of keys) if (JSON.stringify(saved[k]) !== JSON.stringify(current[k])) out.push(k);
	return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Writes the saved view entry and the saved shared keys back. Other views, other keys and unknown
 * top-level keys stay as they are. Returns the new text and a list of the keys that changed.
 */
export function restoreCheckpoint(text: string, checkpoint: Checkpoint): RestoreResult {
	const doc = docOf(text);
	if (!doc) return { ok: false, reason: 'The file has invalid YAML or two views with the same name.' };
	const seq = doc.get('views') as YAMLSeq;
	const model = doc.toJS() as Record<string, unknown> & { views: unknown[] };
	const entries = model.views;
	const names: (string | null)[] = entries.map(viewNameOf);
	if (names.some((n) => n === null)) return { ok: false, reason: 'A view has no name.' };
	const seen = new Set<string>();
	for (const n of names) {
		if (n !== null && seen.has(n)) return { ok: false, reason: 'Two views have the same name.' };
		if (n !== null) seen.add(n);
	}
	const changes: string[] = [];
	const index = names.indexOf(checkpoint.viewName);
	if (index === -1) {
		// The view was deleted after the save. Append the saved entry, keep every other view.
		seq.items.push(doc.createNode(checkpoint.view));
		changes.push(`view ${checkpoint.viewName} (added back)`);
	} else {
		const current = entries[index] as Record<string, unknown>;
		for (const k of changedKeys(checkpoint.view as Record<string, unknown>, current)) changes.push(`${checkpoint.viewName}.${k}`);
		seq.items[index] = doc.createNode(checkpoint.view);
	}
	for (const key of SHARED_KEYS) {
		if (!(key in checkpoint.shared)) {
			if (key in model) changes.push(key);
			doc.delete(key);
			continue;
		}
		const saved = checkpoint.shared[key];
		const current = model[key];
		if (JSON.stringify(current) !== JSON.stringify(saved)) changes.push(key);
		doc.set(key, doc.createNode(saved));
	}
	// A replaced node can remove a YAML anchor that another node still uses. Refuse when the new text
	// does not parse, or when another view or an unknown top-level key would get a different value.
	// No line folding and no flow padding, so long filters and [a, b] lists in other views keep their text.
	// The writer emits LF; a CRLF file gets CRLF back.
	let next: string;
	try {
		next = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
		if (text.includes('\r\n')) next = next.replace(/\r?\n/g, '\r\n');
	} catch {
		return { ok: false, reason: ALIAS_REASON };
	}
	const after = docOf(next)?.toJS() as (Record<string, unknown> & { views: unknown[] }) | undefined;
	if (!after) return { ok: false, reason: ALIAS_REASON };
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
	for (const [i, entry] of entries.entries()) {
		if (i !== index && !same(entry, after.views[i])) return { ok: false, reason: ALIAS_REASON };
	}
	for (const key of Object.keys(model)) {
		if (key !== 'views' && !(SHARED_KEYS as readonly string[]).includes(key) && !same(model[key], after[key])) return { ok: false, reason: ALIAS_REASON };
	}
	return { ok: true, text: next, changes };
}

const ALIAS_REASON = 'The restore would change another view through a YAML anchor or alias. Restore refused.';

/** The keys of the saved view entry and of the shared keys that differ from the file now (Pro compare). */
export function compareCheckpoint(text: string, checkpoint: Checkpoint): string[] | null {
	const doc = docOf(text);
	if (!doc || viewNames(text) === null) return null;
	const model = doc.toJS() as Record<string, unknown> & { views: unknown[] };
	for (const entry of model.views) {
		if (viewNameOf(entry) === checkpoint.viewName) {
			const viewChanges = changedKeys(checkpoint.view as Record<string, unknown>, entry as Record<string, unknown>).map((k) => `${checkpoint.viewName}.${k}`);
			const sharedChanges: string[] = [];
			for (const key of SHARED_KEYS) {
				if (!(key in checkpoint.shared)) {
					if (key in model) sharedChanges.push(key);
					continue;
				}
				if (JSON.stringify(model[key]) !== JSON.stringify(checkpoint.shared[key])) sharedChanges.push(key);
			}
			return [...viewChanges, ...sharedChanges].sort((a, b) => a.localeCompare(b));
		}
	}
	return null;
}
