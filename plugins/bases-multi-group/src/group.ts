export type Atom = string | number | boolean | null;
export type Cell = Atom | Atom[];
export interface Row { id: string; values: Record<string, Cell> }
export interface GroupOptions { properties: string[]; splitLists: boolean; pro: boolean; summaryProperty?: string; summaryMode?: 'sum' | 'average' }
export interface Group { key: string; label: string; property: string; count: number; summary: number | null; rows: string[]; children: Group[] }

/** Empty values share a bucket; zero and false remain real values. */
function atom(value: Atom | undefined): Atom {
	return value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;
}
function choices(value: Cell | undefined, split: boolean): { key: string; label: string }[] {
	const values: (Atom | Atom[])[] = Array.isArray(value) ? (value.length === 0 ? [null] : split ? value : [value]) : [atom(value)];
	const out = new Map<string, string>();
	for (const v of values) {
		const normalized = Array.isArray(v) ? v.map(atom) : atom(v);
		const key = JSON.stringify(normalized);
		const label = Array.isArray(normalized) ? `[${normalized.map((x) => x === null ? '(no value)' : String(x)).join(', ')}]` : normalized === null ? '(no value)' : String(normalized);
		out.set(key, label);
	}
	return [...out].map(([key, label]) => ({ key, label }));
}
export function effectiveProperties(properties: string[], pro: boolean): string[] {
	return [...new Set(properties.map((p) => p.trim()).filter(Boolean))].slice(0, pro ? 3 : 2);
}
export function summarize(rows: Row[], property: string | undefined, mode: 'sum' | 'average' = 'sum'): number | null {
	if (!property) return null;
	const values = rows.map((r) => r.values[property]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (!values.length) return null;
	const sum = values.reduce((a, b) => a + b, 0);
	return mode === 'average' ? sum / values.length : sum;
}
/** Original row order is retained inside leaves. Counts and summaries count each note once per group. */
export function buildGroups(input: Row[], options: GroupOptions): Group[] {
	const rows = [...new Map(input.map((r) => [r.id, r])).values()];
	const properties = effectiveProperties(options.properties, options.pro);
	function build(current: Row[], depth: number, path: string[][]): Group[] {
		const property = properties[depth];
		if (!property) return [];
		const buckets = new Map<string, { label: string; rows: Row[] }>();
		for (const row of current) for (const choice of choices(row.values[property], options.splitLists)) {
			let bucket = buckets.get(choice.key);
			if (!bucket) { bucket = { label: choice.label, rows: [] }; buckets.set(choice.key, bucket); }
			bucket.rows.push(row);
		}
		return [...buckets].map(([value, bucket]) => {
			const next = [...path, [property, value]];
			return { key: JSON.stringify(next), label: bucket.label, property, count: bucket.rows.length,
				summary: options.pro ? summarize(bucket.rows, options.summaryProperty, options.summaryMode) : null,
				rows: bucket.rows.map((r) => r.id), children: build(bucket.rows, depth + 1, next) };
		}).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }) || a.key.localeCompare(b.key));
	}
	return build(rows, 0, []);
}
