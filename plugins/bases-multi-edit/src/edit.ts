export type Atom = string | number | boolean | null;
export type PropertyValue = Atom | Atom[];
export interface Field { exists: boolean; value?: unknown }
export interface Action { property: string; operation: 'set' | 'append' | 'remove-items' | 'remove-property'; type: 'text' | 'number' | 'checkbox' | 'list'; input: string }
export interface Change { path: string; property?: string; before: Field; after: Field }
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function validateAction(action: Action): void {
	if (!action.property.trim() || action.property !== action.property.trim() || forbidden.has(action.property.toLowerCase()) || /[\n\r.:]/.test(action.property)) throw new Error('Use a plain top-level note property name without dots or colons.');
	if (!['set', 'append', 'remove-items', 'remove-property'].includes(action.operation)) throw new Error('Unknown operation.');
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
	let value: unknown;
	try { value = JSON.parse(action.input); } catch { throw new Error('Enter a JSON list such as ["review", "next"].'); }
	if (!Array.isArray(value) || !value.every(isAtom)) throw new Error('Lists can contain text, finite numbers, true, false or null.');
	return value;
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
	if (!Array.isArray(value)) throw new Error('Append and remove items require the list type.');
	const existing = !before.exists || before.value === null ? [] : before.value;
	const old = Array.isArray(existing) ? existing : isAtom(existing) ? [existing] : null;
	if (!old || !old.every(isAtom)) throw new Error('The existing property must be empty, a simple value or a simple list.');
	if (action.operation === 'remove-items') return before.exists ? { exists: true, value: old.filter(v => !value.includes(v)) } : { exists: false };
	const appended = [...old];
	for (const item of value) if (!appended.includes(item)) appended.push(item);
	return { exists: true, value: appended };
}
export function writeField(data: Record<string, unknown>, key: string, value: Field): void {
	key = propertyKey(data, key);
	if (value.exists) Object.defineProperty(data, key, { value: structuredClone(value.value), enumerable: true, writable: true, configurable: true });
	else delete data[key];
}
export interface Store { update(path: string, callback: (data: Record<string, unknown>) => void): Promise<void> }
export interface BatchResult { completed: Change[]; skipped: string[] }
/** Check and write each field inside the same atomic frontmatter callback. */
export async function applyChanges(store: Store, changes: Change[], property: string, undo = false): Promise<BatchResult> {
	const completed: Change[] = [], skipped: string[] = [];
	for (const change of changes) {
		try {
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
