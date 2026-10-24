// Pure TextBundle and TextPack logic (http://textbundle.org/spec/). No Obsidian API here, so the golden vectors run in Node.
import { strToU8, unzipSync, zipSync } from 'fflate';

export const MARKDOWN_TYPE = 'net.daringfireball.markdown';
/** Limits that keep a pack in memory on a phone. The pack is refused before unpack when it is larger. */
export const MAX_PACK_BYTES = 100 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;
export const MAX_ENTRIES = 5000;
/** The property that holds info.json in a note (Pro round trip). */
export const INFO_KEY = 'textbundle';

export interface BundleInfo {
	version: number;
	type: string;
	/** The parsed info.json, or null when it is missing or bad. */
	raw: Record<string, unknown> | null;
}

export interface Bundle {
	/** Note name without extension. */
	name: string;
	/** File name of the text file in the bundle, for example text.markdown. */
	textName: string;
	text: string;
	info: BundleInfo;
	markdown: boolean;
	/** Asset path below assets/ (for example "sub/a b.png") and its bytes, in path order. */
	assets: Array<{ path: string; bytes: Uint8Array }>;
	warnings: string[];
}

export class PackError extends Error {}

const MB = 1024 * 1024;
const mb = (bytes: number) => `${Math.ceil(bytes / MB)} MB`;

/** Gives the limit message, or null when the pack is inside the limits. */
export function checkLimits(packBytes: number, entries: number, unpackedBytes: number): string | null {
	if (packBytes > MAX_PACK_BYTES) return `The pack is ${mb(packBytes)}. The limit is ${mb(MAX_PACK_BYTES)}.`;
	if (entries > MAX_ENTRIES) return `The pack has ${entries} files. The limit is ${MAX_ENTRIES} files.`;
	if (unpackedBytes > MAX_UNPACKED_BYTES) return `The pack is ${mb(unpackedBytes)} when unpacked. The limit is ${mb(MAX_UNPACKED_BYTES)}.`;
	return null;
}

/**
 * Cleans an entry path and refuses a path that can leave the bundle (zip slip):
 * a ".." segment, a leading slash, a drive letter or a NUL character.
 */
export function checkEntryPath(path: string): string {
	const slashed = path.replace(/\\/g, '/');
	if (slashed.includes('\0') || slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed) || slashed.split('/').includes('..')) {
		throw new PackError(`Refused the pack: the path "${path}" points outside the bundle.`);
	}
	return slashed.split('/').filter((part) => part !== '' && part !== '.').join('/');
}

/** Reads info.json. A missing or bad file gives version 2 and the Markdown type. */
export function parseInfo(json: string | null): { info: BundleInfo; warning: string | null } {
	if (json === null) return { info: { version: 2, type: MARKDOWN_TYPE, raw: null }, warning: 'No info.json. Used the Markdown type.' };
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return { info: { version: 2, type: MARKDOWN_TYPE, raw: null }, warning: 'info.json is not valid JSON. Used the Markdown type.' };
	}
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { info: { version: 2, type: MARKDOWN_TYPE, raw: null }, warning: 'info.json is not an object. Used the Markdown type.' };
	const obj = raw as Record<string, unknown>;
	const version = typeof obj.version === 'number' && Number.isInteger(obj.version) ? obj.version : 2;
	const type = typeof obj.type === 'string' && obj.type.trim() ? obj.type.trim() : MARKDOWN_TYPE;
	return { info: { version, type, raw: obj }, warning: null };
}

/** True for the Markdown UTIs that editors write (Markdown, MultiMarkdown, CommonMark). */
export function isMarkdownType(type: string, textName: string): boolean {
	if (/markdown|commonmark/i.test(type)) return true;
	return type === '' && /\.(md|markdown)$/i.test(textName);
}

/** Note name from a pack or bundle file name: no extension, no characters that a vault file name refuses. */
export function noteName(fileName: string): string {
	const base = fileName.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
	const name = base
		.replace(/\.(textpack|textbundle|zip)$/i, '')
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.trim();
	return name || 'Untitled';
}

/** Splits "dir/base.ext" into its parts. A leading dot is part of the base. */
function splitPath(path: string): { dir: string; base: string; ext: string } {
	const slash = path.lastIndexOf('/');
	const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
	const file = path.slice(slash + 1);
	const dot = file.lastIndexOf('.');
	return dot > 0 ? { dir, base: file.slice(0, dot), ext: file.slice(dot) } : { dir, base: file, ext: '' };
}

