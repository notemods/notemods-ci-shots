import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { MAX_ZIP, readArchive } from '../src/archive';
// @ts-expect-error plain JS fixture builder
import { archive, metaXml, zknXml, zkn3 } from './fixtures/zkn3.mjs';

const file = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const parts = { 'metaInformation.xml': metaXml(), 'zknFile.xml': zknXml([{ content: 'x' }]) };
describe('.zkn3 archive reader', () => {
	it('reads all 75 live notes from the official public sample', () => {
		const a = readArchive(file('zkn3-sample.zkn3'));
		expect(a.version).toBe('3.8');
		expect(a.slots).toBe(75);
		expect(a.notes.map((n) => n.position)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
		expect(a.deleted).toEqual([]);
		expect(a.notes[0]?.keywords).toContain('Zettelkasten /s');
	});
	it('reads the official mixed markup sample', () => {
		const a = readArchive(file('zkn3-tricky.zkn3'));
		expect(a.notes).toHaveLength(1);
		expect(a.notes[0]?.content).toContain('[h1]Headline[/h1]');
		expect(a.notes[0]?.content).toContain('> Zitat');
	});
	it('reads the local deleted-slot fixture without merging exact keywords', () => {
		const a = readArchive(file('zkn3-deleted-slot.zkn3'));
		expect(a.notes.map((n) => n.position)).toEqual([1, 3]);
		expect(a.deleted).toEqual([2]);
		expect(a.notes[0]?.keywords).toEqual(['two words']);
		expect(a.notes[1]?.keywords).toEqual(['two-words']);
	});
	it('reads the 75 note fixture', () => {
		const a = readArchive(file('sample-75.zkn3'));
		expect(a.version).toBe('3.8');
		expect(a.notes).toHaveLength(75);
		expect(a.deleted).toEqual([]);
	});
	it('keeps one-based positions after a deleted slot', () => {
		const a = readArchive(file('deleted-slot.zkn3'));
		expect(a.notes.map((n) => n.position)).toEqual([1, 3]);
		expect(a.deleted).toEqual([2]);
		expect(a.notes[0]).toMatchObject({ crossRefs: [3], sequence: [3], keywords: ['two words', 'two-words'] });
	});
	it('rejects random bytes', () => { expect(() => readArchive(new Uint8Array([1, 2, 3]))).toThrow('Cannot read'); });
	it('rejects parent steps, absolute paths and backslashes before expansion', () => {
		for (const name of ['../a.xml', '/a.xml', 'x/../../a.xml', 'x\\a.xml', 'C:/a.xml']) expect(() => readArchive(zkn3({ ...parts, [name]: 'x' }))).toThrow('unsafe path');
	});
	it('rejects duplicate member names', () => {
		const bytes = zkn3({ ...parts, 'zknfile.xml': 'x' });
		expect(() => readArchive(bytes)).toThrow('duplicate');
	});
	it('rejects encrypted ZIP flags', () => {
		const bytes = file('tricky.zkn3'); const v = new DataView(bytes.buffer);
		for (let i = 0; i < bytes.length - 46; i++) if (v.getUint32(i, true) === 0x02014b50) { v.setUint16(i + 8, v.getUint16(i + 8, true) | 1, true); break; }
		expect(() => readArchive(bytes)).toThrow('Encrypted');
	});
	it('rejects a checksum mismatch', () => {
		const bytes = file('tricky.zkn3'); const v = new DataView(bytes.buffer);
		for (let i = 0; i < bytes.length - 46; i++) if (v.getUint32(i, true) === 0x02014b50) { v.setUint32(i + 16, 0, true); break; }
		expect(() => readArchive(bytes)).toThrow('checksum');
	});
	it('rejects input over 20 MiB before it reads the ZIP', () => {
		expect(() => readArchive(new Uint8Array(MAX_ZIP + 1))).toThrow('20 MiB');
	});
	it('rejects more than 100 MiB of expanded data from the directory sizes', () => {
		const big = new Uint8Array(51 * 1024 * 1024);
		expect(() => readArchive(zkn3({ ...parts, 'a.bin': big, 'b.bin': big }))).toThrow('100 MiB');
	});
	it('rejects version 9.0, malformed XML and a DOCTYPE', () => {
		expect(() => readArchive(archive([{ content: 'x' }], [], '9.0'))).toThrow('version 9.0');
		expect(() => readArchive(zkn3({ 'metaInformation.xml': metaXml(), 'zknFile.xml': '<zettelkasten><zettel>' }))).toThrow('not valid XML');
		expect(() => readArchive(zkn3({ 'metaInformation.xml': metaXml(), 'zknFile.xml': '<!DOCTYPE x><zettelkasten/>' }))).toThrow('document type');
	});
	it('rejects a missing metaInformation.xml', () => {
		expect(() => readArchive(zkn3({ 'zknFile.xml': strToU8(zknXml([{ content: 'x' }])) }))).toThrow('metaInformation.xml');
	});
	it('reports attachments and authors that it does not import', () => {
		const a = readArchive(archive([{ content: 'x', links: ['file.pdf'], author: '1' }]));
		expect(a.warnings).toEqual(['Note 1: 1 attachment links are not imported.', 'Note 1: authors are not imported.']);
	});
});
