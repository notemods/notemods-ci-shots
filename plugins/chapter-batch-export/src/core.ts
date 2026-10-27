export interface Chapter { title: string; number: number; sources: string[]; filename: string; content: string }
export interface ExportOptions { folder: string; range: string; heading: string; filename: string }
export const DEFAULT_OPTIONS: ExportOptions = { folder: 'Chapter exports', range: '', heading: '# {title}', filename: '{number} {title}' };
export interface ExportPlan { chapters: Chapter[]; missing: string[]; index: string }
interface Node { title: string; children: Node[] }
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The index needs a longform entry.');
	return value as Record<string, unknown>;
}
export function pathParts(value: string): string[] {
	const parts: string[] = [];
	for (const part of value.replace(/\\/g, '/').normalize().split('/')) {
		if (!part || part === '.') continue;
		if (part === '..' || [...part].some((c) => c.charCodeAt(0) < 32) || /[:*?"<>|#^[\]]/.test(part)) throw new Error('Use a vault path without parent steps or reserved characters.');
		parts.push(part.replace(/[\u00a0\u202f]/g, ' '));
	}
	return parts;
}
export function outputFolder(value: string): string {
	const parts = pathParts(value.trim());
	if (!parts.length || parts.some((x) => x.startsWith('.') || /[ .]$/.test(x))) throw new Error('Use a new visible output folder.');
	return parts.join('/');
}
function readNodes(value: unknown): Node[] {
	let count = 0;
	const active = new Set<unknown>();
	function read(input: unknown, depth: number): Node[] {
		if (!Array.isArray(input)) throw new Error('Longform scenes must be an array.');
		if (depth > 64 || active.has(input)) throw new Error('The scene tree is too deep or has a YAML cycle.');
		active.add(input);
		const nodes: Node[] = [];
		const parents = new Set<Node>();
		for (const item of input as unknown[]) {
			if (++count > 10000) throw new Error('The index exceeds 10000 entries.');
			if (typeof item === 'string' && item.trim()) nodes.push({ title: item, children: [] });
			else if (Array.isArray(item)) {
				const parent = nodes[nodes.length - 1];
				if (!parent || parents.has(parent)) throw new Error('A child array must follow one parent scene.');
				parents.add(parent);
				parent.children = read(item, depth + 1);
			} else throw new Error('Each scene must be a nonempty string or a child array.');
		}
		active.delete(input);
		return nodes;
	}
	return read(value, 0);
}
export function chapterSources(frontmatter: unknown, indexPath: string): { title: string; sources: string[] }[] {
	const fm = object(frontmatter);
	const lf = object(fm.longform);
	if (lf.format !== 'scenes') throw new Error('Use a Longform multi-scene index with format scenes.');
	if (typeof lf.sceneFolder !== 'string') throw new Error('The index needs a sceneFolder string.');
	const base = [...pathParts(indexPath).slice(0, -1), ...pathParts(lf.sceneFolder)].join('/');
	function paths(node: Node): string[] {
		const parts = pathParts(node.title);
		if (!parts.length) throw new Error('A scene name is empty.');
		// Longform names omit the extension. A name that contains .md still gets .md appended.
		return [`${base ? base + '/' : ''}${parts.join('/')}.md`, ...node.children.flatMap(paths)];
	}
	const nodes = readNodes(lf.scenes);
	if (!nodes.length) throw new Error('The index has no chapters.');
	return nodes.map((node) => ({ title: node.title, sources: paths(node) }));
}
export function stripInitialFrontmatter(text: string): string {
	const value = text.replace(/^\uFEFF/, '');
	const start = /^---[ \t]*\r?\n/.exec(value);
	if (!start) return text;
	const end = /^---[ \t]*(?:\r?\n|$)/m.exec(value.slice(start[0].length));
	return end ? value.slice(start[0].length + end.index + end[0].length) : text;
}
export function selectedNumbers(range: string, count: number): number[] {
	if (!range.trim()) return Array.from({ length: count }, (_, i) => i + 1);
	const selected = new Set<number>();
	for (const part of range.split(',')) {
		const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
		if (!match) throw new Error('Use chapter numbers such as 1-3, 5.');
		const from = Number(match[1]); const to = Number(match[2] ?? match[1]);
		if (from < 1 || to < from || to > count) throw new Error('The chapter range is outside this index.');
		for (let n = from; n <= to; n++) selected.add(n);
	}
	return [...selected].sort((a, b) => a - b);
}
export function formatText(format: string, title: string, number: number): string {
	const literals = format.replace(/\{title\}|\{number\}/g, '');
	if (literals.includes('{') || literals.includes('}') || format.length > 200 || (/[\r\n]/.test(format) || format.includes('\0')) || /\{(?!title\}|number\})[^}]*\}/.test(format)) throw new Error('Use a single line with {title} and {number} only.');
	return format.replace(/\{title\}|\{number\}/g, (key) => key === '{title}' ? title : String(number).padStart(2, '0'));
}
export function safeFilename(value: string): string {
	let name = [...value.normalize()].map((c) => c.charCodeAt(0) < 32 ? ' ' : c).join('').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 120).trim();
	if (!name) name = 'Chapter';
	if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = 'Chapter ' + name;
	return name;
}
export function buildPlan(frontmatter: unknown, indexPath: string, sources: Record<string, string>, options: ExportOptions = DEFAULT_OPTIONS, pro = false): ExportPlan {
	const chapters = chapterSources(frontmatter, indexPath);
	const opts = pro ? options : { ...DEFAULT_OPTIONS, folder: options.folder };
	const numbers = selectedNumbers(opts.range, chapters.length);
	const used = new Set(['_index.md']); const missing = new Set<string>();
	const result = numbers.map((number): Chapter => {
		const chapter = chapters[number - 1]!;
		const base = safeFilename(formatText(opts.filename, chapter.title, number));
		let filename = `${base}.md`;
		for (let n = 2; used.has(filename.toLowerCase()); n++) filename = `${base} ${n}.md`;
		used.add(filename.toLowerCase());
		const heading = formatText(opts.heading, chapter.title, number);
		const bodies = chapter.sources.map((path) => {
			if (!Object.prototype.hasOwnProperty.call(sources, path)) { missing.add(path); return ''; }
			return stripInitialFrontmatter(sources[path]!);
		});
		return { ...chapter, number, filename, content: [heading, ...bodies].filter((x) => x !== '').join('\n\n') + '\n' };
	});
	const folder = outputFolder(opts.folder);
	const link = (path: string) => `[[${path}]]`;
	const index = ['# Chapter export index', '', `Source index: ${link(indexPath)}`, '', ...result.flatMap((c) => [`## ${c.number}. ${c.title}`, '', `Output: ${link(folder + '/' + c.filename)}`, '', ...c.sources.map((path) => `- ${link(path)}`), ''])].join('\n');
	return { chapters: result, missing: [...missing], index };
}
