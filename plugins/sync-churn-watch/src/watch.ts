/** Counts local file observations. A poll sees at most one write per path. */
export type Group = 'settings' | 'vault';
export interface Row { path: string; name: string; group: Group; writes: number; bytes: number }
export interface Session { started: number; stopped: number | null; rows: Row[]; days: Record<string, number> }
export interface FileStat { type: 'file' | 'folder'; mtime: number; size: number }
export interface WatchAdapter {
	list(path: string): Promise<{ folders: string[]; files: string[] }>;
	stat(path: string): Promise<FileStat | null>;
	read(path: string): Promise<string>;
}
export const POLL_MS = 10_000;
export const CORE_FILES = ['workspace.json', 'workspace-mobile.json', 'app.json', 'appearance.json'];

export function rate(row: Row, session: Session, now: number): number {
	return Math.round(row.writes * 3_600_000 / Math.max(1000, (session.stopped ?? now) - session.started) * 10) / 10;
}
export function sortedRows(rows: Row[]): Row[] {
	return [...rows].sort((a, b) => b.writes - a.writes || a.path.localeCompare(b.path));
}
export function markdown(session: Session | null, now: number): string {
	const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
	return ['Counts for settings files are at least the observed writes. Bytes are estimates.', '', '| File | Writes | Writes/h | Est. bytes |', '| --- | ---: | ---: | ---: |',
		...(session ? sortedRows(session.rows).map((r) => `| ${escape(r.path)} | ${r.writes} | ${rate(r, session, now)} | ${r.bytes} |`) : [])].join('\n');
}
export function exclusionFolders(session: Session | null): string[] {
	return [...new Set(sortedRows(session?.rows ?? []).filter((r) => r.writes > 0).slice(0, 5)
		.map((r) => r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '').filter(Boolean))];
}
export function dailyHistory(history: Session[]): [string, number][] {
	const days = new Map<string, number>();
	for (const s of history) for (const [day, count] of Object.entries(s.days)) days.set(day, (days.get(day) ?? 0) + count);
	return [...days].sort(([a], [b]) => a.localeCompare(b));
}
function localDay(now: number): string {
	const d = new Date(now);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Watch {
	session: Session | null = null;
	active = false;
	starting = false;
	unreadable = 0;
	private generation = 0;
	private pending: Promise<void> | null = null;
	private mtimes = new Map<string, number | null>();
	private names = new Map<string, string>();
	constructor(private adapter: WatchAdapter, readonly configDir: string, readonly ownDir: string,
		private changed: () => void = () => {}, private wrote: (row: Row, now: number) => void = () => {}, private clock = () => Date.now()) {}

	async start(): Promise<void> {
		if (this.active || this.starting) return;
		this.starting = true;
		const generation = ++this.generation;
		await this.pending;
		if (generation !== this.generation) return;
		this.mtimes.clear(); this.names.clear(); this.unreadable = 0;
		this.session = { started: this.clock(), stopped: null, rows: [], days: {} };
		this.active = true;
		try { await this.poll(); } finally { this.starting = false; this.changed(); }
	}
	stop(): Session | null {
		if (!this.active && !this.starting) return null;
		// A start that waits for an old scan has no new session yet. Cancel it and keep the stopped session.
		if (!this.active) { this.dispose(); this.changed(); return null; }
		this.active = false; this.starting = false; this.generation++;
		if (this.session) this.session.stopped = this.clock();
		this.changed();
		return this.session;
	}
	/** Cancels pending observations. Unload does not write an unfinished session. */
	dispose(): void { this.active = false; this.starting = false; this.generation++; }
	observe(path: string, name: string, group: Group, bytes: number, now = this.clock()): void {
		if (!this.active || !this.session || path === `${this.ownDir}/data.json`) return;
		let row = this.session.rows.find((r) => r.path === path);
		if (!row) { row = { path, name, group, writes: 0, bytes: 0 }; this.session.rows.push(row); }
		row.writes++; row.bytes += Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
		const day = localDay(now); this.session.days[day] = (this.session.days[day] ?? 0) + 1;
		this.wrote(row, now); this.changed();
	}
	poll(): Promise<void> {
		if (!this.active) return Promise.resolve();
		if (this.pending) return this.pending;
		const generation = this.generation;
		this.pending = this.scan(generation).finally(() => { this.pending = null; });
		return this.pending;
	}
	private async scan(generation: number): Promise<void> {
		const current = () => this.active && generation === this.generation;
		const paths = CORE_FILES.map((f) => `${this.configDir}/${f}`);
		let unreadable = 0;
		try {
			const { folders } = await this.adapter.list(`${this.configDir}/plugins`);
			if (!current()) return;
			for (const dir of folders) if (dir !== this.ownDir) paths.push(`${dir}/data.json`);
		} catch { /* A vault can have no community plugin folder. */ }
		for (const path of paths) {
			if (!current()) return;
			let stat: FileStat | null;
			try { stat = await this.adapter.stat(path); } catch { unreadable++; continue; }
			if (!current()) return;
			if (stat?.type === 'folder') continue;
			const seen = this.mtimes.has(path);
			const before = this.mtimes.get(path);
			this.mtimes.set(path, stat?.mtime ?? null);
			if (!stat) continue;
			let name = this.names.get(path);
			if (!name) {
				name = path.endsWith('/data.json') ? path.split('/').slice(-2, -1)[0]! : path.slice(path.lastIndexOf('/') + 1);
				if (path.endsWith('/data.json')) {
					try {
						const manifest: unknown = JSON.parse(await this.adapter.read(`${path.slice(0, -9)}manifest.json`));
						if (manifest && typeof manifest === 'object' && 'name' in manifest && typeof manifest.name === 'string' && manifest.name.trim()) name = manifest.name;
					} catch { /* A missing or invalid manifest uses the folder name. */ }
				}
				if (!current()) return;
				this.names.set(path, name);
			}
			if (!this.session?.rows.some((r) => r.path === path)) this.session?.rows.push({ path, name, group: 'settings', writes: 0, bytes: 0 });
			if (seen && stat.mtime !== before) this.observe(path, name, 'settings', stat.size);
		}
		if (current()) { this.unreadable = unreadable; this.changed(); }
	}
}
