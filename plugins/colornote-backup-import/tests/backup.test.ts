import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareBackups, decodeBackup, parseRecords, validFolder, colorMap, safeName } from '../src/backup';
import { encryptPlain, fixture, normal, stream } from './fixture';

describe('validation before writes', () => {
	it('rejects a bad magic header', () => { const b = fixture(); b[0] = 1; expect(() => decodeBackup(b, '1234')).toThrow('NOTE header'); });
	it('rejects a short header', () => expect(() => decodeBackup(new Uint8Array(3), '')).toThrow('shorter'));
	it('rejects a partial cipher block', () => expect(() => decodeBackup(fixture().subarray(0, 45), '1234')).toThrow('multiple of 16'));
	it('rejects a later invalid JSON record without a partial result', () => expect(() => decodeBackup(fixture([normal, '{bad']), '1234')).toThrow('Record 2: invalid UTF-8 or JSON'));
	it('rejects a later JSON array', () => expect(() => decodeBackup(fixture([normal, []]), '1234')).toThrow('JSON must be an object'));
	it('rejects a truncated trailing length', () => expect(() => decodeBackup(encryptPlain(Buffer.concat([stream([normal]), Buffer.from([0, 1])])), '1234')).toThrow('truncated length'));
	it('rejects a zero record length', () => expect(() => decodeBackup(encryptPlain(Buffer.concat([stream([normal]), Buffer.alloc(4)])), '1234')).toThrow('or is zero'));
	it('rejects a stream without the record marker', () => expect(() => parseRecords(new Uint8Array(32))).toThrow('record start'));
	it('supports the opaque newer prefix before the first record', () => {
		const prefix = Buffer.concat([Buffer.alloc(16, 5), Buffer.from('"account":123,"other":[]}'), Buffer.alloc(8)]);
		expect(decodeBackup(encryptPlain(stream([normal], prefix)), '1234').records).toEqual([normal]);
	});
	it('supports Unicode passwords with browser cipher code', () => expect(decodeBackup(fixture([normal], '秘密'), '秘密').records).toEqual([normal]));
	it('preserves empty note text', () => expect(decodeBackup(fixture([{ ...normal, note: '' }]), '1234').records[0]?.note).toBe(''));
	it('rejects a large file before decryption', () => expect(() => decodeBackup(new Uint8Array(32 * 1024 * 1024 + 1), '')).toThrow('32 MiB'));
});

describe('compare normal notes', () => {
	it('shows added, removed and changed text in UUID order', () => {
		const before = { headerCount: 2, records: [normal, { ...normal, uuid: 'b', note: 'Old' }] };
		const after = { headerCount: 2, records: [{ ...normal, note: 'New' }, { ...normal, uuid: 'c', note: 'Added' }] };
		expect(compareBackups(before, after)).toEqual([{ uuid: 'b', kind: 'removed', before: 'Old', after: '' }, { uuid: 'c', kind: 'added', before: '', after: 'Added' }, { uuid: normal.uuid, kind: 'changed', before: normal.note, after: 'New' }]);
	});
	it('does not compare title-only changes or locked bodies', () => expect(compareBackups({ headerCount: 1, records: [normal] }, { headerCount: 2, records: [{ ...normal, title: 'Different' }, { ...normal, uuid: 'locked', encrypted: true }] })).toEqual([]));
	it('rejects duplicate UUIDs rather than discard a note', () => expect(() => compareBackups({ headerCount: 2, records: [normal, normal] }, { headerCount: 0, records: [] })).toThrow('duplicate UUID'));
});

describe('note filenames', () => {
	it('does not make a hidden note from a title with a leading dot', () => expect(safeName('.net notes')).toBe('net notes'));
	it('does not split an emoji at the length limit', () => expect(safeName(`${'a'.repeat(79)}😀b`)).toBe(`${'a'.repeat(79)}😀`));
});

describe('profile validation', () => {
	for (const value of ['', '/root', 'a//b', 'a/../b', '.obsidian', 'a/.hidden', 'a:b']) it(`rejects folder ${value}`, () => expect(() => validFolder(value)).toThrow());
	it('accepts nested folders', () => expect(validFolder('Trips/Notes')).toBe('Trips/Notes'));
	it('checks color keys and labels', () => { expect(colorMap('{"0":"Yellow"}')).toEqual({ '0': 'Yellow' }); for (const s of ['[]', 'null', '{"red":"Blue"}', '{"0":4}']) expect(() => colorMap(s)).toThrow(); });
});

// Named source files remain outside the export. Synthetic fixtures run in both layouts.
// Set COLORNOTE_SAMPLES to the folder of the named backups to run these checks.
const sampleDir = process.env.COLORNOTE_SAMPLES ?? '';
for (const [name, password, records, headerCount] of [['20241014', '1234', 9, 7], ['20260615', '0000', 20, 15], ['20260725', '0000', 49, 37]] as const) {
	const path = `${sampleDir}/colornote-${name}.backup`;
	it.skipIf(!sampleDir || !existsSync(path))(`known backup ${name}`, () => { const result = decodeBackup(new Uint8Array(readFileSync(path)), password); expect(result.records).toHaveLength(records); expect(result.headerCount).toBe(headerCount); });
}
