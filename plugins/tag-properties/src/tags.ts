/** One list value is one tag. Invalid values never become partial tags. */
export function normalizeTag(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const tag = value.trim().replace(/^#/, '');
	if (!tag || !/^[\p{L}\p{M}\p{N}_/-]+$/u.test(tag) || !/[\p{L}_-]/u.test(tag)) return null;
	if (tag.split('/').some((part) => !part)) return null;
	return tag.toLowerCase();
}

export function listTags(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(normalizeTag).filter((t): t is string => t !== null))];
}

export function propertyNames(value: unknown): string[] {
	if (typeof value !== 'string') return ['topics'];
	return [...new Set(value.split(/[\n,]/).map((p) => p.trim()).filter((p) => p && p !== 'tags' && p !== '__proto__' && p !== 'constructor' && p !== 'prototype'))];
}

export function activeProperties(value: unknown, pro: boolean): string[] {
	const names = propertyNames(value);
	return pro ? names : names.slice(0, 1);
}

export interface NoteTags {
	path: string;
	frontmatter: Record<string, unknown>;
	coreTags?: string[];
}
export interface TagRow { tag: string; paths: string[]; properties: string[] }

export function noteTags(note: NoteTags, properties: string[], includeCore = false): Map<string, Set<string>> {
	const result = new Map<string, Set<string>>();
	const add = (tag: string, property: string): void => {
		if (!result.has(tag)) result.set(tag, new Set());
		result.get(tag)?.add(property);
	};
	for (const property of properties) {
		if (!Object.prototype.hasOwnProperty.call(note.frontmatter, property)) continue;
		for (const tag of listTags(note.frontmatter[property])) add(tag, property);
	}
	if (includeCore) for (const raw of note.coreTags ?? []) {
		const tag = normalizeTag(raw);
		if (tag) add(tag, 'tags');
	}
	return result;
}

export function buildIndex(notes: NoteTags[], properties: string[], includeCore = false): TagRow[] {
	const index = new Map<string, { paths: Set<string>; properties: Set<string> }>();
	for (const note of notes) for (const [tag, sources] of noteTags(note, properties, includeCore)) {
		if (!index.has(tag)) index.set(tag, { paths: new Set(), properties: new Set() });
		const row = index.get(tag);
		row?.paths.add(note.path);
		for (const source of sources) row?.properties.add(source);
	}
	return [...index].sort(([a], [b]) => a.localeCompare(b)).map(([tag, row]) => ({
		tag, paths: [...row.paths].sort(), properties: [...row.properties].sort(),
	}));
}

export function matchingPaths(rows: TagRow[], selected: string, descendants = false): string[] {
	return [...new Set(rows.filter((row) => row.tag === selected || (descendants && row.tag.startsWith(selected + '/'))).flatMap((row) => row.paths))].sort();
}

/** Native Bases expression. Match lists only, strip one hash, trim and fold case. */
export function basesFilter(properties: string[], tag: string, descendants = false, includeCore = false): string {
	const normalized = normalizeTag(tag);
	if (!normalized) return 'false';
	const quoted = JSON.stringify(normalized);
	const normalizedValue = 'value.trim().replace(/^#/, "").lower()';
	const comparison = descendants ? `(${normalizedValue} == ${quoted} || ${normalizedValue}.startsWith(${JSON.stringify(normalized + '/')}))` : `${normalizedValue} == ${quoted}`;
	const parts = properties.map((property) => {
		const ref = `note[${JSON.stringify(property)}]`;
		return `if(${ref}.isType("list"), ${ref}.filter(if(value.isType("string"), ${comparison}, false)).length > 0, false)`;
	});
	if (includeCore) parts.push(`file.tags.filter(if(value.isType("string"), ${comparison}, false)).length > 0`);
	return parts.length ? parts.map((p) => `(${p})`).join(' || ') : 'false';
}
