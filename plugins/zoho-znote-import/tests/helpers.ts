import { strToU8, zipSync } from 'fflate';
export interface Member { name: string; text?: string; type?: string }
export function tar(members: Member[]): Uint8Array {
	const chunks: Uint8Array[] = [];
	const set = (h: Uint8Array, at: number, text: string) => h.set(strToU8(text), at);
	for (const m of members) {
		const data = strToU8(m.text ?? ''); const h = new Uint8Array(512);
		set(h, 0, m.name); set(h, 100, '0000644\0'); set(h, 108, '0000000\0'); set(h, 116, '0000000\0');
		set(h, 124, data.length.toString(8).padStart(11, '0') + '\0'); set(h, 136, '00000000000\0');
		h.fill(32, 148, 156); h[156] = (m.type ?? '0').charCodeAt(0); set(h, 257, 'ustar\0');
		set(h, 148, h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ');
		const padded = new Uint8Array(Math.ceil(data.length / 512) * 512); padded.set(data);
		chunks.push(h, padded);
	}
	chunks.push(new Uint8Array(1024));
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0;
	for (const c of chunks) { out.set(c, at); at += c.length; }
	return out;
}
export interface SyntheticCard { id?: string; title?: string; type?: string; html?: string; xml?: string; tags?: string[]; created?: string; modified?: string; extra?: Member[]; notebook?: string; protected?: boolean }
export function fixture(cards: SyntheticCard[]): Uint8Array {
	const files: Record<string, Uint8Array> = {};
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	for (let i = 0; i < cards.length; i++) {
		const c = cards[i]!; const id = c.id ?? `card${i + 1}`; const book = c.notebook ?? 'Notebook';
		files[`${book}/meta.json`] = strToU8(JSON.stringify({ data_type: 'NOTEBOOK', name: book }));
		const xml = c.xml ?? `<ZNote${c.protected ? ' encrypted="true"' : ''}><ZMeta><ZTitle>${esc(c.title ?? 'Mine')}</ZTitle><ZCreatedDate>${c.created ?? '2024-04-13T16:21:59+0000'}</ZCreatedDate><ZModifiedDate>${c.modified ?? '2024-04-13T16:28:44+0000'}</ZModifiedDate><ZNoteColor>#D4E0E3</ZNoteColor><ZNoteType>${c.type ?? 'note/mixed'}</ZNoteType></ZMeta><ZContent><![CDATA[${c.html ?? '<p>Hello</p>'}]]></ZContent><ZTags>${(c.tags ?? []).map(t => `<ZTag>${esc(t)}</ZTag>`).join('')}</ZTags></ZNote>`;
		files[`${book}/${id}.znote`] = tar([{ name: `${id}/Note.znel`, text: xml }, ...c.extra ?? []]);
	}
	return zipSync(files);
}
