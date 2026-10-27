import { BasesView, DateValue, StringValue, type BasesAllOptions, type QueryController } from 'obsidian';
import { dismiss, dueCount, observe, ready, rowsFor, snooze, type AlertRow } from './alerts';
import { isPro, onProChange, PRO_SNOOZE, proNotice } from './pro';
import type DatePropertyAlertsPlugin from './main';

export const VIEW_ID = 'date-property-alerts';
export function viewOptions(): BasesAllOptions[] {
 return [
  { type: 'property', key: 'alertProperty', displayName: 'Date property', default: 'note.due', filter: prop => prop.startsWith('note.') },
  { type: 'dropdown', key: 'alertHour', displayName: 'Date-only hour (local)', default: '9', options: Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, '0')}:00`])) },
  { type: 'toggle', key: 'alertsEnabled', displayName: 'Enable notices', default: true },
 ];
}

export class AlertView extends BasesView {
 type = VIEW_ID;
 private root: HTMLElement;
 private active = false;
 private signature = '';
 constructor(controller: QueryController, container: HTMLElement, private readonly host: DatePropertyAlertsPlugin) {
  super(controller);
  this.root = container.createDiv({ cls: 'date-property-alerts' });
 }
 onload(): void {
  this.active = true; this.host.views.add(this);
  this.register(onProChange(() => this.tick()));
  this.registerInterval(window.setInterval(() => this.tick(), 30000));
 }
 onunload(): void { this.active = false; this.host.views.delete(this); this.root.empty(); }
 onDataUpdated(): void { this.tick(); }
 tick(): void {
  if (!this.active || !this.host.running || !this.data) return;
  const property = this.config.getAsPropertyId('alertProperty') ?? 'note.due';
  if (!property.startsWith('note.')) { this.root.empty(); this.signature = ''; this.root.createEl('p', { text: 'Select a note date property in the view options.' }); return; }
  const hourValue = Number(this.config.get('alertHour') ?? 9);
  const hour = Number.isInteger(hourValue) && hourValue >= 0 && hourValue <= 23 ? hourValue : 9;
  const enabled = this.config.get('alertsEnabled') !== false;
  const { rows, invalid } = rowsFor(this.data.data.filter(e => e.file.extension === 'md').map(e => {
   const value = e.getValue(property);
   // Preserve raw note syntax for stable identity, but validate with the Bases value API.
   const raw: unknown = this.app.metadataCache.getFileCache(e.file)?.frontmatter?.[property.slice(5)];
   return { path: e.file.path, value: value instanceof DateValue || value instanceof StringValue ? raw : null };
  }), property, hour);
  const now = Date.now();
  if (observe(rows, this.host.ledger, this.host.startedAt, now)) this.host.persist();
  if (enabled) for (const row of rows) if (ready(row, this.host.ledger, now)) this.host.notify(row);
  const visible = rows.filter(r => !this.host.ledger[r.key]?.dismissed);
  const signature = JSON.stringify([this.config.name, property, enabled, invalid, isPro(), visible.map(r => [r, this.host.ledger[r.key], r.due <= now, (this.host.ledger[r.key]?.snoozeUntil ?? 0) > now])]);
  if (signature === this.signature) return;
  this.signature = signature; this.root.empty();
  this.root.createEl('h3', { text: this.config.name || 'Date property alerts' });
  this.root.createEl('p', { cls: 'dpa-summary', text: `${dueCount(rows, this.host.ledger, now)} due · ${visible.filter(r => r.due > now).length} upcoming · ${invalid} missing or invalid` });
  this.root.createEl('p', { cls: 'dpa-hint', text: `${enabled ? 'Monitoring' : 'Notices paused'} · ${property.slice(5)} · Keep this Alerts view open. App must be running.` });
  if (!rows.length) this.root.createEl('p', { text: 'No valid dates in the filtered rows. Use a date such as 2026-10-25 or a date and time.' });
  for (const row of visible) this.renderRow(row, now);
 }
 private renderRow(row: AlertRow, now: number): void {
  const state = this.host.ledger[row.key];
  const sleeping = (state?.snoozeUntil ?? 0) > now;
  const status = state?.delivered ? 'Delivered' : sleeping ? 'Snoozed' : row.due > now ? 'Upcoming' : 'Due';
  const card = this.root.createDiv({ cls: 'dpa-row' });
  card.createEl('button', { text: row.path.replace(/\.md$/, ''), cls: 'dpa-open' }).addEventListener('click', () => { void this.app.workspace.openLinkText(row.path, '', true); });
  card.createDiv({ cls: 'dpa-date', text: `${new Date(row.due).toLocaleString()} · ${status}` });
  if (sleeping) card.createDiv({ text: `Until ${new Date(state!.snoozeUntil).toLocaleString()}` });
  if (row.due > now) return;
  const actions = card.createDiv({ cls: 'dpa-actions' });
  actions.createEl('button', { text: 'Dismiss' }).addEventListener('click', () => {
   dismiss(row, this.host.ledger, Date.now()); this.host.cancelNotice(row.key); this.host.persist(); this.host.refreshViews();
  });
  const addSnooze = (label: string, minutes: number) => {
   actions.createEl('button', { text: `Snooze ${label}` }).addEventListener('click', () => {
    if (snooze(row, this.host.ledger, Date.now(), minutes, isPro())) { this.host.cancelNotice(row.key); this.host.persist(); this.host.refreshViews(); }
   });
  };
  addSnooze('15 minutes', 15);
  // The Pro snoozes show for every user. A free select shows the Pro notice and does not snooze.
  const addProSnooze = (label: string, minutes: () => number) => {
   actions.createEl('button', { text: `Snooze ${label}` }).addEventListener('click', () => {
    if (!isPro()) { proNotice(PRO_SNOOZE); return; }
    if (snooze(row, this.host.ledger, Date.now(), minutes(), isPro())) { this.host.cancelNotice(row.key); this.host.persist(); this.host.refreshViews(); }
   });
  };
  addProSnooze('1 hour', () => 60); addProSnooze('1 day', () => 1440);
  const input = actions.createEl('input', { type: 'number', attr: { min: '1', max: '10080', 'aria-label': 'Custom snooze minutes', placeholder: 'Minutes' } });
  addProSnooze('custom', () => Number(input.value));
 }
}
