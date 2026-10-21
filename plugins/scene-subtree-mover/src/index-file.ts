import { getFrontMatterInfo, parseYaml, stringifyYaml } from 'obsidian';
import { readTree, writeTree, type SceneNode } from './tree';

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** parseYaml rounds whole numbers above 2^53, so stringifyYaml would write a different value. */
function refuseUnsafeIntegers(data: Record<string, unknown>): void {
	const seen = new Set<unknown>();
	const stack: [unknown, string][] = [[data, '']];
	while (stack.length) {
		const [value, path] = stack.pop()!;
		if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
			throw new Error(`The frontmatter value at "${path}" is a whole number above 2^53. A YAML write would change it. Put the number in quotes, then try again.`);
		}
		if (typeof value !== 'object' || value === null || seen.has(value)) continue;
		seen.add(value);
		for (const [key, child] of Object.entries(value)) stack.push([child, path ? `${path}.${key}` : key]);
	}
}

export function readIndex(source: string): { data: Record<string, unknown>; longform: Record<string, unknown>; tree: SceneNode[] } {
	const info = getFrontMatterInfo(source);
	if (!info.exists) throw new Error('Open a Markdown index with longform.scenes in its frontmatter.');
	const data: unknown = parseYaml(info.frontmatter);
	if (!record(data) || !record(data.longform) || !Object.prototype.hasOwnProperty.call(data.longform, 'scenes')) throw new Error('This index has no longform.scenes array.');
	refuseUnsafeIntegers(data);
	return { data, longform: data.longform, tree: readTree(data.longform.scenes) };
}

/** Keep the body and delimiters; only serialize the frontmatter data. */
export function replaceScenes(source: string, tree: SceneNode[]): string {
	const info = getFrontMatterInfo(source);
	const { data, longform } = readIndex(source);
	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	const yaml = stringifyYaml({ ...data, longform: { ...longform, scenes: writeTree(tree) } }).replace(/\r?\n/g, eol).replace(/(?:\r?\n)*$/, eol);
	return source.slice(0, info.from) + yaml + source.slice(info.to);
}

export function checkedUpdate(current: string, expected: string, tree: SceneNode[]): string {
	if (current !== expected) throw new Error('Conflict: the index changed after preview. Reopen the mover.');
	return replaceScenes(current, tree);
}
