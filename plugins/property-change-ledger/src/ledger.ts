export type Value = { missing: true } | { value: unknown };
export interface Change { time: string; path: string; key: string; old: Value; new: Value }
export interface Watch { folder: string; keys: string[]; ledger: string }
export function keyList(text: string): string[] { return [...new Set(text.split(/[,\n]/).map(k => k.trim()).filter(Boolean))]; }
/** The path after a rename of oldPath to newPath, or null when the rename does not touch it. */
export function movedPath(path: string, oldPath: string, newPath: string): string | null {
	return path === oldPath || path.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length) : null;
}
export function selected(path: string, watch: Watch): boolean {
	return path.endsWith('.md') && path !== watch.ledger && (!watch.folder || path.startsWith(watch.folder + '/'));
}
function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
	return value;
}
export function snapshot(props: Record<string, unknown>, keys: string[]): Map<string, Value> {
	return new Map(keys.map(key => [key, Object.prototype.hasOwnProperty.call(props, key) && props[key] !== undefined ? { value: stable(props[key]) } : { missing: true }]));
}
export class Observer {
	readonly baseline = new Map<string, Map<string, Value>>();
	constructor(public watch: Watch) {}
	observe(path: string, props: Record<string, unknown>, time: string): Change[] {
		if (!selected(path, this.watch)) return [];
		const next = snapshot(props, this.watch.keys);
		const prev = this.baseline.get(path);
		this.baseline.set(path, next);
		if (!prev) return [];
		return this.watch.keys.filter(key => JSON.stringify(prev.get(key)) !== JSON.stringify(next.get(key))).map(key => ({ time, path, key, old: prev.get(key)!, new: next.get(key)! }));
	}
	rename(oldPath: string, newPath: string): void {
		for (const [path, values] of [...this.baseline]) {
			if (path === oldPath || path.startsWith(oldPath + '/')) {
				this.baseline.delete(path);
				const dest = newPath + path.slice(oldPath.length);
				if (selected(dest, this.watch)) this.baseline.set(dest, values);
			}
		}
	}
	/** A note that moves into the selection keeps its cached values as the baseline. */
	seed(path: string, props: Record<string, unknown>): void {
		if (selected(path, this.watch) && !this.baseline.has(path)) this.baseline.set(path, snapshot(props, this.watch.keys));
	}
	delete(path: string): void {
		for (const key of this.baseline.keys()) if (key === path || key.startsWith(path + '/')) this.baseline.delete(key);
	}
}
export const HEADER = '# Property change ledger\n\nObserved on this device. Times are UTC. Initial values are not changes.\nA missing property is {"missing":true}; a present property is {"value":...}.\n\n';
export function recordBlock(records: Change[]): string { return records.map(r => '```json\n' + JSON.stringify(r) + '\n```\n\n').join(''); }
function isValue(v: unknown): v is Value { return !!v && typeof v === 'object' && (('missing' in v && v.missing === true) || 'value' in v); }
export function readRecords(text: string): Change[] {
	const records: Change[] = [];
	for (const match of text.matchAll(/```json\n([^\n]+)\n```/g)) {
		try {
			const r = JSON.parse(match[1]!) as Partial<Change>;
			if (typeof r.time === 'string' && typeof r.path === 'string' && typeof r.key === 'string' && isValue(r.old) && isValue(r.new)) records.push(r as Change);
		} catch { /* A damaged or unrelated block is not a record. */ }
	}
	return records;
}
export function filterRecords(records: Change[], note = '', key = ''): Change[] { return records.filter(r => (!note || r.path.includes(note)) && (!key || r.key === key)); }
export function counts(records: Change[]): [string, number][] {
	const result = new Map<string, number>();
	for (const r of records) if (r.key === 'status') result.set(r.path, (result.get(r.path) ?? 0) + 1);
	return [...result].sort(([a], [b]) => a.localeCompare(b));
}
export function valueText(v: Value): string { return 'missing' in v ? '(missing)' : JSON.stringify(v.value); }
export function csv(records: Change[]): string {
	const cell = (s: string) => '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
	return [['UTC time', 'Note path', 'Key', 'Old value', 'New value'], ...records.map(r => [r.time, r.path, r.key, JSON.stringify(r.old), JSON.stringify(r.new)])].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
/** Keep a failed write at the head until the user retries. */
export class SerialWriter {
	private jobs: (() => Promise<void>)[] = [];
	private running: Promise<void> | null = null;
	error: string | null = null;
	get pending(): number { return this.jobs.length; }
	enqueue(job: () => Promise<void>): Promise<void> { this.jobs.push(job); return this.flush(); }
	flush(): Promise<void> {
		if (this.running) return this.running;
		this.error = null;
		this.running = this.drain().finally(() => {
			this.running = null;
			if (this.jobs.length && !this.error) return this.flush();
			return undefined;
		});
		return this.running;
	}
	private async drain(): Promise<void> {
		while (this.jobs.length) {
			try { await this.jobs[0]!(); this.jobs.shift(); }
			catch (e) { this.error = e instanceof Error ? e.message : String(e); break; }
		}
	}
}
export interface ScenarioEvent { path: string; props?: Record<string, unknown>; rename?: string; delete?: boolean; restart?: boolean }
/** Golden vectors use the same observer as the live plugin. */
export function runScenario(events: ScenarioEvent[], watch: Watch = { folder: 'Notes', keys: ['status', 'due', 'tags'], ledger: 'History.md' }): Change[] {
	let observer = new Observer(watch);
	const result: Change[] = [];
	for (const event of events) {
		if (event.restart) observer = new Observer(watch);
		if (event.rename) { observer.rename(event.path, event.rename); if (event.props) observer.seed(event.rename, event.props); }
		else if (event.delete) observer.delete(event.path);
		else result.push(...observer.observe(event.path, event.props ?? {}, '2026-10-13T09:00:00.000Z'));
	}
	return result;
}
