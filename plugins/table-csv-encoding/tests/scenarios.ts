import { csvFileStem, encodeTableCsv, markdownCsvTables, TABLE_CSV_LIMIT, type TableCsvOptions } from '../src/core/index';
interface Input { mode: 'parse' | 'csv' | 'stem' | 'limit'; source?: string; rows?: string[][]; options?: TableCsvOptions }
export function runAcceptanceCase(input: Input): unknown {
 try {
  if (input.mode === 'limit') return markdownCsvTables('x'.repeat(TABLE_CSV_LIMIT + 1));
  if (input.mode === 'stem') return csvFileStem(input.source ?? '');
  if (input.mode === 'csv') return encodeTableCsv(input.rows ?? [], input.options ?? { delimiter: ',', bom: true, headers: true });
  return markdownCsvTables(input.source ?? '');
 } catch (error) { return { error: error instanceof Error ? error.message : 'unknown' }; }
}
