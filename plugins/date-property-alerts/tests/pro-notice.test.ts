import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async importOriginal => {
 const actual = await importOriginal<Record<string, unknown>>();
 class Value { constructor(private text: string) {} toString() { return this.text; } }
 class View {
  private cleanup: Array<() => void> = [];
  register(fn: () => void) { this.cleanup.push(fn); }
  registerInterval(id: number) { this.register(() => window.clearInterval(id)); }
  load() { (this as unknown as { onload: () => void }).onload(); }
  unload() { for (const fn of this.cleanup) fn(); this.cleanup = []; (this as unknown as { onunload: () => void }).onunload(); }
 }
 return { ...actual, BasesView: View, DateValue: Value, StringValue: Value };
});
import { Notice, StringValue, type QueryController } from 'obsidian';
import type { SponsorsManager } from '../src/license/index';
import Plugin from '../src/main';
import { AlertView } from '../src/view';
import { bindPro } from '../src/pro';
import type { Ledger } from '../src/alerts';

// A free user can select Snooze 1 hour, Snooze 1 day and Snooze custom in the Alerts view. The select shows the
// shared Pro notice with the "Sponsor on GitHub" button. The alert does not snooze and nothing is saved.
// A Pro user snoozes with the same buttons.
const LEAD = 'Snoozes of 1 hour, 1 day or a custom length need Pro.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
 return {
  isPro: () => pro,
  onChange: () => () => undefined,
  hasToken: () => false,
  isChecking: () => false,
  getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
  config: { sponsorLogin: 'theluckystrike', source: 'date-property-alerts' },
 } as unknown as SponsorsManager;
}
function host() {
 const p = Object.create(Plugin.prototype) as Plugin;
 Object.assign(p, { manifest: { id: 'date-property-alerts' }, running: true, startedAt: 0, ledger: {} as Ledger, views: new Set(), notices: new Map(), app: { saveLocalStorage: vi.fn(), 'workspace': { openLinkText: vi.fn() }, metadataCache: { getFileCache: () => ({ frontmatter: { due: '2020-01-01' } }) } } });
 return p;
}
function view(p: Plugin) {
 const container = document.body.createDiv();
 const v = new AlertView({} as QueryController, container, p);
 Object.assign(v, { app: p.app, config: { name: 'Reviews', getAsPropertyId: () => 'note.due', get: () => undefined }, data: { data: [{ file: { path: 'Review.md', extension: 'md' }, getValue: () => new StringValue('2020-01-01') }] } });
 v.load(); v.tick(); return v;
}
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text);
let shown: { text: string; buttons: number }[] = [];
beforeEach(() => {
 shown = [];
 vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
  shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
 });
});
afterEach(() => { bindPro(null); vi.restoreAllMocks(); document.body.empty(); });

describe('Pro snooze in the Alerts view', () => {
 it('a free user who selects a Pro snooze gets the Pro notice with a Sponsor button, and the alert does not snooze', () => {
  bindPro(fakePro(false));
  const p = host(); const persist = vi.spyOn(p, 'persist'); view(p);
  const before = JSON.stringify(p.ledger); persist.mockClear(); shown = [];
  for (const text of ['Snooze 1 hour', 'Snooze 1 day']) { expect(button(text)).toBeDefined(); button(text)!.click(); }
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Custom snooze minutes"]');
  expect(input).not.toBeNull();
  input!.value = '30'; button('Snooze custom')!.click();
  expect(shown).toEqual([
   { text: `${LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 },
   { text: `${LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 },
   { text: `${LEAD} ${PITCH}Sponsor on GitHub`, buttons: 1 },
  ]);
  expect(JSON.stringify(p.ledger)).toBe(before);
  expect(persist).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Until');
  // The free 15 minute snooze still works, with no Pro notice.
  button('Snooze 15 minutes')!.click();
  expect(document.body.textContent).toContain('Until');
  expect(shown).toHaveLength(3);
  p.onunload();
 });

 it('a Pro user who selects Snooze 1 hour snoozes the alert, with no Pro notice', () => {
  bindPro(fakePro(true));
  const p = host(); view(p); shown = [];
  button('Snooze 1 hour')!.click();
  expect(document.body.textContent).toContain('Until');
  expect(Object.values(p.ledger).some(s => (s.snoozeUntil ?? 0) > Date.now() + 59 * 60000)).toBe(true);
  expect(shown.filter(n => n.buttons > 0)).toEqual([]);
  p.onunload();
 });
});
