import { htmlToMarkdown, normalizePath, stringifyYaml } from 'obsidian';
import { strFromU8 } from 'fflate';
import { readTar, readZip, safeArchivePath } from './archive';

export interface Card {
	id: string; notebook: string; title: string; type: string; html: string;
	properties: Record<string, unknown>; dates: { ctime?: number; mtime?: number };
	files: Record<string, Uint8Array>; base: string; source: Uint8Array;
}
export interface Archive { cards: Card[]; warnings: string[]; cardCount: number; resourceCount: number; notebookCount: number }
export interface Profile { name: string; notebookFolders: Record<string, string>; fields: Record<string, string> }
export interface Plan {
	notes: { path: string; content: string; dates: Card['dates']; id: string }[];
	assets: { path: string; data: Uint8Array }[]; warnings: string[]; folder: string;
}
export function safeName(value: string): string {
	let s = Array.from(value.normalize('NFC')).map(c => c.charCodeAt(0) < 32 ? ' ' : c).join('').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
	// Cut by code point, then strip again: a cut can split a surrogate pair or end on a space or dot.
	s = Array.from(s).slice(0, 100).join('').replace(/^[. ]+|[. ]+$/g, '');
	if (!s) s = 'Untitled';
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) s = `_${s}`;
	return s;
}
export function safeFolder(value: string): string {
	const path = value.trim();
	if (!safeArchivePath(path) || path.split('/').some(p => p.startsWith('.') || p !== safeName(p))) throw new Error('Use a new vault folder without reserved characters or dot segments.');
	return normalizePath(path);
}
function xmlDocument(xml: string): Document {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML declarations are not supported.');
	const normalized = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_full: string, content: string) => content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
	const doc = new DOMParser().parseFromString(normalized, 'application/xml');
	if (doc.querySelector('parsererror') || doc.documentElement?.tagName !== 'ZNote' || !doc.querySelector('ZMeta') || !doc.querySelector('ZContent')) throw new Error('Malformed card XML.');
	return doc;
}
export function readArchive(files: Record<string, Uint8Array>): Archive {
	const result: Archive = { cards: [], warnings: [], cardCount: 0, resourceCount: 0, notebookCount: 0 };
	const books = new Map<string, string>();
	for (const [path, data] of Object.entries(files)) if (path.endsWith('/meta.json') || path === 'meta.json') {
		try {
			const meta = JSON.parse(strFromU8(data)) as Record<string, unknown>;
			if (meta.data_type !== 'NOTEBOOK' || typeof meta.name !== 'string') throw new Error('Invalid notebook metadata.');
			books.set(path.slice(0, -'meta.json'.length), meta.name);
		} catch { result.warnings.push(`${path}: invalid notebook metadata.`); }
	}
	result.notebookCount = books.size;
	const ids = new Set<string>();
	for (const [path, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) if (path.endsWith('.znote')) {
		result.cardCount++;
		try {
			const notebook = books.get(path.slice(0, path.lastIndexOf('/') + 1));
			if (!notebook) throw new Error('Notebook metadata is absent.');
			const id = path.slice(path.lastIndexOf('/') + 1, -6);
			if (!id || ids.has(id)) throw new Error('Duplicate or empty card ID.');
			ids.add(id);
			const members = readTar(data);
			const envelopes = Object.keys(members).filter(n => n.endsWith('/Note.znel') || n === 'Note.znel');
			result.resourceCount += Object.keys(members).length - envelopes.length;
			if (envelopes.length !== 1) throw new Error('Expected one Note.znel.');
			const envelope = envelopes[0]!;
			const doc = xmlDocument(strFromU8(members[envelope]!));
			const text = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? '';
			if (Array.from(doc.querySelectorAll('*')).some(e => /password|encrypt|protected/i.test(e.tagName) && !/^(false|0|)$/i.test(e.textContent?.trim() ?? '')) || Array.from(doc.documentElement.attributes).some(a => /encrypt|password|protected/i.test(a.name) && !/^(false|0|)$/i.test(a.value))) throw new Error('Password protected or encrypted card.');
			const type = text('ZNoteType');
			if (!['note/text', 'note/mixed', 'note/checklist', 'note/image'].includes(type)) throw new Error(`Unsupported card type ${type || 'unknown'}.`);
			const dates: Card['dates'] = {};
			const properties: Record<string, unknown> = { zoho_id: id, notebook, title: text('ZTitle') || 'Untitled', color: text('ZNoteColor'), tags: Array.from(doc.querySelectorAll('ZTags ZTag')).map(t => t.textContent ?? ''), zoho_type: type };
			for (const [tag, key, option] of [['ZCreatedDate', 'created', 'ctime'], ['ZModifiedDate', 'modified', 'mtime']] as const) {
				const raw = text(tag);
				if (raw) {
					properties[key] = raw;
					const ms = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
					if (Number.isFinite(ms)) dates[option] = ms;
					else result.warnings.push(`${id}: invalid ${key} date; file date uses the vault default.`);
				}
			}
			const content = doc.querySelector('ZContent')!;
			result.cards.push({ id, notebook, title: String(properties.title), type, html: content.textContent ?? '', properties, dates, files: members, base: envelope.slice(0, -'Note.znel'.length), source: data });
		} catch (e) { result.warnings.push(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
	}
	return result;
}
export const readExport = (bytes: Uint8Array): Archive => readArchive(readZip(bytes));
/** Remove active content and remote images before parsing the HTML. */
function safeHtml(html: string): string {
	const allowed = new Set('content checkbox znresource p div span b strong i em u s del br hr h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code a table thead tbody tr th td'.split(' '));
	return html.replace(/<(script|style|iframe|object|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi, (full: string, tag: string, attrs: string) => {
		if (!allowed.has(tag.toLowerCase())) return '';
		if (full.startsWith('</')) return `</${tag}>`;
		const clean = attrs.replace(/\s(?:on[a-z]+|style|src|srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
		return `<${tag}${clean}>${/\/$/.test(clean) && ['checkbox', 'znresource'].includes(tag.toLowerCase()) ? `</${tag}>` : ''}`;
	});
}
export function validateProfile(profile: Profile): void {
	const sources = ['title', 'created', 'modified', 'color', 'tags', 'notebook'];
	if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || !profile.notebookFolders || !profile.fields || Array.isArray(profile.notebookFolders) || Array.isArray(profile.fields)) throw new Error('Invalid mapping profile.');
	for (const value of Object.values(profile.notebookFolders)) if (typeof value !== 'string' || value !== safeName(value)) throw new Error('Notebook mappings need one safe folder name.');
	const targets = sources.map(source => profile.fields[source] ?? source);
	if (new Set(targets).size !== targets.length) throw new Error('Field mapping must use distinct property names.');
	for (const [source, target] of Object.entries(profile.fields)) if (!sources.includes(source) || typeof target !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(target) || ['zoho_id', 'zoho_type', '__proto__', 'constructor', 'prototype'].includes(target) || (target !== source && sources.includes(target))) throw new Error('Field mapping must use distinct property names.');
}
export function planImport(archive: Archive, folderInput: string, profile: Profile | null = null, existing = false): Plan {
	const folder = safeFolder(folderInput);
	if (profile) validateProfile(profile);
	if (existing) throw new Error('Output folder exists. Use a new folder.');
	const plan: Plan = { folder, notes: [], assets: [], warnings: [...archive.warnings] };
	const paths = new Map<string, string>();
	const used = new Set<string>([`${folder}/Import report.md`.toLowerCase(), `${folder}/Card index.json`.toLowerCase()]);
	function unique(path: string): string {
		let p = path; let n = 2;
		while (used.has(p.toLowerCase())) p = /\.[^./]+$/.test(path) ? path.replace(/(\.[^./]+)$/, ` (${n++})$1`) : `${path} (${n++})`;
		used.add(p.toLowerCase()); return p;
	}
	for (const card of archive.cards) {
		const book = profile && Object.prototype.hasOwnProperty.call(profile.notebookFolders, card.notebook) ? profile.notebookFolders[card.notebook]! : card.notebook;
		const bookFolder = safeName(book);
		paths.set(card.id, unique(normalizePath(`${folder}/${bookFolder}/${safeName(card.title)}.md`)));
	}
	for (const card of archive.cards) {
		const doc = new DOMParser().parseFromString(safeHtml(card.html), 'text/html');
		const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest('pre,code')) node.nodeValue = (node.nodeValue ?? '').replace(/\uE000/g, '').replace(/<(?=[a-z/!?])/gi, '\uE000');
		const tokens = new Map<string, string>();
		let prefix = 'ZNPLACEHOLDER';
		while (card.html.includes(prefix)) prefix += 'X';
		const assetPaths = new Map<string, string>();
		function replace(el: Element, text: string): void {
			const token = `${prefix}${tokens.size}END`;
			tokens.set(token, text); el.replaceWith(doc.createTextNode(token));
		}
		for (const el of Array.from(doc.querySelectorAll('znresource'))) {
			const ref = el.getAttribute('relative-path') ?? '';
			const candidates = [...new Set([ref, card.base + ref])].filter(n => safeArchivePath(n) && !!card.files[n]);
			if (candidates.length !== 1 || candidates[0]!.endsWith('Note.znel')) {
				plan.warnings.push(`${card.id}: resource absent or ambiguous ${ref}.`);
				replace(el, `Source resource: ${ref.replace(/[\\[\]()*!<>`]/g, '\\$&')}`); continue;
			}
			const source = candidates[0]!;
			let target = assetPaths.get(source);
			if (!target) {
				target = unique(`${folder}/assets/${safeName(card.id)}/${safeName(source.split('/').pop()!)}`);
				assetPaths.set(source, target); plan.assets.push({ path: target, data: card.files[source]! });
			}
			replace(el, `${(el.getAttribute('type') ?? '').startsWith('image/') && /\.(png|jpe?g|gif|webp|bmp)$/i.test(target) ? '!' : ''}[[${target}]]`);
		}
		for (const el of Array.from(doc.querySelectorAll('a'))) {
			const href = el.getAttribute('href') ?? '';
			if (href.startsWith('zohonotebook://')) {
				const match = /^zohonotebook:\/\/notes\/([^/?#]+)$/.exec(href);
				const target = match ? paths.get(match[1]!) : undefined;
				if (target) replace(el, `[[${target}|${(el.textContent ?? '').replace(/[|[\]\r\n]/g, ' ')}]]`);
				else { plan.warnings.push(`${card.id}: no exact card ID match for ${href}.`); replace(el, `[${(el.textContent ?? 'Source link').replace(/[\\[\]()*!<>`]/g, '\\$&')}](${encodeURI(href).replace(/\(/g, '%28').replace(/\)/g, '%29')})`); }
			} else if (!/^(https?:|mailto:)/i.test(href)) el.removeAttribute('href');
		}
		for (const el of Array.from(doc.querySelectorAll('checkbox'))) {
			let task = htmlToMarkdown(el as HTMLElement).trim();
			for (const [token, value] of tokens) task = task.split(token).join(value);
			replace(el, `\n- [${el.getAttribute('checked') === 'true' ? 'x' : ' '}] ${task}\n`);
		}
		let body = htmlToMarkdown(doc.body).trim();
		for (const [token, value] of tokens) body = body.split(token).join(value);
		body = body.replace(/\uE000/g, '&lt;');
		const props: Record<string, unknown> = { ...card.properties };
		if (profile) for (const [source, target] of Object.entries(profile.fields)) {
			if (!['title', 'created', 'modified', 'color', 'tags', 'notebook'].includes(source) || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(target) || target === 'zoho_id' || target === 'zoho_type' || (source !== target && Object.prototype.hasOwnProperty.call(props, target))) throw new Error('Field mapping must use distinct property names.');
			if (source !== target && source in props) { props[target] = props[source]; delete props[source]; }
		}
		plan.notes.push({ path: paths.get(card.id)!, content: `---\n${stringifyYaml(props)}---\n\n${body}\n`, dates: card.dates, id: card.id });
	}
	return plan;
}
