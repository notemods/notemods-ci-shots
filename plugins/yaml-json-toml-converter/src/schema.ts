import { validate } from 'jsonschema';
import { parseData, type Data } from './convert';

/** Draft-07 with local fragment refs. No schema loader or data rewrite. */
export function validateSchema(data: Data, text: string): string[] {
	const schema = parseData(text, 'json');
	function refs(v: Data): void {
		if (!v || typeof v !== 'object') return;
		if (!Array.isArray(v) && typeof v.$ref === 'string' && !v.$ref.startsWith('#')) throw new Error('Schema references must be local fragments that start with #.');
		for (const child of Object.values(v)) refs(child);
	}
	refs(schema);
	if (typeof schema !== 'boolean' && (schema === null || typeof schema !== 'object' || Array.isArray(schema))) throw new Error('The schema must be an object or a Boolean.');
	const result = validate(data, schema, { allowUnknownAttributes: false, skipAttributes: ['format', 'definitions', '$schema', '$id', 'id', 'title', 'description', 'default', 'examples', '$comment'] });
	return result.errors.map((e) => `${e.path.length ? '/' + e.path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '/'}: ${e.message}`);
}