/** Never overwrite: adds " 1", " 2" to the base name until the path is free. The compare ignores case. */
export function uniquePath(desired: string, taken: (path: string) => boolean): string {
	if (!taken(desired)) return desired;
	const { dir, base, ext } = splitPath(desired);
	for (let i = 1; ; i++) {
		const next = `${dir}${base} ${i}${ext}`;
		if (!taken(next)) return next;
	}
}

/** uniquePath for a list of taken paths (golden vectors). */
export function uniqueAmong(desired: string, taken: string[]): string {
	const set = new Set(taken.map((path) => path.toLowerCase()));
	return uniquePath(desired, (path) => set.has(path.toLowerCase()));
}

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$)/;

/**
 * Makes a bundle from its files (paths relative to the pack or the picked folder).
 * Accepts one top folder (Name.textbundle/). Refuses the whole bundle for an unsafe path.
 */
export function bundleFromFiles(fileName: string, input: Record<string, Uint8Array>): Bundle {
	const files = new Map<string, Uint8Array>();
	for (const [path, bytes] of Object.entries(input)) {
		const clean = checkEntryPath(path);
		if (!clean || path.endsWith('/') || IGNORED.test(clean)) continue;
		files.set(clean, bytes);
	}
	const isText = (rel: string) => /^text\.[^/]+$/i.test(rel);
	let prefix = '';
	if (![...files.keys()].some(isText)) {
		const tops = new Set([...files.keys()].filter((path) => path.includes('/')).map((path) => path.slice(0, path.indexOf('/') + 1)));
		const candidates = [...tops].filter((top) => [...files.keys()].some((path) => path.startsWith(top) && isText(path.slice(top.length))));
		if (candidates.length !== 1) throw new PackError('No text file (text.markdown or text.md) in the bundle.');
		prefix = candidates[0]!;
	}
	const inner = new Map<string, Uint8Array>();
	for (const [path, bytes] of files) if (path.startsWith(prefix)) inner.set(path.slice(prefix.length), bytes);
	const texts = [...inner.keys()].filter(isText).sort();
	const rank = (name: string) => (name.toLowerCase() === 'text.markdown' ? 0 : name.toLowerCase() === 'text.md' ? 1 : 2);
	const textName = texts.sort((a, b) => rank(a) - rank(b))[0]!;
	const warnings: string[] = [];
	const infoKey = [...inner.keys()].find((path) => path.toLowerCase() === 'info.json');
	const decoder = new TextDecoder('utf-8');
	const { info, warning } = parseInfo(infoKey ? decoder.decode(inner.get(infoKey)) : null);
	if (warning) warnings.push(warning);
	const markdown = isMarkdownType(info.type, textName);
	if (!markdown) warnings.push(`The text type is ${info.type}. Imported the text without link changes.`);
	const assets: Bundle['assets'] = [];
	let other = 0;
	for (const [path, bytes] of inner) {
		if (/^assets\//i.test(path)) assets.push({ path: path.slice('assets/'.length), bytes });
		else if (path !== infoKey && !isText(path)) other++;
	}
	if (texts.length > 1) warnings.push(`The bundle has ${texts.length} text files. Imported ${textName}.`);
	if (other) warnings.push(`Skipped ${other} files outside assets/.`);
	assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { name: noteName(fileName), textName, text: decoder.decode(inner.get(textName)), info, markdown, assets, warnings };
}

/** Unpacks a .textpack (zip). Checks the limits and the paths before each file is unpacked. */
export function readPack(fileName: string, bytes: Uint8Array): Bundle {
	const early = checkLimits(bytes.length, 0, 0);
	if (early) throw new PackError(early);
	let entries = 0;
	let unpacked = 0;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				checkEntryPath(file.name);
				entries++;
				unpacked += file.originalSize;
				const limit = checkLimits(bytes.length, entries, unpacked);
				if (limit) throw new PackError(limit);
				return true;
			},
		});
	} catch (error) {
		if (error instanceof PackError) throw error;
		throw new PackError(`${fileName} is not a TextPack (zip) file.`);
	}
	return bundleFromFiles(fileName, files);
}

