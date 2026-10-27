import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// A free user can select Snooze 1 hour, Snooze 1 day and Snooze custom in the Alerts view. The select shows the
// shared Pro notice with the "Sponsor on GitHub" button, and the alert does not snooze. A Pro user snoozes.
const LEAD = 'Snoozes of 1 hour, 1 day or a custom length need Pro.';
type Manager = { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void; isPro(): boolean };
type Host = { plugins: { plugins: Record<string, { pro: Manager | null }> } };

async function setPro(on: boolean): Promise<boolean> {
 return browser.executeObsidian(async ({ app }, id, enabled) => {
  const pro = (app as unknown as Host).plugins.plugins[id]!.pro!;
  if (!enabled) { pro.signOut(); return pro.isPro(); }
  // Synthetic token and HTTP answer. No network request.
  pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
  app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
  await pro.refreshNow();
  return pro.isPro();
 }, pluginId, on);
}

async function openView(name: string): Promise<void> {
 // An old date is due at once and shows no alert notice (it was due before the plugin started).
 await obsidianPage.write(`${name}.md`, '---\ndue: "2020-01-01"\nkind: pro-notice\n---\nCheck the snooze.');
 await obsidianPage.write(`${name}.base`, `filters:\n  and:\n    - file.name == "${name}"\nviews:\n  - type: date-property-alerts\n    name: ${name}\n    alertProperty: note.due\n    alertsEnabled: true\n`);
 await obsidianPage.openFile(`${name}.base`);
 await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .dpa-summary').getText()).includes('1 due'), { timeout: 15000, timeoutMsg: 'The Alerts view did not show the due row.' });
 await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
}

/** Selects the button with this text in the active Alerts view, then returns the notices, the view text and the ledger. */
async function select(text: string) {
 return browser.executeObsidian(async ({ app }, label) => {
  const root = activeDocument.querySelector('.workspace-leaf.mod-active .date-property-alerts')!;
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`No button "${label}" in the view: ${root.textContent}`);
  const input = root.querySelector<HTMLInputElement>('input[aria-label="Custom snooze minutes"]');
  if (input) input.value = '30';
  button.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
   notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
   view: activeDocument.querySelector('.workspace-leaf.mod-active .date-property-alerts')?.textContent ?? '',
   ledger: JSON.stringify(app.loadLocalStorage('date-property-alerts-deliveries') ?? {}),
  };
 }, text);
}

describe('Pro snooze in the Alerts view', function () {
 afterEach(async () => { await setPro(false); });

 it('a free user who selects a Pro snooze gets the Pro notice with a Sponsor button, and the alert does not snooze', async () => {
  expect(await setPro(false)).toBe(false);
  await openView('Free snooze');
  const before = await browser.executeObsidian(({ app }) => JSON.stringify(app.loadLocalStorage('date-property-alerts-deliveries') ?? {}));
  for (const label of ['Snooze 1 hour', 'Snooze 1 day', 'Snooze custom']) {
   await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
   const after = await select(label);
   if (!after.notices.some((n) => n.text.includes(LEAD) && n.sponsor === 1)) throw new Error(`No Pro notice after ${label}: ${JSON.stringify(after.notices)}`);
   expect(after.view).not.toContain('Until');
   expect(after.ledger).toBe(before);
  }
 });

 it('a Pro user who selects Snooze 1 hour snoozes the alert, with no Pro notice', async () => {
  expect(await setPro(true)).toBe(true);
  await openView('Pro snooze');
  const after = await select('Snooze 1 hour');
  await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .date-property-alerts').getText()).includes('Until'), { timeout: 15000, timeoutMsg: 'A Pro snooze did not show the snooze time.' });
  expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
 });
});
