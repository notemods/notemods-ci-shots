import { Notice, Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { claim, normalizeLedger, pruneLedger, ready, type AlertRow, type Ledger } from './alerts';
import { bindPro, SPONSORS } from './pro';
import { AlertSettingTab } from './settings';
import { AlertView, VIEW_ID, viewOptions } from './view';

export default class DatePropertyAlertsPlugin extends Plugin {
 readonly startedAt = Date.now();
 running = true;
 ledger: Ledger = {};
 pro: SponsorsManager | null = null;
 readonly views = new Set<AlertView>();
 private notices = new Map<string, { notice: Notice; cleanup: () => void }>();
 onload(): void {
  this.ledger = normalizeLedger(this.app.loadLocalStorage(`${this.manifest.id}-deliveries`));
  const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
  pro.init(); this.pro = pro; bindPro(pro);
  this.addSettingTab(new AlertSettingTab(this.app, this));
  this.registerBasesView(VIEW_ID, { name: 'Alerts', icon: 'bell-ring', factory: (controller, el) => new AlertView(controller, el, this), options: viewOptions });
  this.app.workspace.onLayoutReady(() => {
   if (!this.running) return;
   this.prune();
   this.registerInterval(window.setInterval(() => this.prune(), 86400000));
   void pro.refresh();
   this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
  });
 }
 private prune(): void {
  pruneLedger(this.ledger, Date.now(), path => this.app.vault.getFileByPath(path) !== null);
  this.persist();
 }
 persist(): void { this.app.saveLocalStorage(`${this.manifest.id}-deliveries`, this.ledger); }
 refreshViews(): void { for (const view of this.views) view.tick(); }
 cancelNotice(key: string): void {
  const pending = this.notices.get(key);
  if (!pending) return;
  pending.cleanup(); pending.notice.hide(); this.notices.delete(key);
 }
 notify(row: AlertRow): void {
  if (!this.running || this.notices.has(row.key) || !ready(row, this.ledger, Date.now())) return;
  const acknowledge = () => {
   claim([row], this.ledger, Date.now());
   this.cancelNotice(row.key); this.persist(); this.refreshViews();
   void this.app.workspace.openLinkText(row.path, '', true);
  };
  const fragment = createFragment(f => {
   f.createEl('strong', { text: 'Date alert due' });
   f.createEl('p', { text: row.path.replace(/\.md$/, '') });
   const button = f.createEl('button', { text: 'Acknowledge and open' });
   // Keep the native notice from swallowing the button's click during pointer down.
   button.addEventListener('pointerdown', event => event.stopPropagation());
   button.addEventListener('mousedown', event => event.stopPropagation());
   button.addEventListener('click', event => { event.stopPropagation(); acknowledge(); });
  });
  const notice = new Notice(fragment, 0);
  notice.messageEl.addEventListener('click', acknowledge);
  this.notices.set(row.key, { notice, cleanup: () => notice.messageEl.removeEventListener('click', acknowledge) });
 }
 onunload(): void {
  this.running = false;
  for (const view of [...this.views]) view.unload();
  this.views.clear();
  bindPro(null);
  for (const key of this.notices.keys()) this.cancelNotice(key);
 }
}
