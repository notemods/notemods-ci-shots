// Document model to DOCX bytes with the docx library (browser build: Packer.toBlob, no Buffer, no Node API).
import {
	CommentRangeEnd,
	CommentRangeStart,
	CommentReference,
	Document,
	HeadingLevel,
	ImageRun,
	Packer,
	PageBreak,
	Paragraph,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
	type IRunOptions,
	type ParagraphChild,
} from 'docx';
import type { Block, NoteComment, Run } from './parse';

export interface ImageData {
	type: 'png' | 'jpg' | 'gif' | 'bmp';
	data: Uint8Array;
	width: number;
	height: number;
}

export interface DocxInput {
	title: string;
	creator: string;
	/** One list of blocks for each note. A page break goes between two notes. */
	notes: Block[][];
	comments: NoteComment[];
	/** Image data by Block target, for the Pro image blocks. */
	images?: Map<string, ImageData>;
}

/** The largest image width in the document, in pixels at 96 to the inch (about 6.25 inches). */
export const MAX_IMAGE_WIDTH = 600;

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6] as const;

/** Initials for the Word comment card: first letter of the first two words. */
export function initials(author: string): string {
	return author
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => [...w][0]!.toUpperCase())
		.join('');
}

/** A text run from an options object only. TextRun also takes a string, and that union makes lint read `bold` as String.prototype.bold. */
function textRun(options: IRunOptions): TextRun {
	return new TextRun(options);
}

function runChildren(runs: Run[], bold = false): ParagraphChild[] {
	const out: ParagraphChild[] = [];
	for (const r of runs) {
		if ('br' in r) out.push(new TextRun({ text: '', break: 1 }));
		else if ('text' in r) out.push(textRun({ text: r.text, bold }));
		else {
			for (const id of r.ids) out.push(new CommentRangeStart(id));
			out.push(textRun({ text: r.anchor, bold }));
			for (const id of r.ids) {
				out.push(new CommentRangeEnd(id));
				out.push(new TextRun({ children: [new CommentReference(id)] }));
			}
		}
	}
	return out;
}

/** Display size of an image: the width from the embed, else the file width, at most MAX_IMAGE_WIDTH. */
export function imageSize(img: { width: number; height: number }, want: number | null): { width: number; height: number } {
	const w = Math.max(1, Math.min(MAX_IMAGE_WIDTH, want ?? img.width));
	return { width: Math.round(w), height: Math.max(1, Math.round((img.height * w) / Math.max(1, img.width))) };
}

function blockChildren(b: Block, images: Map<string, ImageData> | undefined): (Paragraph | Table)[] {
	if (b.kind === 'heading') return [new Paragraph({ heading: HEADINGS[b.level - 1], children: runChildren(b.runs) })];
	if (b.kind === 'paragraph') return [new Paragraph({ children: runChildren(b.runs) })];
	if (b.kind === 'table') {
		const cols = Math.max(...b.rows.map((r) => r.length));
		return [
			new Table({
				width: { size: 100, type: WidthType.PERCENTAGE },
				rows: b.rows.map(
					(r, ri) =>
						new TableRow({
							tableHeader: ri === 0,
							children: Array.from(
								{ length: cols },
								(_, ci) => new TableCell({ children: [new Paragraph({ children: runChildren(r[ci] ?? [], ri === 0) })] }),
							),
						}),
				),
			}),
		];
	}
	const img = images?.get(b.target);
	if (!img) throw new Error(`Image data missing for ${b.target}`);
	return [
		new Paragraph({
			children: [
				new ImageRun({
					type: img.type,
					data: img.data,
					transformation: imageSize(img, b.width),
					altText: { name: b.alt, description: b.alt, title: b.alt },
				}),
			],
		}),
	];
}

/** Builds the docx Document. */
export function buildDocument(input: DocxInput): Document {
	const children: (Paragraph | Table)[] = [];
	input.notes.forEach((blocks, i) => {
		if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
		for (const b of blocks) children.push(...blockChildren(b, input.images));
	});
	if (children.length === 0) children.push(new Paragraph(''));
	return new Document({
		title: input.title,
		creator: input.creator,
		comments: {
			children: input.comments.map((c) => ({
				id: c.id,
				author: c.author,
				initials: initials(c.author),
				children: [new Paragraph(c.text)],
			})),
		},
		sections: [{ children }],
	});
}

/** DOCX file bytes. Uses Packer.toBlob and Blob.arrayBuffer, so it needs no Buffer. */
export async function toDocxBytes(input: DocxInput): Promise<ArrayBuffer> {
	const blob = await Packer.toBlob(buildDocument(input));
	return blob.arrayBuffer();
}

/** Type and pixel size of a PNG, JPEG, GIF or BMP file from its header, or null. */
export function readImageHeader(bytes: Uint8Array): Omit<ImageData, 'data'> | null {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const n = bytes.length;
	if (n >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'png', width: v.getUint32(16), height: v.getUint32(20) };
	if (n >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { type: 'gif', width: v.getUint16(6, true), height: v.getUint16(8, true) };
	if (n >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) return { type: 'bmp', width: Math.abs(v.getInt32(18, true)), height: Math.abs(v.getInt32(22, true)) };
	if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let i = 2;
		while (i + 9 < n) {
			if (bytes[i] !== 0xff) return null;
			const marker = bytes[i + 1]!;
			const len = v.getUint16(i + 2);
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: 'jpg', width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
			i += 2 + len;
		}
	}
	return null;
}
