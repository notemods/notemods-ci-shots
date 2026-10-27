import { describe, expect, it } from 'vitest';
import { convertMarkup, normalizeRules, validateRules } from '../src/model';

describe('review fixes', () => {
	it('bold and italic markup with spaces inside the tags still renders as emphasis', () => {
		expect(convertMarkup('A[f] bold [/f]b and [k]it [/k]c', new Map()).text).toBe('A **bold** b and *it* c');
		expect(convertMarkup('x[f] [/f]y', new Map()).text).toBe('x y');
	});
	it('rejects a keyword property that differs from a reserved property only in case', () => {
		for (const name of ['Tags', 'TITLE', 'Zkn3_position']) {
			expect(() => validateRules({ fileName: 'number', keywordProperty: name, keywordTags: true })).toThrow();
			expect(normalizeRules({ fileName: 'number', keywordProperty: name }).keywordProperty).toBe('keywords');
		}
	});
});

describe('second review fixes', () => {
	it('rejects a ZIP comment that holds a second end record, so the directory check and the ZIP reader read the same directory', async () => {
		const { readArchive } = await import('../src/archive');
		// @ts-expect-error plain JS fixture builder
		const { archive } = await import('./fixtures/zkn3.mjs');
		const zip: Uint8Array = archive([{ content: 'x' }]);
		const bytes = new Uint8Array(zip.length + 22);
		bytes.set(zip);
		const v = new DataView(bytes.buffer);
		v.setUint16(zip.length - 2, 22, true);
		v.setUint32(zip.length, 0x06054b50, true);
		v.setUint16(zip.length + 20, 99, true);
		expect(() => readArchive(bytes)).toThrow('central directory');
	});
});
