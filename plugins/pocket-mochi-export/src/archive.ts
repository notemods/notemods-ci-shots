import { strToU8, zipSync, type Zippable } from 'fflate';

/** A fixed time for each ZIP entry, so the same input gives the same bytes. */
const FIXED_MTIME = new Date(Date.UTC(2020, 0, 1));

/** The .mochi file: a ZIP with data.edn and each image at the root. Images are stored, text is compressed. */
export function buildArchive(edn: string, media: { name: string; data: Uint8Array }[]): Uint8Array {
	const files: Zippable = { 'data.edn': [strToU8(edn), { level: 6, mtime: FIXED_MTIME }] };
	for (const m of media) files[m.name] = [m.data, { level: 0, mtime: FIXED_MTIME }];
	return zipSync(files);
}
