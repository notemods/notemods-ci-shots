import { strFromU8, unzipSync } from 'fflate';

export const MAX_ZIP = 64 * 1024 * 1024;
export const MAX_EXPANDED = 192 * 1024 * 1024;
export function safeArchivePath(path: string): boolean {
	return !!path && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && !Array.from(path).some(c => c.charCodeAt(0) < 32) && path.replace(/\/$/, '').split('/').every(p => !!p && p !== '.' && p !== '..');
}
/** Read file members in memory. Reject links and extensions before the card can be written. */
export function readTar(bytes: Uint8Array): Record<string, Uint8Array> {
	const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
	let offset = 0;
	let ended = false;
	const text = (a: Uint8Array) => strFromU8(a).replace(/\0.*$/s, '');
	while (offset + 512 <= bytes.length) {
		const h = bytes.subarray(offset, offset + 512);
		if (h.every(b => b === 0)) { ended = true; break; }
		const octal = (a: Uint8Array) => {
			const s = text(a).trim();
			if (!/^[0-7]+$/.test(s)) throw new Error('Invalid TAR number.');
			return parseInt(s, 8);
		};
		const checksum = octal(h.subarray(148, 156));
		let sum = 0;
		for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
		if (sum !== checksum) throw new Error('Invalid TAR checksum.');
		const prefix = text(h.subarray(345, 500));
		const name = (prefix ? `${prefix}/` : '') + text(h.subarray(0, 100));
		if (!safeArchivePath(name)) throw new Error('Unsafe TAR path.');
		const type = h[156];
		if (type !== 0 && type !== 48 && type !== 53) throw new Error('Unsupported TAR member type.');
		const size = octal(h.subarray(124, 136));
		if (size > MAX_EXPANDED || offset + 512 + size > bytes.length) throw new Error('Invalid TAR member size.');
		if (type === 53 && size !== 0) throw new Error('Invalid TAR directory.');
		if (type !== 53) {
			if (files[name]) throw new Error('Duplicate TAR member.');
			files[name] = bytes.subarray(offset + 512, offset + 512 + size);
		}
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	if (!ended) throw new Error('Incomplete TAR archive.');
	return files;
}
export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
	if (bytes.length > MAX_ZIP) throw new Error('ZIP exceeds 64 MiB.');
	let total = 0;
	let count = 0;
	return unzipSync(bytes, { filter: file => {
		if (!safeArchivePath(file.name)) throw new Error('Unsafe ZIP path.');
		total += file.originalSize;
		if (++count > 10000 || total > MAX_EXPANDED) throw new Error('ZIP exceeds the expansion limit.');
		return true;
	} });
}