/** Percent-encodes the characters that end or break a Markdown link destination. */
export function encodeLinkPath(path: string): string {
	return path.replace(/[ %()<>[\]]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function decodeLink(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

type Dest = { raw: string; angle: boolean };
/** Calls fn for each link target outside code and puts its answer in place. Null keeps the target. */
function mapTargets(text: string, fn: (dest: Dest) => string | null, wiki?: (embed: boolean, target: string, alias: string | null) => string | null): string {
	const lines = text.split('\n');
	let fence: string | null = null;
	return lines
		.map((line) => {
			const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
			if (fence) {
				if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
				return line;
			}
			if (marker) {
				fence = marker[1]!;
				return line;
			}
			// Inline code spans keep their text.
			return line
				.split(/(`+[^`]*?`+)/)
				.map((part, i) => {
					if (i % 2 === 1) return part;
					let out = part.replace(/(\]\(\s*)(<[^>\n]*>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)/g, (all, lead: string, dest: string) => {
						const angle = dest.startsWith('<');
						const next = fn({ raw: angle ? dest.slice(1, -1) : dest, angle });
						return next === null ? all : lead + next;
					});
					out = out.replace(/^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/, (all, lead: string, dest: string) => {
						const angle = dest.startsWith('<');
						const next = fn({ raw: angle ? dest.slice(1, -1) : dest, angle });
						return next === null ? all : lead + next;
					});
					out = out.replace(/(<(?:img|a|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*)(["'])([^"'\n]*)\2/gi, (all, lead: string, quote: string, dest: string) => {
						const next = fn({ raw: dest, angle: false });
						return next === null ? all : `${lead}${quote}${next.replace(/^<|>$/g, '')}${quote}`;
					});
					if (wiki) {
						out = out.replace(/(!?)\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (all, bang: string, target: string, _sub: string | undefined, alias: string | undefined) => {
							const next = wiki(bang === '!', target.trim(), alias ?? null);
							return next === null ? all : next;
						});
					}
					return out;
				})
				.join('');
		})
		.join('\n');
}

/** The text after the last slash of a raw link target, as written. */
const rawTail = (raw: string) => raw.slice(raw.lastIndexOf('/') + 1);
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * Import: points each link to assets/<path> at its vault file. Keeps the link form:
 * the file name stays as written when the vault file has the same name, so an export gives the same bytes.
 * @param vaultPaths asset path below assets/ (decoded) to vault path.
 */
export function rewriteImportLinks(text: string, vaultPaths: Record<string, string>): { text: string; rewritten: number; missing: number } {
	let rewritten = 0;
	let missing = 0;
	const out = mapTargets(text, ({ raw, angle }) => {
		const decoded = angle ? raw : decodeLink(raw);
		const match = /^(?:\.\/)?assets\/(.+)$/i.exec(decoded);
		if (!match) return null;
		const vault = vaultPaths[match[1]!];
		if (vault === undefined) {
			missing++;
			return null;
		}
		rewritten++;
		const slash = vault.lastIndexOf('/');
		const dir = slash >= 0 ? vault.slice(0, slash + 1) : '';
		const sameName = baseName(vault) === baseName(match[1]!);
		if (angle) return `<${vault}>`;
		return encodeLinkPath(dir) + (sameName ? rawTail(raw) : encodeLinkPath(baseName(vault)));
	});
	return { text: out, rewritten, missing };
}

/**
 * Export: changes each link to an attachment (a resolved non-Markdown file) to assets/<name>.
 * @param resolve link target (decoded, no subpath) to the vault path of an attachment, or null for notes, URLs and missing files.
 */
export function exportLinks(text: string, resolve: (target: string) => string | null): { text: string; assets: Array<{ vaultPath: string; name: string }> } {
	const names = new Map<string, string>();
	const taken = new Set<string>();
	const assign = (vaultPath: string): string => {
		let name = names.get(vaultPath);
		if (name === undefined) {
			name = uniquePath(baseName(vaultPath), (n) => taken.has(n.toLowerCase()));
			taken.add(name.toLowerCase());
			names.set(vaultPath, name);
		}
		return name;
	};
	const out = mapTargets(
		text,
		({ raw, angle }) => {
			if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) return null;
			const decoded = (angle ? raw : decodeLink(raw)).replace(/#.*$/, '');
			if (!decoded) return null;
			const vaultPath = resolve(decoded);
			if (vaultPath === null) return null;
			const name = assign(vaultPath);
			if (angle) return `<assets/${name}>`;
			return `assets/${name === baseName(decoded) ? rawTail(raw) : encodeLinkPath(name)}`;
		},
		(embed, target, alias) => {
			const vaultPath = resolve(target);
			if (vaultPath === null) return null;
			const name = assign(vaultPath);
			const dest = `assets/${encodeLinkPath(name)}`;
			if (embed) return `![${alias && !/^\d+(x\d+)?$/.test(alias) ? alias : ''}](${dest})`;
			return `[${alias ?? baseName(target)}](${dest})`;
		},
	);
	return { text: out, assets: [...names].map(([vaultPath, name]) => ({ vaultPath, name })) };
}

const FRONT = /^---\r?\n/;
/** Pro round trip: stores info.json as a one line JSON property (JSON is valid YAML). */
export function withInfoProperty(text: string, info: Record<string, unknown>): string {
	const line = `${INFO_KEY}: ${JSON.stringify(info)}`;
	const open = FRONT.exec(text);
	if (open && /\r?\n---\s*(\r?\n|$)/.test(text.slice(open[0].length - 1))) return `${open[0]}${line}\n${text.slice(open[0].length)}`;
	return `---\n${line}\n---\n${text}`;
}

/** Takes the info property out of the text again. The rest of the text keeps its bytes. */
export function takeInfoProperty(text: string): { text: string; info: Record<string, unknown> | null } {
	const open = FRONT.exec(text);
	if (!open) return { text, info: null };
	const lineRe = new RegExp(`^${INFO_KEY}: (.*)\\n`);
	const rest = text.slice(open[0].length);
	const hit = lineRe.exec(rest);
	if (!hit) return { text, info: null };
	let info: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = JSON.parse(hit[1]!);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) info = parsed as Record<string, unknown>;
	} catch {
		info = null;
	}
	const after = rest.slice(hit[0].length);
	// The plugin added the whole block: remove it all.
	if (/^---\r?\n/.test(after) && open[0] === '---\n') return { text: after.replace(/^---\r?\n/, ''), info };
	return { text: open[0] + after, info };
}

/** info.json for an export. Keeps the keys of other apps from a stored info (spec, Cooperating With Other Applications). */
export function exportInfo(stored: Record<string, unknown> | null): Record<string, unknown> {
	const base: Record<string, unknown> = { version: 2, type: MARKDOWN_TYPE, transient: false, creatorIdentifier: 'md.obsidian' };
	if (!stored) return base;
	return { ...base, ...stored, version: 2, type: typeof stored.type === 'string' && stored.type ? stored.type : MARKDOWN_TYPE };
}

/** Builds a .textpack: Name.textbundle/info.json, text.markdown and assets/. */
export function buildPack(name: string, text: string, info: Record<string, unknown>, assets: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
	const root = `${name}.textbundle/`;
	const files: Record<string, Uint8Array> = {
		[`${root}info.json`]: strToU8(`${JSON.stringify(info, null, 2)}\n`),
		[`${root}text.markdown`]: strToU8(text),
	};
	for (const asset of assets) files[`${root}assets/${asset.name}`] = asset.bytes;
	return zipSync(files, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
}

/**
 * Groups picked or dropped files into bundles. A bundle is each folder that ends in .textbundle,
 * or the picked top folder when it holds a text.* file.
 */
export function groupBundleFiles(paths: string[]): Array<{ root: string; files: Array<{ path: string; rel: string }> }> {
	const groups = new Map<string, Array<{ path: string; rel: string }>>();
	for (const path of paths) {
		const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
		let at = parts.findIndex((part) => /\.textbundle$/i.test(part));
		if (at < 0 && parts.length >= 2 && paths.some((p) => p.replace(/\\/g, '/').split('/').filter(Boolean).join('/').toLowerCase().startsWith(`${parts[0]!.toLowerCase()}/text.`))) at = 0;
		if (at < 0 || at === parts.length - 1) continue;
		const root = parts.slice(0, at + 1).join('/');
		const list = groups.get(root) ?? [];
		list.push({ path, rel: parts.slice(at + 1).join('/') });
		groups.set(root, list);
	}
	return [...groups].map(([root, files]) => ({ root, files }));
}
