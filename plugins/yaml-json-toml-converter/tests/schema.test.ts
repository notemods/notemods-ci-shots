import { describe, expect, it } from 'vitest';
import { validateSchema } from '../src/schema';
import type { Data } from '../src/convert';

describe('local Draft-07 validation', () => {
	for (const [name, schema, valid, invalid] of [
		['numeric bounds', { type: 'number', minimum: 1, maximum: 3 }, 2, 4],
		['required property', { type: 'object', required: ['name'] }, { name: 'Ada' }, {}],
		['additional property', { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false }, { name: 'Ada' }, { name: 'Ada', extra: 1 }],
		['unique array', { type: 'array', uniqueItems: true }, [1, 2], [1, 1]],
		['array item type', { type: 'array', items: { type: 'boolean' } }, [true, false], [true, 'false']],
		['array contains', { type: 'array', contains: { const: 'Ada' } }, ['Ada', 'Bea'], ['Bea']],
		['string pattern', { type: 'string', pattern: '^A', minLength: 3 }, 'Ada', 'Bea'],
		['enumeration', { enum: ['Ada', 'Bea'] }, 'Ada', 'Cora'],
		['conditional requirement', { if: { properties: { type: { const: 'person' } } }, then: { required: ['name'] } }, { type: 'person', name: 'Ada' }, { type: 'person' }],
		['alternative schema', { oneOf: [{ type: 'string' }, { type: 'number' }] }, 'Ada', true],
	] as [string, Data, Data, Data][]) it(name, () => { expect(validateSchema(valid, JSON.stringify(schema))).toEqual([]); expect(validateSchema(invalid, JSON.stringify(schema)).length).toBeGreaterThan(0); });
	it('supports Boolean schemas', () => { expect(validateSchema({}, 'true')).toEqual([]); expect(validateSchema({}, 'false')).not.toEqual([]); });
	it('skips format without a remote lookup', () => expect(validateSchema('plain text', '{"type":"string","format":"email"}')).toEqual([]));
	it('rejects a newer validation keyword', () => expect(() => validateSchema({}, '{"unevaluatedProperties":false}')).toThrow('Unsupported attribute'));
	it('rejects an unresolved local reference', () => expect(() => validateSchema({}, '{"$ref":"#/definitions/missing"}')).toThrow());
	it('uses JSON Pointer escaping in data paths', () => expect(validateSchema({ 'a/b~c': 3 }, '{"type":"object","properties":{"a/b~c":{"type":"string"}}}')[0]).toContain('/a~1b~0c:'));
});
