// Builds synthetic version 3.8 .zkn3 archives for the tests and the demo vault.
// The layout follows the public Zettelkasten 3 file format. No source code of that program is copied.
// Run `node tests/fixtures/zkn3.mjs` to write the fixture files again.
import { strToU8, zipSync } from 'fflate';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const metaXml = (version = '3.8') => `<?xml version="1.0" encoding="UTF-8"?>\n<metainformation><version id="${esc(version)}" /><description /><attachmentpath /><imagepath /></metainformation>`;
/** Each note: { title, content, keywords: '1,2', manlinks, luhmann, misc, id, links } or null for a deleted slot. */
export function zknXml(notes) {
	const rows = notes.map((n, i) => {
		if (!n) return '<zettel zknid="" ts_created="" ts_edited="" rating="" ratingcount=""><title /><content /><author /><keywords /><manlinks /><links /><misc /><luhmann /></zettel>';
		const links = (n.links ?? []).map((l) => `<link>${esc(l)}</link>`).join('');
		return `<zettel zknid="${esc(n.id ?? `id-${i + 1}`)}" ts_created="${esc(n.created ?? '2401011200')}" ts_edited="${esc(n.edited ?? '')}" rating="" ratingcount=""><title>${esc(n.title ?? '')}</title><content>${esc(n.content)}</content><author>${esc(n.author ?? '')}</author><keywords>${esc(n.keywords ?? '')}</keywords><manlinks>${esc(n.manlinks ?? '')}</manlinks><links>${links}</links><misc>${esc(n.misc ?? '')}</misc><luhmann>${esc(n.luhmann ?? '')}</luhmann></zettel>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>\n<zettelkasten firstzettel="1" lastzettel="${notes.length}">${rows.join('')}</zettelkasten>`;
}
export const keywordXml = (list) => `<?xml version="1.0" encoding="UTF-8"?>\n<keywords>${list.map((k, i) => `<entry f="1" keywid="k${i + 1}">${esc(k)}</entry>`).join('')}</keywords>`;
const MTIME = new Date('2026-01-01T00:00:00Z');
/** Pack XML parts and extra members into deterministic ZIP bytes. */
export function zkn3(parts) {
	const files = {};
	for (const [name, value] of Object.entries(parts)) files[name] = [typeof value === 'string' ? strToU8(value) : value, { mtime: MTIME }];
	return zipSync(files, { mtime: MTIME });
}
export const archive = (notes, keywords = [], version = '3.8') => zkn3({ 'metaInformation.xml': metaXml(version), 'zknFile.xml': zknXml(notes), 'keywordFile.xml': keywordXml(keywords), 'authorFile.xml': '<authors />' });

/** 75 live notes with keywords and links, like a starter archive. It has no deleted slots. */
export function sample75() {
	const notes = [];
	for (let i = 1; i <= 75; i++) notes.push({ title: `Card ${i}`, content: `Text of card ${i}.[br]See [z ${i === 75 ? 1 : i + 1}]the next card[/z].`, keywords: String((i % 5) + 1) });
	return archive(notes, ['method', 'reading', 'writing', 'archive', 'questions']);
}
/** Slot 2 is deleted. Note 1 links note 3 in text, in manlinks and in luhmann. Note 3 links the deleted slot. */
export function deletedSlot() {
	return archive([
		{ title: 'Start', content: 'Read [z 3]Other[/z] first.', keywords: '1,2', manlinks: '3', luhmann: '3' },
		null,
		{ title: 'Other', content: 'This note points to [z 2]Gone[/z].', keywords: '2' },
	], ['two words', 'two-words']);
}
/** One note with headings, a quote and Markdown text that must stay unchanged. */
export function tricky() {
	return archive([{ title: 'Markup', content: '[h1]Main idea[/h1]Some *Markdown* and a [list](https://example.com) link.[br][q]A short quote.[br]Second line.[/q]After [f]bold[/f] and [k]italic[/k] and [u]underline[/u].' }]);
}
/** The demo archive for the screenshots and the GIF. */
export function demo(later = true) {
	const notes = [
		{ title: 'Luhmann and the card index', content: '[h2]Why a card index[/h2]A note system grows by links, not by folders.[br]Continue with [z 2]fixed positions[/z] and [z 5]note sequences[/z].', keywords: '1,2', manlinks: '6', luhmann: '2,3,4', misc: 'From the reading list of week 1.' },
		{ title: 'Fixed positions', content: 'Each card keeps its number. A new card goes to the end of the box.[br][q]The number is the address of a thought.[/q]', keywords: '1', luhmann: '' },
		{ title: 'Branching', content: 'A sequence can branch. See [z 4]the open question[/z].', keywords: '3' },
		{ title: 'Open question', content: 'How many links does a card need? [f]Two or three[/f] is a good start.', keywords: '3,4' },
		{ title: 'Note sequences', content: 'Zettelkasten 3 keeps the follower cards of a card in an ordered list.[br]Old link: [z 7]removed card[/z].', keywords: '2', manlinks: '1' },
		{ title: 'Keywords with spaces', content: 'The keyword [k]card index[/k] has a space. The import keeps the exact value.[br][color red]Colored text[/color] stays as source text.', keywords: '1,5' },
		null,
		{ title: 'Inbox', content: 'Cards to sort later.', keywords: '4' },
	];
	if (!later) { notes[0] = { ...notes[0], content: 'A note system grows by links.' }; notes.splice(7, 1); }
	return archive(notes, ['card index', 'method', 'questions', 'inbox', 'two words']);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { writeFileSync } = await import('node:fs');
	writeFileSync('tests/fixtures/sample-75.zkn3', sample75());
	writeFileSync('tests/fixtures/deleted-slot.zkn3', deletedSlot());
	writeFileSync('tests/fixtures/tricky.zkn3', tricky());
	writeFileSync('tests/fixtures/version-9.zkn3', archive([{ content: 'x' }], [], '9.0'));
	writeFileSync('docs/sample-notes/Demo archive.zkn3', demo(true));
	writeFileSync('docs/sample-notes/Earlier archive.zkn3', demo(false));
}
