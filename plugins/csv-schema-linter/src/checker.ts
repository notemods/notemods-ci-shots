import Papa from './vendor/papaparse.cjs';

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ERRORS = 500;
export interface Rule {
 required?: boolean;
 type?: 'string' | 'number' | 'boolean';
 enum?: string[];
 unique?: boolean;
 trim?: boolean;
 default?: string;
}
export interface Schema { columns: Record<string, Rule> }
export interface Issue { row: number; column: string; rule: string; value: string }
export interface Result { headers: string[]; rows: string[][]; errors: Issue[]; total: number }
export interface Fix { row: number; column: string; before: string; after: string }
export interface Preview { csv: string; changes: Fix[]; total: number; result: Result }

function object(value: unknown): value is Record<string, unknown> {
 return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function checkSize(text: string, label: string): void {
 if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error(`${label} exceeds the 5 MiB limit.`);
}
export function parseSchema(text: string): Schema {
 checkSize(text, 'Rule file');
 let raw: unknown;
 try { raw = JSON.parse(text) as unknown; } catch { throw new Error('Rule file is not valid JSON.'); }
 if (!object(raw) || !object(raw.columns) || Object.keys(raw).some(k => k !== 'columns')) throw new Error('Rule file must contain a columns object.');
 const columns: Record<string, Rule> = Object.create(null) as Record<string, Rule>;
 for (const [name, value] of Object.entries(raw.columns)) {
  if (!name || !object(value)) throw new Error('Each column must have a name and a rule object.');
  for (const [key, item] of Object.entries(value)) {
   if (!['required', 'type', 'enum', 'unique', 'trim', 'default'].includes(key)) throw new Error(`Unknown rule ${key} for ${name}.`);
   if (['required', 'unique', 'trim'].includes(key) && typeof item !== 'boolean') throw new Error(`${key} for ${name} must be boolean.`);
   if (key === 'type' && (typeof item !== 'string' || !['string', 'number', 'boolean'].includes(item))) throw new Error(`Invalid type for ${name}.`);
   if (key === 'enum' && (!Array.isArray(item) || !item.every(v => typeof v === 'string'))) throw new Error(`enum for ${name} must be a list of strings.`);
   if (key === 'default' && typeof item !== 'string') throw new Error(`default for ${name} must be a string.`);
  }
  columns[name] = value;
 }
 return { columns };
}
function records(csv: string): string[][] {
 checkSize(csv, 'CSV file');
 const parsed = Papa.parse<string[]>(csv, { delimiter: ',', dynamicTyping: false, skipEmptyLines: false });
 if (parsed.errors.length) throw new Error(`CSV parse error: ${parsed.errors[0]?.message ?? 'Invalid record'}.`);
 const data = parsed.data;
 if (/(?:\r\n|\n|\r)$/.test(csv) && data.length > 1 && data[data.length - 1]?.join('') === '') data.pop();
 if (!data.length || data[0]?.some(h => !h)) throw new Error('CSV headers must have names.');
 const headers = data[0] ?? [];
 if (new Set(headers).size !== headers.length) throw new Error('CSV has duplicate headers.');
 return data;
}
export function check(csv: string, schemaText: string): Result {
 checkSize(csv, 'CSV file');
 const schema = parseSchema(schemaText);
 const [headers = [], ...rows] = records(csv);
 const result: Result = { headers, rows, errors: [], total: 0 };
 const add = (row: number, column: string, rule: string, value: string) => {
  result.total++;
  if (result.errors.length < MAX_ERRORS) result.errors.push({ row, column, rule, value });
 };
 for (let i = 0; i < rows.length; i++) {
  const row = rows[i] ?? [];
  if (row.length !== headers.length) add(i + 2, '(record)', 'field count', String(row.length));
 }
 for (const [name, rule] of Object.entries(schema.columns)) {
  const column = headers.indexOf(name);
  if (column < 0) { add(1, name, 'missing column', ''); continue; }
  const seen = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
   const value = rows[i]?.[column] ?? '';
   if (value === '') { if (rule.required) add(i + 2, name, 'required', value); continue; }
   if (rule.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) add(i + 2, name, 'type number', value);
   if (rule.type === 'boolean' && value !== 'true' && value !== 'false') add(i + 2, name, 'type boolean', value);
   if (rule.enum && !rule.enum.includes(value)) add(i + 2, name, 'allowed value', value);
   if (rule.unique) { const matches = seen.get(value) ?? []; matches.push(i + 2); seen.set(value, matches); }
  }
  if (rule.unique) for (const [value, matches] of seen) if (matches.length > 1) for (const row of matches) add(row, name, 'unique', value);
 }
 result.errors.sort((a, b) => a.row - b.row || a.column.localeCompare(b.column));
 return result;
}
export function previewFixes(csv: string, schemaText: string): Preview {
 const result = check(csv, schemaText);
 if (result.errors.some(e => ['missing column', 'field count'].includes(e.rule))) throw new Error('Fix the CSV structure before a fix preview.');
 const schema = parseSchema(schemaText);
 const rows = result.rows.map(row => [...row]);
 const changes: Fix[] = [];
 let total = 0;
 result.headers.forEach((column, index) => {
  const rule = schema.columns[column];
  if (!rule) return;
  rows.forEach((row, i) => {
   const before = row[index] ?? '';
   let after = rule.trim ? before.trim() : before;
   if (after === '' && rule.default !== undefined) after = rule.default;
   if (before !== after) { total++; if (changes.length < MAX_ERRORS) changes.push({ row: i + 2, column, before, after }); row[index] = after; }
  });
 });
 const newline = Papa.parse<string[]>(csv, { delimiter: ',', preview: 1 }).meta.linebreak || '\n';
 const fixed = (csv.startsWith('\uFEFF') ? '\uFEFF' : '') + Papa.unparse([result.headers, ...rows], { delimiter: ',', quotes: true, newline });
 checkSize(fixed, 'New CSV file');
 return { csv: fixed, changes, total, result: check(fixed, schemaText) };
}
export function count(n: number, word: string): string {
 return `${n} ${word}${n === 1 ? '' : 's'}`;
}
function escapeCell(text: string): string {
 return text.replace(/[\r\n]/g, ' ').replace(/([\\`*_[\]])/g, '\\$1').replace(/[&<>|#$%=~^]/g, c => `&#${c.charCodeAt(0)};`);
}
export function markdownReport(path: string, result: Result): string {
 return `# CSV rule report\n\nSource: ${escapeCell(path)}\n\n${count(result.rows.length, 'data record')}. ${count(result.total, 'error')}. ${count(result.errors.length, 'error')} shown.\n\n| Logical row | Column | Failed rule | Value |\n| --- | --- | --- | --- |\n` + result.errors.map(e => `| ${e.row} | ${escapeCell(e.column)} | ${escapeCell(e.rule)} | ${escapeCell(e.value)} |`).join('\n') + '\n';
}
