import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type SyncChurnWatchPlugin from './main';
import { dailyHistory, rate, sortedRows, type Group, type Row } from './watch';
import { isPro, PRO_LABEL, SYNC_LABEL } from './pro';
export const VIEW_ID = 'sync-churn-watch-view';

export class ChurnView extends ItemView {
	constructor(leaf: WorkspaceLeaf, readonly owner: SyncChurnWatchPlugin) { super(leaf); }
	getViewType(): string { return VIEW_ID; }
	getDisplayText(): string { return this.owner.manifest.name; }
	getIcon(): string { return 'activity'; }
	async onOpen(): Promise<void> { this.render(); await Promise.resolve(); }
	async onClose(): Promise<void> { await Promise.resolve(); }
	render(): void {
		const el = this.contentEl;
		// A poll redraws the view. Keep the scroll position and the expanded history.
		const scroll = el.scrollTop;
		const open = new Set(Array.from(el.querySelectorAll('details[open]'), (d) => d.getAttribute('data-key')));
		el.empty(); el.addClass('sync-churn-watch');
		this.draw(el);
		for (const d of Array.from(el.querySelectorAll('details'))) if (open.has(d.getAttribute('data-key'))) d.open = true;
		el.scrollTop = scroll;
	}
	private draw(el: HTMLElement): void {
		const watch = this.owner.watch;
		el.createEl('h2', { text: this.owner.manifest.name });
		el.createEl('p', { text: watch.active ? 'Watching · settings checked each 10 seconds' : watch.session ? 'Session stopped · results kept' : 'No session', cls: 'sync-churn-state' });
		const controls = el.createDiv({ cls: 'sync-churn-controls' });
		const toggle = controls.createEl('button', { text: watch.active ? 'Stop session' : 'Start session' });
		toggle.addEventListener('click', () => { void (watch.active ? this.owner.stopSession() : this.owner.startSession()); });
		const copy = controls.createEl('button', { text: 'Copy Markdown' });
		copy.addEventListener('click', () => { void this.owner.copyResults(); });
		el.createEl('p', { text: 'Settings counts are at least the observed writes. Two writes between polls can count as one. Estimated bytes adds the file size at each observed write; it is not transfer traffic.', cls: 'sync-churn-help' });
		if (watch.unreadable) el.createEl('p', { text: `${watch.unreadable} settings files could not be read in the last check.` });
		this.section(el, 'settings', 'Settings and plugin files');
		this.section(el, 'vault', 'Notes and attachments');
		el.createEl('h3', { text: `Session history (${PRO_LABEL})` });
		if (!isPro()) { el.createEl('p', { text: 'Pro adds saved sessions, a daily chart, rate notices and folder suggestions. The live table and Markdown copy are free.' }); return; }
		const history = this.owner.history;
		el.createEl('p', { text: `${history.length} saved sessions · most recent 30 kept` });
		const days = dailyHistory(history);
		if (!days.length) el.createEl('p', { text: 'Stop a session to add its observed writes to the daily chart.' });
		else {
			const chart = el.createDiv({ cls: 'sync-churn-chart', attr: { role: 'img', 'aria-label': 'Observed writes by local day' } });
			const max = Math.max(1, ...days.map(([, n]) => n));
			for (const [day, count] of days) {
				const bar = chart.createDiv({ cls: 'sync-churn-day' });
				bar.createSpan({ text: day });
				const meter = bar.createEl('meter', { attr: { min: '0', max: String(max), value: String(count), 'aria-label': `${day}: ${count} writes` } });
				meter.textContent = String(count); bar.createSpan({ text: String(count) });
			}
		}
		const list = el.createEl('details', { attr: { 'data-key': 'saved' } }); list.createEl('summary', { text: 'Saved sessions' });
		for (const s of [...history].reverse()) {
			const item = list.createEl('details', { attr: { 'data-key': String(s.started) } });
			item.createEl('summary', { text: `${new Date(s.started).toLocaleString()} · ${s.rows.reduce((n, r) => n + r.writes, 0)} writes` });
			for (const row of sortedRows(s.rows)) item.createEl('p', { text: `${row.path} · ${row.writes} writes · ${row.bytes} estimated bytes` });
		}
		el.createEl('h3', { text: `${SYNC_LABEL} folder suggestions (${PRO_LABEL})` });
		el.createEl('p', { text: `Copy folders from the five files with the most writes. Review them in ${SYNC_LABEL}. Excluding a folder can stop useful settings or notes from syncing. Root files have no folder suggestion.` });
		const folders = el.createEl('button', { text: 'Copy folders to review' });
		folders.addEventListener('click', () => { void this.owner.copyExclusions(); });
	}
	private section(el: HTMLElement, group: Group, title: string): void {
		el.createEl('h3', { text: title });
		const session = this.owner.watch.session;
		const rows = sortedRows(session?.rows.filter((r) => r.group === group) ?? []);
		if (!rows.length) { el.createEl('p', { text: group === 'settings' ? 'No settings files observed.' : 'No note or attachment writes observed.' }); return; }
		const table = el.createEl('table', { cls: 'sync-churn-table' });
		const heading = table.createEl('thead').createEl('tr');
		for (const label of ['File', group === 'settings' ? 'Writes (at least)' : 'Writes', 'Writes/h', 'Est. bytes']) heading.createEl('th', { text: label });
		const body = table.createEl('tbody');
		for (const row of rows) this.row(body, row, session!);
	}
	private row(body: HTMLElement, row: Row, session: NonNullable<SyncChurnWatchPlugin['watch']['session']>): void {
		const tr = body.createEl('tr', { attr: { 'data-path': row.path } });
		const cell = tr.createEl('td'); cell.createDiv({ text: row.name, cls: 'sync-churn-name' });
		if (row.group === 'settings') cell.createEl('small', { text: row.path });
		for (const value of [row.writes, rate(row, session, Date.now()), row.bytes]) tr.createEl('td', { text: String(value) });
	}
}
