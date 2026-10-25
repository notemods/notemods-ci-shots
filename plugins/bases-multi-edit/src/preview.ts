import { equal, field, propertyKey, transform, type Action, type Change, type Field, type Stamp } from './edit';

export const FRONTMATTER_WARNING = 'Apply and undo re-serialize frontmatter. YAML comments, quoting and key order can be lost. Undo restores property values, not the original YAML text.';
export const VALUE_DESCRIPTION = 'Lists use JSON, for example ["review"]. Checkbox values are true or false. Remove property ignores Value and Value type and deletes the whole key.';
export const FIND_DESCRIPTION = 'Replace list items only. The items to find, as a JSON list, for example ["draft"]. The first found item takes the new items from Value.';
export interface Preview { changes: Change[]; messages: string[]; skipped: string[] }
function show(value: Field): string { return value.exists ? JSON.stringify(value.value) ?? 'null' : '(absent)'; }

/**
 * Input errors stop planning; one unreadable or incompatible note never stops the other notes.
 * The stamp is read before the note, so a write between the two makes apply skip the note.
 */
export async function previewChanges(paths: string[], action: Action, read: (path: string) => Promise<Record<string, unknown>>, stamp?: (path: string) => Stamp | null): Promise<Preview> {
	transform({ exists: false }, action);
	const result: Preview = { changes: [], messages: [], skipped: [] };
	for (const path of paths) {
		try {
			const stamped = stamp?.(path) ?? undefined;
			const data = await read(path);
			const property = propertyKey(data, action.property);
			const before = field(data, property), after = transform(before, action);
			result.messages.push(`${path}\n${show(before)} → ${show(after)}${equal(before, after) ? ' (unchanged)' : ''}`);
			if (!equal(before, after)) result.changes.push(stamped ? { path, property, before, after, stamp: stamped } : { path, property, before, after });
		} catch (error) {
			const message = `${path}: skipped: ${error instanceof Error ? error.message : String(error)}`;
			result.skipped.push(message); result.messages.push(message);
		}
	}
	return result;
}
