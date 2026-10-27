/** One live note of a .zkn3 archive. The position is the original one-based slot in zknFile.xml. */
export interface Note {
	position: number;
	id: string;
	title: string;
	content: string;
	keywords: string[];
	crossRefs: number[];
	sequence: number[];
	remarks: string;
	created: string;
	edited: string;
	attachments: number;
}
export interface Archive {
	version: string;
	slots: number;
	notes: Note[];
	deleted: number[];
	warnings: string[];
}

export const SUPPORTED_VERSION = '3.8';
const MAX_XML = 90 * 1024 * 1024;
export const MAX_SLOTS = 50000;

function parse(xml: string, label: string): Element {
	if (xml.length > MAX_XML) throw new Error(`${label} is too large.`);
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`${label} has a document type or an entity. The archive is rejected.`);
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	const root = doc.documentElement;
	if (!root || doc.getElementsByTagName('parsererror').length) throw new Error(`${label} is not valid XML.`);
	return root;
}
function child(el: Element, name: string): Element | null {
	for (const c of Array.from(el.children)) if (c.tagName === name) return c;
	return null;
}
function text(el: Element, name: string): string {
	return child(el, name)?.textContent ?? '';
}
/** Read a comma list of one-based positions. Bad items go to the warnings. */
function positions(value: string, where: string, warnings: string[]): number[] {
	const result: number[] = [];
	for (const raw of value.split(',')) {
		const item = raw.trim();
		if (!item) continue;
		if (!/^\d{1,6}$/.test(item) || Number(item) < 1) { warnings.push(`${where}: invalid number "${item.slice(0, 40)}".`); continue; }
		if (!result.includes(Number(item))) result.push(Number(item));
	}
	return result;
}

/** Parse the three XML parts of a version 3.8 archive. Validate all of it before the import writes a file. */
export function parseParts(meta: string, zkn: string, keywordXml: string): Archive {
	const metaRoot = parse(meta, 'metaInformation.xml');
	const version = metaRoot.tagName === 'metainformation' ? child(metaRoot, 'version')?.getAttribute('id') ?? '' : '';
	if (version !== SUPPORTED_VERSION) throw new Error(`Archive version ${version || 'unknown'} is not supported. Select a version 3.8 archive.`);
	const root = parse(zkn, 'zknFile.xml');
	if (root.tagName !== 'zettelkasten') throw new Error('zknFile.xml has no zettelkasten root.');
	const keywordList: string[] = [];
	if (keywordXml.trim()) {
		const kroot = parse(keywordXml, 'keywordFile.xml');
		if (kroot.tagName !== 'keywords') throw new Error('keywordFile.xml has no keywords root.');
		for (const entry of Array.from(kroot.children)) if (entry.tagName === 'entry') keywordList.push(entry.textContent ?? '');
	}
	const slots = Array.from(root.children).filter((c) => c.tagName === 'zettel');
	if (slots.length > MAX_SLOTS) throw new Error(`The archive has more than ${MAX_SLOTS} note slots.`);
	const warnings: string[] = [];
	const notes: Note[] = [];
	const deleted: number[] = [];
	const ids = new Set<string>();
	slots.forEach((el, i) => {
		const position = i + 1;
		const content = text(el, 'content');
		// Zettelkasten 3 marks a deleted note with empty content and keeps its slot.
		if (!content) { deleted.push(position); return; }
		const where = `Note ${position}`;
		const id = el.getAttribute('zknid') ?? '';
		if (id) {
			if (ids.has(id)) throw new Error(`Two notes have the same zknid: ${id.slice(0, 60)}.`);
			ids.add(id);
		}
		const keywords: string[] = [];
		for (const n of positions(text(el, 'keywords'), `${where} keywords`, warnings)) {
			const value = keywordList[n - 1];
			if (value === undefined || !value.trim()) { warnings.push(`${where}: missing keyword ${n}.`); continue; }
			if (!keywords.includes(value)) keywords.push(value);
		}
		const attachments = child(el, 'links')?.children.length ?? 0;
		if (attachments) warnings.push(`${where}: ${attachments} attachment links are not imported.`);
		if (text(el, 'author').trim()) warnings.push(`${where}: authors are not imported.`);
		notes.push({
			position, id, title: text(el, 'title'), content, keywords,
			crossRefs: positions(text(el, 'manlinks'), `${where} cross-references`, warnings),
			sequence: positions(text(el, 'luhmann'), `${where} note sequence`, warnings),
			remarks: text(el, 'misc'),
			created: el.getAttribute('ts_created') ?? '', edited: el.getAttribute('ts_edited') ?? '', attachments,
		});
	});
	return { version, slots: slots.length, notes, deleted, warnings };
}

/** A stable public result for golden vectors, including rejection cases. */
export function inspectXml(meta: string, zkn: string, keywords: string): { live: number; positions: number[]; deleted: number[]; keywords: string[][]; warnings: string[] } | { error: string } {
	try {
		const a = parseParts(meta, zkn, keywords);
		return { live: a.notes.length, positions: a.notes.map((n) => n.position), deleted: a.deleted, keywords: a.notes.map((n) => n.keywords), warnings: a.warnings };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
