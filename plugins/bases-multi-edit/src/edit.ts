export type Atom = string | number | boolean | null;
export type PropertyValue = Atom | Atom[];
export interface Field { exists: boolean; value?: unknown }
export interface Action { property: string; operation: 'set' | 'append' | 'remove-items' | 'replace-items' | 'remove-property'; type: 'text' | 'number' | 'checkbox' | 'list'; input: string; find?: string }
/** File state when the preview read the note. Apply skips the note when this differs. */
export interface Stamp { mtime: number; size: number }
export interface Change { path: string; property?: string; before: Field; after: Field; stamp?: Stamp }
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function validateAction(action: Action): void {
	if (!action.property.trim() || action.property !== action.property.trim() || forbidden.has(action.property.toLowerCase()) || /[\n\r.:]/.test(action.property)) throw new Error('Use a plain top-level note property name without dots or colons.');
	if (!['set', 'append', 'remove-items', 'replace-items', 'remove-property'].includes(action.operation)) throw new Error('Unknown operation.');
	if (!['text', 'number', 'checkbox', 'list'].includes(action.type)) throw new Error('Unknown value type.');
}
export function inputValue(action: Action): PropertyValue {
	validateAction(action);
	if (action.type === 'text') return action.input;
	if (action.type === 'number') {
		const n = Number(action.input);
		if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(action.input) || !Number.isFinite(n)) throw new Error('Enter a finite decimal number.');
		return n;
	}
	if (action.type === 'checkbox') {
		if (!['true', 'false'].includes(action.input)) throw new Error('Enter true or false.');
		return action.input === 'true';
	}
	return parseList(action.input);
}
function parseList(input: string): Atom[] {
	let value: unknown;
	// Mobile keyboards type curly quotes. Valid JSON is read as typed; only invalid input gets straight quotes.
	try { value = JSON.parse(input); } catch {
		try { value = JSON.parse(input.replace(/[\u201C\u201D]/g, '"')); } catch { throw new Error('Enter a JSON list such as ["review", "next"].'); }
	}
	if (!Array.isArray(value) || !value.every(isAtom)) throw new Error('Lists can contain text, finite numbers, true, false or null.');
	return value;
}
/** Items that Replace list items looks for. Not empty. */
export function findItems(action: Action): Atom[] {
	const find = parseList(action.find ?? '');
	if (!find.length) throw new Error('Enter at least one item in Find items, for example ["draft"].');
	return find;
}
function isAtom(value: unknown): value is Atom { return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)); }
export function propertyKey(data: Record<string, unknown>, key: string): string {
	const matches = Object.keys(data).filter(k => k.toLowerCase() === key.toLowerCase());
	if (matches.length > 1) throw new Error(`Multiple property keys match "${key}" ignoring case. Resolve them before editing.`);
	return matches[0] ?? key;
}
export function field(data: Record<string, unknown>, key: string): Field {
	const resolved = propertyKey(data, key);
	return Object.prototype.hasOwnProperty.call(data, resolved) ? { exists: true, value: structuredClone(data[resolved]) } : { exists: false };
}
export function equal(a: Field, b: Field): boolean { return a.exists === b.exists && (!a.exists || JSON.stringify(a.value) === JSON.stringify(b.value)); }
export function transform(before: Field, action: Action): Field {
	validateAction(action);
	if (action.operation === 'remove-property') return { exists: false };
	const value = inputValue(action);
	if (action.operation === 'set') return { exists: true, value };
	if (!Array.isArray(value)) throw new Error('Append, remove and replace items require the list type.');
	const find = action.operation === 'replace-items' ? findItems(action) : [];
	if (action.operation === 'replace-items' && !value.length) throw new Error('Enter at least one new item in Value, for example ["done"].');
	const existing = !before.exists || before.value === null ? [] : before.value;
	const old = Array.isArray(existing) ? existing : isAtom(existing) ? [existing] : null;
	if (!old || !old.every(isAtom)) throw new Error('The existing property must be empty, a simple value or a simple list.');
	if (action.operation === 'replace-items') return replaceItems(before, old, find, value, action.property.toLowerCase() === 'tags');
	if (action.operation === 'remove-items') return before.exists ? { exists: true, value: old.filter(v => !value.includes(v)) } : { exists: false };
	const appended = [...old];
	for (const item of value) if (!appended.includes(item)) appended.push(item);
	return { exists: true, value: appended };
}
/** Core reads project, #project and Project as one tag. Other properties match exactly. */
function tagKey(value: Atom): Atom { return typeof value === 'string' ? value.replace(/^#/, '').toLowerCase() : value; }
/** The first found item takes the new items at its place. Other found items go. A kept item is not added again. */
function replaceItems(before: Field, old: Atom[], find: Atom[], items: Atom[], tags: boolean): Field {
	const key = tags ? tagKey : (v: Atom) => v;
	const has = (list: Atom[], v: Atom) => list.some(x => key(x) === key(v));
	if (!before.exists || before.value === null || !old.some(v => has(find, v))) return before.exists ? { exists: true, value: structuredClone(before.value) } : { exists: false };
	// New tags are written without "#", as core writes them.
	const adds = tags ? items.map(v => typeof v === 'string' ? v.replace(/^#/, '') : v) : items;
	const kept = old.filter(v => !has(find, v)), out: Atom[] = [];
	let placed = false;
	for (const item of old) {
		if (!has(find, item)) { out.push(item); continue; }
		if (placed) continue;
		placed = true;
		for (const add of adds) if (!has(kept, add) && !has(out, add)) out.push(add);
	}
	return !Array.isArray(before.value) && out.length === 1 ? { exists: true, value: out[0] } : { exists: true, value: out };
}
export function writeField(data: Record<string, unknown>, key: string, value: Field): void {
	key = propertyKey(data, key);
	if (value.exists) Object.defineProperty(data, key, { value: structuredClone(value.value), enumerable: true, writable: true, configurable: true });
	else delete data[key];
}
export interface Store {
	update(path: string, callback: (data: Record<string, unknown>) => void): Promise<void>;
	/** Current file state, or null when the note is gone. */
	stamp?(path: string): Stamp | null;
}
export const CHANGED_FILE = 'File changed since preview, for example by sync. Run Preview again.';
function sameStamp(a: Stamp, b: Stamp | null): boolean { return !!b && a.mtime === b.mtime && a.size === b.size; }
export interface BatchResult { completed: Change[]; skipped: string[] }
/** Check and write each field inside the same atomic frontmatter callback. */
export async function applyChanges(store: Store, changes: Change[], property: string, undo = false): Promise<BatchResult> {
	const completed: Change[] = [], skipped: string[] = [];
	for (const change of changes) {
		try {
			// Apply only: a note that changed after the preview read it is skipped, not merged.
			if (!undo && change.stamp && store.stamp && !sameStamp(change.stamp, store.stamp(change.path))) throw new Error(CHANGED_FILE);
			await store.update(change.path, data => {
				const key = change.property ?? property;
				const expected = undo ? change.after : change.before;
				if (!equal(field(data, key), expected)) throw new Error('Property changed since preview');
				writeField(data, key, undo ? change.before : change.after);
			});
			completed.push(change);
		} catch (error) { skipped.push(`${change.path}: ${error instanceof Error ? error.message : String(error)}`); }
	}
	return { completed, skipped };
}
