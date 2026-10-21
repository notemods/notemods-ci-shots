import { createCipheriv, createHash } from 'node:crypto';
import type { SourceRecord } from '../src/backup';
export const normal: SourceRecord = { _id: 1, uuid: 'demo-001', title: 'Travel plan', note: 'Train at 09:30.\nMeet at the station.', type: 0, active_state: 0, space: 0, created_date: 1728864000000, modified_date: 1728950400000, color_index: 0 };
export function stream(records: unknown[], prefix = Buffer.alloc(16, 42)): Buffer {
	return Buffer.concat([prefix, ...records.flatMap((r) => { const text = Buffer.from(typeof r === 'string' ? r : JSON.stringify(r)); const size = Buffer.alloc(4); size.writeUInt32BE(text.length); return [size, text]; })]);
}
export function encryptPlain(plain: Uint8Array, password = '1234', count = 7): Uint8Array {
	const pass = Buffer.from(password), salt = Buffer.from('ColorNote Fixed Salt');
	const key = createHash('md5').update(Buffer.concat([pass, salt])).digest();
	const iv = createHash('md5').update(Buffer.concat([key, pass, salt])).digest();
	const cipher = createCipheriv('aes-128-cbc', key, iv);
	const header = Buffer.alloc(28); Buffer.from('004e004f00540045', 'hex').copy(header); header.writeUInt32BE(7, 8); header.writeUInt32BE(1, 12); header.writeUInt32BE(count, 24);
	return new Uint8Array(Buffer.concat([header, cipher.update(plain), cipher.final()]));
}
export function fixture(records: unknown[] = [normal], password = '1234', count = 7): Uint8Array { return encryptPlain(stream(records), password, count); }
