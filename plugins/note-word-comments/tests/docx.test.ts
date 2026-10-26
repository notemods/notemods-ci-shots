import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { imageSize, initials, readImageHeader, toDocxBytes } from '../src/docx';
import { parseNote, type ParseOptions } from '../src/parse';

/** Exports text and returns the XML parts of the DOCX. */
async function xml(text: string, opts: ParseOptions = { author: 'Lee' }): Promise<{ body: string; comments: string; files: string[] }> {
	const p = parseNote(text, opts);
	expect(p.problems).toEqual([]);
	const bytes = await toDocxBytes({ title: 'T', creator: opts.author, notes: [p.blocks], comments: p.comments });
	const zip = unzipSync(new Uint8Array(bytes));
	return { body: strFromU8(zip['word/document.xml']!), comments: strFromU8(zip['word/comments.xml'] ?? new Uint8Array()), files: Object.keys(zip) };
}

const bodyText = (doc: string) => [...doc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
const ids = (doc: string, tag: string) => [...doc.matchAll(new RegExp(`<w:${tag} w:id="(\\d+)"`, 'g'))].map((m) => Number(m[1]));

describe('DOCX output', () => {
	it('case 1: body reads "We need evidence." and one comment by Lee spans evidence', async () => {
		const { body, comments } = await xml('We need evidence %% add a source %%.');
		expect(bodyText(body)).toBe('We need evidence.');
		expect(ids(body, 'commentRangeStart')).toEqual([0]);
		expect(ids(body, 'commentRangeEnd')).toEqual([0]);
		expect(ids(body, 'commentReference')).toEqual([0]);
		const span = body.slice(body.indexOf('<w:commentRangeStart'), body.indexOf('<w:commentRangeEnd'));
		expect(bodyText(span)).toBe('evidence');
		expect(comments).toMatch(/<w:comment w:id="0" w:initials="L" w:author="Lee"/);
		expect(comments).toContain('add a source');
	});

	it('case 2: one heading and one paragraph, no comment entries', async () => {
		const { body, comments } = await xml('# Draft\n\nPlain text.');
		expect(body.match(/<w:p>|<w:p /g)?.length).toBe(2);
		expect(body).toContain('<w:pStyle w:val="Heading1"/>');
		expect(bodyText(body)).toBe('DraftPlain text.');
		expect(comments).not.toContain('<w:comment ');
		expect(body).not.toContain('commentReference');
	});

	it('case 3: anchor spans αβ and the comment escapes <, & and >', async () => {
		const { body, comments } = await xml('αβ %% Check < & > %%.');
		const span = body.slice(body.indexOf('<w:commentRangeStart'), body.indexOf('<w:commentRangeEnd'));
		expect(bodyText(span)).toBe('αβ');
		expect(comments).toContain('Check &lt; &amp; &gt;');
		expect(comments).not.toContain('Check < &');
	});

	it('case 4: two ids, two ranges on Word, two references, no %% in the body', async () => {
		const { body, comments } = await xml('Word %% first %% %% second %%.');
		expect(ids(body, 'commentRangeStart')).toEqual([0, 1]);
		expect(ids(body, 'commentRangeEnd')).toEqual([0, 1]);
		expect(ids(body, 'commentReference')).toEqual([0, 1]);
		expect(ids(comments, 'comment')).toEqual([0, 1]);
		expect(bodyText(body)).toBe('Word.');
		expect(body).not.toContain('%%');
	});

	it('writes line breaks inside a paragraph and keeps headings 1 to 6', async () => {
		const { body } = await xml('###### Small\n\nOne\ntwo');
		expect(body).toContain('<w:pStyle w:val="Heading6"/>');
		expect(body).toContain('<w:br/>');
	});

	it('Pro: writes a table with a header row and a comment in a cell', async () => {
		const { body, comments } = await xml('| Item | Cost |\n| --- | --- |\n| Rent %% check %% | 900 |', { author: 'Lee', pro: true });
		expect(body).toContain('<w:tbl>');
		expect(body.match(/<w:tr>|<w:tr /g)?.length).toBe(2);
		expect(body).toContain('<w:tblHeader/>');
		expect(ids(body, 'commentReference')).toEqual([0]);
		expect(comments).toContain('check');
	});

	it('Pro: joins notes with a page break and continues comment ids', async () => {
		const a = parseNote('A %% one %%.', { author: 'Lee' });
		const b = parseNote('B %% two %%.', { author: 'Sam', firstId: a.comments.length });
		const bytes = await toDocxBytes({ title: 'J', creator: 'Lee', notes: [a.blocks, b.blocks], comments: [...a.comments, ...b.comments] });
		const zip = unzipSync(new Uint8Array(bytes));
		const body = strFromU8(zip['word/document.xml']!);
		const comments = strFromU8(zip['word/comments.xml']!);
		expect(body).toContain('<w:br w:type="page"/>');
		expect(ids(body, 'commentReference')).toEqual([0, 1]);
		expect(comments).toMatch(/w:id="1" w:initials="S" w:author="Sam"/);
	});

	it('Pro: embeds a PNG image with its size', async () => {
		const png = tinyPng(800, 400);
		const p = parseNote('![[a.png]]', { author: 'Lee', pro: true });
		const head = readImageHeader(png)!;
		const bytes = await toDocxBytes({ title: 'I', creator: 'Lee', notes: [p.blocks], comments: [], images: new Map([['a.png', { ...head, data: png }]]) });
		const zip = unzipSync(new Uint8Array(bytes));
		expect(Object.keys(zip).some((f) => f.startsWith('word/media/') && f.endsWith('.png'))).toBe(true);
		expect(strFromU8(zip['word/document.xml']!)).toContain('<wp:extent cx="5715000" cy="2857500"/>');
	});
});

/** PNG signature and IHDR only: enough for the header reader and for docx. */
function tinyPng(w: number, h: number): Uint8Array {
	const b = new Uint8Array(33);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const v = new DataView(b.buffer);
	v.setUint32(16, w);
	v.setUint32(20, h);
	return b;
}

describe('image headers and sizes', () => {
	it('reads PNG, GIF, BMP and JPEG sizes', () => {
		expect(readImageHeader(tinyPng(10, 20))).toEqual({ type: 'png', width: 10, height: 20 });
		const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 5, 0, 7, 0]);
		expect(readImageHeader(gif)).toEqual({ type: 'gif', width: 5, height: 7 });
		const bmp = new Uint8Array(26);
		bmp.set([0x42, 0x4d]);
		new DataView(bmp.buffer).setInt32(18, 30, true);
		new DataView(bmp.buffer).setInt32(22, -40, true);
		expect(readImageHeader(bmp)).toEqual({ type: 'bmp', width: 30, height: 40 });
		const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 50, 0, 60, 3, 0, 0, 0, 0]);
		expect(readImageHeader(jpg)).toEqual({ type: 'jpg', width: 60, height: 50 });
		expect(readImageHeader(new Uint8Array([1, 2, 3]))).toBeNull();
	});

	it('limits the width to 600 and keeps the ratio', () => {
		expect(imageSize({ width: 800, height: 400 }, null)).toEqual({ width: 600, height: 300 });
		expect(imageSize({ width: 800, height: 400 }, 200)).toEqual({ width: 200, height: 100 });
		expect(imageSize({ width: 100, height: 50 }, null)).toEqual({ width: 100, height: 50 });
	});

	it('makes initials from the author name', () => {
		expect(initials('Lee')).toBe('L');
		expect(initials('sam ortiz lee')).toBe('SO');
		expect(initials('Ébène')).toBe('É');
	});
});
