import { expect, it } from 'vitest';
import Papa from '../src/vendor/papaparse.cjs';
it('blocks Papa network and Node stream inputs in the shipped copy', () => {
 expect(() => Papa.parse('https://example.invalid/data.csv', { download: true })).toThrow('Network CSV input is disabled');
 expect(() => Papa.parse(Papa.NODE_STREAM_INPUT)).toThrow('Node stream input is disabled');
});
