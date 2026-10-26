import { cbc } from '@noble/ciphers/aes';
import { md5 } from '@noble/hashes/legacy';

export type RecordClass = 'normal' | 'system' | 'locked' | 'archive' | 'trash' | 'unsupported';
export interface SourceRecord {
	_id?: string | number;
	uuid?: string;
	title?: string;
	note?: string;
	encrypted?: boolean | number;
	active_state?: number;
	space?: number;
	type?: number;
	created_date?: number;
	modified_date?: number;
	color_index?: number;
}
export interface Backup {
	headerCount: number;
	records: SourceRecord[];
}
const MAX_BYTES = 32 * 1024 * 1024;
const MAGIC = [0, 78, 0, 79, 0, 84, 0, 69];

/** The first cipher block in known 7.1 files is an opaque prefix. */
export function parseRecords(bytes: Uint8Array): SourceRecord[] {
	const marker = new TextEncoder().encode('{"_id":');
	let start = -1;
	for (let i = 20; i <= bytes.length - marker.length; i++) {
		if (marker.every((b, n) => bytes[i + n] === b)) { start = i - 4; break; }
	}
	if (start < 0) throw new Error('No version 7.1 record start was found. Check the password.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const records: SourceRecord[] = [];
	let offset = start;
	while (offset < bytes.length) {
		if (bytes.length - offset < 4) throw new Error(`Record ${records.length + 1}: truncated length at byte ${offset}.`);
		const length = view.getUint32(offset, false);
		offset += 4;
		if (!length || length > bytes.length - offset) throw new Error(`Record ${records.length + 1}: length ${length} exceeds the remaining ${bytes.length - offset} bytes or is zero.`);
		let value: unknown;
		try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length))); }
		catch { throw new Error(`Record ${records.length + 1}: invalid UTF-8 or JSON. Check the password.`); }
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Record ${records.length + 1}: JSON must be an object.`);
		records.push(value);
		offset += length;
	}
	return records;
}

/** Browser-only AES and MD5. Validate PKCS7 padding before parsing JSON. */
export function decodeBackup(bytes: Uint8Array, password: string): Backup {
	if (bytes.length > MAX_BYTES) throw new Error('The backup exceeds the 32 MiB input limit.');
	if (bytes.length < 44) throw new Error('The backup is shorter than the header and one cipher block.');
	if (!MAGIC.every((b, n) => bytes[n] === b)) throw new Error('The backup does not have the ColorNote NOTE header.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const major = view.getUint32(8, false), minor = view.getUint32(12, false);
	if (major !== 7 || minor !== 1) throw new Error(`Unsupported header version ${major}.${minor}. Only 7.1 is supported.`);
	if ((bytes.length - 28) % 16 !== 0) throw new Error('The AES-CBC payload length is not a multiple of 16 bytes.');
	const salt = new TextEncoder().encode('ColorNote Fixed Salt'), pass = new TextEncoder().encode(password);
	const concat = (...arrays: Uint8Array[]) => { const bytes = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0)); let at = 0; for (const a of arrays) { bytes.set(a, at); at += a.length; } return bytes; };
	const seed = concat(pass, salt), key = md5(seed), ivSeed = concat(key, pass, salt), iv = md5(ivSeed);
	try {
		const decoded = cbc(key, iv, { disablePadding: true }).decrypt(bytes.subarray(28));
		try {
			const pad = decoded[decoded.length - 1] ?? 0;
			if (pad < 1 || pad > 16 || !decoded.subarray(decoded.length - pad).every((b) => b === pad)) throw new Error('AES-CBC padding is invalid. Check the password.');
			return { headerCount: view.getUint32(24, false), records: parseRecords(decoded.subarray(0, decoded.length - pad)) };
		} finally { decoded.fill(0); }
	} finally { key.fill(0); iv.fill(0); pass.fill(0); seed.fill(0); ivSeed.fill(0); }
}

export function recordClass(r: SourceRecord): RecordClass {
	if (r.title === 'syncable_settings' || r.title === 'name_master_password' || r.type === 256) return 'system';
	if (r.encrypted === true || r.encrypted === 1) return 'locked';
	if (r.encrypted !== undefined && r.encrypted !== false && r.encrypted !== 0) return 'unsupported';
	if (r.active_state === 16) return 'trash';
	if (r.space === 16) return 'archive';
	if (typeof r.uuid !== 'string' || !r.uuid.trim() || typeof r.title !== 'string' || typeof r.note !== 'string' || ![0, 16].includes(r.type ?? -1) || r.active_state !== 0 || r.space !== 0) return 'unsupported';
	if (![r.created_date, r.modified_date].every((d) => typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= 8.64e15)) return 'unsupported';
	if (typeof r.color_index !== 'number' || !Number.isInteger(r.color_index)) return 'unsupported';
	return 'normal';
}

export function checklist(text: string): string {
	return text.replace(/^\[ \]( |$)/gm, '- [ ]$1').replace(/^\[V\]( |$)/gm, '- [x]$1');
}

export function safeName(text: string): string {
	// A leading dot makes a hidden file. Cut by code point so that an emoji stays whole.
	const clean = [...text.normalize('NFC')].map((c) => c.charCodeAt(0) < 32 ? ' ' : c).join('').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
	return [...clean].slice(0, 80).join('').replace(/^[. ]+|[. ]+$/g, '') || 'Untitled';
}

export interface Profile { name: string; folder: string; colors: Record<string, string> }
export function validFolder(folder: string): string {
	const parts = folder.replace(/\\/g, '/').split('/').map((p) => p.trim());
	if (!folder.trim() || parts.some((p) => !p.trim() || p === '.' || p === '..' || p.startsWith('.') || [...p].some((c) => c.charCodeAt(0) < 32) || /[:*?"<>|#^[\]]/.test(p))) throw new Error('Use a relative folder path without empty, hidden or parent segments.');
	return parts.map((p) => p.trim()).join('/');
}
export function colorMap(text: string): Record<string, string> {
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Color mapping must be a JSON object.');
	const result: Record<string, string> = {};
	for (const [key, label] of Object.entries(value)) {
		if (!/^-?\d+$/.test(key) || typeof label !== 'string' || label.length > 80) throw new Error('Color keys must be integers and labels must be text of 80 characters or less.');
		result[key] = label;
	}
	return result;
}
export interface Change { uuid: string; kind: 'added' | 'removed' | 'changed'; before: string; after: string }
export function compareBackups(before: Backup, after: Backup): Change[] {
	const index = (b: Backup) => {
		const map = new Map<string, string>();
		for (const r of b.records) {
			if (recordClass(r) !== 'normal') continue;
			if (map.has(r.uuid!)) throw new Error(`Comparison has a duplicate UUID: ${r.uuid!}`);
			map.set(r.uuid!, r.note!);
		}
		return map;
	};
	const a = index(before), b = index(after), changes: Change[] = [];
	for (const uuid of [...new Set([...a.keys(), ...b.keys()])].sort()) {
		if (a.get(uuid) === b.get(uuid)) continue;
		changes.push({ uuid, kind: !a.has(uuid) ? 'added' : !b.has(uuid) ? 'removed' : 'changed', before: a.get(uuid) ?? '', after: b.get(uuid) ?? '' });
	}
	return changes;
}
