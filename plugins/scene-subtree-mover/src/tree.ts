/** A child array belongs to the string immediately before it. */
export type SceneArray = (string | SceneArray)[];
export interface SceneNode {
	name: string;
	children?: SceneNode[];
}
export interface SceneMove {
	path: number[];
	position: number;
}
export interface SubtreeMove extends SceneMove {
	parent: number[];
}
export interface SceneChoice {
	path: number[];
	label: string;
}

/** Refuse malformed arrays, cycles and trees beyond the checked input limits. */
export function readTree(value: unknown): SceneNode[] {
	const seen = new Set<unknown>();
	let count = 0;
	function read(array: unknown, depth: number): SceneNode[] {
		if (!Array.isArray(array)) throw new Error('The scene tree must be an array.');
		if (depth > 64 || seen.has(array)) throw new Error('The scene tree is too deep or has a YAML cycle.');
		seen.add(array);
		const nodes: SceneNode[] = [];
		for (const item of array as unknown[]) {
			if (++count > 10000) throw new Error('The scene tree exceeds 10000 entries.');
			if (typeof item === 'string' && item.trim()) nodes.push({ name: item });
			else if (Array.isArray(item)) {
				const parent = nodes[nodes.length - 1];
				if (!parent || parent.children !== undefined) throw new Error('A child array must follow one parent scene.');
				parent.children = read(item, depth + 1);
			} else throw new Error('Each scene must be a nonempty string or a child array.');
		}
		seen.delete(array);
		return nodes;
	}
	return read(value, 0);
}

export function writeTree(nodes: SceneNode[]): SceneArray {
	const result: SceneArray = [];
	for (const node of nodes) {
		result.push(node.name);
		if (node.children !== undefined) result.push(writeTree(node.children));
	}
	return result;
}

export function siblingGroup(nodes: SceneNode[], path: number[]): SceneNode[] {
	if (!path.length || path.some((n) => !Number.isInteger(n) || n < 0)) throw new Error('Select a scene in the preview.');
	let group = nodes;
	for (const index of path.slice(0, -1)) {
		const child = group[index]?.children;
		if (!child) throw new Error('The selected scene is missing.');
		group = child;
	}
	if (!group[path[path.length - 1]!]) throw new Error('The selected scene is missing.');
	return group;
}

/** Position is the final zero-based position within the same sibling group. */
export function moveTree(nodes: SceneNode[], move: SceneMove): SceneNode[] {
	const result = readTree(writeTree(nodes));
	const group = siblingGroup(result, move.path);
	if (!Number.isInteger(move.position) || move.position < 0 || move.position >= group.length) throw new Error('Select a position in the same sibling group.');
	const [node] = group.splice(move.path[move.path.length - 1]!, 1);
	group.splice(move.position, 0, node!);
	return result;
}

export function containsPath(ancestor: number[], path: number[]): boolean {
	return path.length >= ancestor.length && ancestor.every((index, i) => path[i] === index);
}

/** Paths refer to the input tree. Position is the final slot after removal. */
export function moveSubtree(nodes: SceneNode[], move: SubtreeMove): SceneNode[] {
	const result = readTree(writeTree(nodes));
	const source = siblingGroup(result, move.path);
	if (containsPath(move.path, move.parent)) throw new Error('A scene cannot move under itself or one of its descendants.');
	// Keep the parent object before removal can change its numeric path.
	const parent = move.parent.length ? siblingGroup(result, move.parent)[move.parent[move.parent.length - 1]!]! : null;
	const destination = parent ? (parent.children ?? []) : result;
	const slots = destination.length - (destination === source ? 1 : 0);
	if (!Number.isInteger(move.position) || move.position < 0 || move.position > slots) throw new Error('Select a final position in the destination group.');
	const [node] = source.splice(move.path[move.path.length - 1]!, 1);
	if (parent) parent.children = destination;
	destination.splice(move.position, 0, node!);
	// A new parent array can increase entry count or subtree depth.
	return readTree(writeTree(result));
}

/** Explicit destinations outside the source sibling group are refused. */
export function moveAfter(nodes: SceneNode[], source: number[], destination: number[]): SceneNode[] {
	if (source.length !== destination.length || source.slice(0, -1).some((n, i) => n !== destination[i])) throw new Error('V1 permits sibling reordering only.');
	siblingGroup(nodes, source);
	siblingGroup(nodes, destination);
	const from = source[source.length - 1]!;
	const to = destination[destination.length - 1]!;
	return moveTree(nodes, { path: source, position: from < to ? to : from === to ? from : to + 1 });
}

export function sceneChoices(nodes: SceneNode[], prefix: number[] = [], parents: string[] = []): SceneChoice[] {
	return nodes.flatMap((node, index) => {
		const path = [...prefix, index];
		const labels = [...parents, node.name];
		return [{ path, label: labels.join(' / ') }, ...sceneChoices(node.children ?? [], path, labels)];
	});
}

export function sameOrder(a: SceneNode[], b: SceneNode[]): boolean {
	return JSON.stringify(writeTree(a)) === JSON.stringify(writeTree(b));
}

/** Sort siblings for the comparison, while preserving child ownership and duplicates. */
function structure(nodes: SceneNode[], identities: Map<string, number>): number[] {
	return nodes.map((node) => {
		// Child ids keep the key small at each level. Do not escape child JSON again.
		const key = JSON.stringify([node.name, node.children === undefined ? null : structure(node.children, identities)]);
		let id = identities.get(key);
		if (id === undefined) {
			id = identities.size;
			identities.set(key, id);
		}
		return id;
	}).sort((a, b) => a - b);
}

export function checkRestore(current: SceneNode[], saved: SceneNode[]): void {
	const identities = new Map<string, number>();
	if (JSON.stringify(structure(current, identities)) !== JSON.stringify(structure(saved, identities))) throw new Error('Conflict: the saved order has different scenes or parent relationships.');
}

export function treeLines(nodes: SceneNode[], depth = 0): string[] {
	return nodes.flatMap((node, i) => [`${'  '.repeat(depth)}${i + 1}. ${node.name}`, ...treeLines(node.children ?? [], depth + 1)]);
}
