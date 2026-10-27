import { parseYaml } from 'obsidian';

export const MAX_BYTES = 5 * 1024 * 1024;
export type Obj = Record<string, unknown>;
export function object(value: unknown): Obj {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
}
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
export interface Parameter { name: string; location: string; type: string; required: boolean; description: string }
export interface SchemaLink { label: string; schema: unknown }
export interface Endpoint {
	id: string; method: string; path: string; tags: string[]; summary: string; description: string;
	parameters: Parameter[]; requestTypes: string[]; responses: { code: string; description: string }[];
	schemas: SchemaLink[]; warnings: string[];
}
export interface Reference { value: Obj; error: string; refs: string[] }
export function resolve(root: Obj, value: unknown): Reference {
	let current = object(value);
	const refs: string[] = [];
	while (typeof current.$ref === 'string') {
		const ref = current.$ref;
		if (ref !== '#' && !ref.startsWith('#/')) return { value: {}, error: `Unsupported reference: ${ref}`, refs };
		if (refs.includes(ref) || refs.length >= 32) return { value: {}, error: `Reference cycle or depth limit: ${ref}`, refs };
		refs.push(ref);
		let target: unknown = root;
		try {
			for (const token of (ref === '#' ? [] : decodeURIComponent(ref.slice(2)).split('/'))) {
				if (/~(?:[^01]|$)/.test(token)) throw new Error('Invalid escape');
				const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
				if (target === null || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, key)) throw new Error('Missing target');
				target = (target as Obj)[key];
			}
		} catch { return { value: {}, error: `Unresolved reference: ${ref}`, refs }; }
		if (target === null || typeof target !== 'object' || Array.isArray(target)) return { value: {}, error: `Unresolved reference: ${ref}`, refs };
		current = object(target);
	}
	return { value: current, error: '', refs };
}
export function schemaType(value: unknown): string {
	const s = object(value);
	if (typeof s.$ref === 'string') return s.$ref;
	if (Array.isArray(s.type)) return s.type.filter((v): v is string => typeof v === 'string').join(' | ');
	return text(s.type) || (s.properties ? 'object' : s.items ? 'array' : 'unspecified');
}
export function schemaDetails(root: Obj, value: unknown): { title: string; error: string; type: string; properties: { name: string; type: string; required: boolean; schema: unknown }[] } {
	const r = resolve(root, value);
	const required = Array.isArray(r.value.required) ? r.value.required : [];
	return {
		title: text(object(value).$ref) || text(r.value.title) || 'Inline schema', error: r.error, type: schemaType(r.value),
		properties: Object.entries(object(r.value.properties)).map(([name, schema]) => ({ name, type: schemaType(schema), required: required.includes(name), schema })),
	};
}
export interface Spec { root: Obj; title: string; version: string; endpoints: Endpoint[]; warnings: string[] }
export function parseSpec(source: string, extension = 'json'): Spec {
	if (new TextEncoder().encode(source).length > MAX_BYTES) throw new Error('File exceeds the 5 MiB limit.');
	source = source.replace(/^\uFEFF/, '');
	let parsed: unknown;
	try { parsed = extension.toLowerCase() === 'json' ? JSON.parse(source) as unknown : parseYaml(source) as unknown; }
	catch { throw new Error('Parse error. Check the JSON or YAML syntax.'); }
	const root = object(parsed);
	const version = text(root.openapi);
	if (!/^3\.(0|1)\.\d+(?:[-+].*)?$/.test(version)) throw new Error('Unsupported version. Use OpenAPI 3.0 or 3.1.');
	const endpoints: Endpoint[] = [];
	const warnings: string[] = [];
	for (const [path, rawPath] of Object.entries(object(root.paths))) {
		if (!path.startsWith('/')) continue;
		const pathRef = resolve(root, rawPath);
		if (pathRef.error) { warnings.push(pathRef.error); continue; }
		for (const method of METHODS) {
			if (!Object.prototype.hasOwnProperty.call(pathRef.value, method)) continue;
			const op = object(pathRef.value[method]);
			const e: Endpoint = { id: `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), path,
				tags: Array.isArray(op.tags) ? op.tags.filter((v): v is string => typeof v === 'string' && v.length > 0) : [],
				summary: text(op.summary), description: text(op.description), parameters: [], requestTypes: [], responses: [], schemas: [], warnings: [] };
			if (!e.tags.length) e.tags.push('Untagged');
			const paramSchemas: unknown[] = [];
			for (const list of [pathRef.value.parameters, op.parameters]) {
				if (!Array.isArray(list)) continue;
				for (const raw of list) {
					const r = resolve(root, raw);
					if (r.error) { e.warnings.push(r.error); continue; }
					const p = r.value;
					const row = { name: text(p.name), location: text(p.in), type: schemaType(p.schema), required: p.in === 'path' || p.required === true, description: text(p.description) };
					const i = e.parameters.findIndex((x) => x.name === row.name && x.location === row.location);
					if (i < 0) { e.parameters.push(row); paramSchemas.push(p.schema); } else { e.parameters[i] = row; paramSchemas[i] = p.schema; }
				}
			}
			e.parameters.forEach((row, i) => { if (paramSchemas[i]) e.schemas.push({ label: `Parameter ${row.name}`, schema: paramSchemas[i] }); });
			const body = resolve(root, op.requestBody);
			if (body.error) e.warnings.push(body.error);
			e.requestTypes = Object.keys(object(body.value.content));
			for (const [type, media] of Object.entries(object(body.value.content))) {
				if (object(media).schema) e.schemas.push({ label: `Request ${type}`, schema: object(media).schema });
			}
			for (const [code, raw] of Object.entries(object(op.responses))) {
				const response = resolve(root, raw);
				if (response.error) e.warnings.push(response.error);
				e.responses.push({ code, description: text(response.value.description) });
				for (const [type, media] of Object.entries(object(response.value.content))) {
					if (object(media).schema) e.schemas.push({ label: `Response ${code} ${type}`, schema: object(media).schema });
				}
			}
			endpoints.push(e);
		}
	}
	return { root, title: text(object(root.info).title) || 'Local API reference', version, endpoints, warnings };
}
export function safeText(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]{}()#+.!|~$%=^-])/g, '\\$1'); }
export function endpointMarkdown(e: Endpoint, source: string): string {
	return [`# ${safeText(e.id)}`, '', `Source: ${safeText(source)}`, '', safeText(e.summary), '', safeText(e.description), '', '## Parameters', '',
		...e.parameters.map((p) => `- ${safeText(p.name)} (${safeText(p.location)}, ${safeText(p.type)}, ${p.required ? 'required' : 'optional'})`), '',
		'## Request content types', '', ...e.requestTypes.map((t) => `- ${safeText(t)}`), '', '## Responses', '',
		...e.responses.map((r) => `- ${safeText(r.code)}: ${safeText(r.description)}`), '', ...e.warnings.map(safeText), ''].join('\n');
}
