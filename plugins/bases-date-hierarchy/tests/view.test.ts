import { afterEach, expect, it, vi } from 'vitest';
vi.mock('obsidian', async () => {
 const original = await vi.importActual<Record<string, unknown>>('obsidian');
 class Value { constructor(public value: unknown) {} toString() { return String(this.value); } }
 return { ...original, BasesView: class {}, DateValue: class extends Value { dateOnly() { return new Value(String(this.value).slice(0, 10)); } }, NumberValue: class extends Value {}, BooleanValue: class extends Value { isTruthy() { return !!this.value; } }, StringValue: class extends Value {}, NullValue: class extends Value {} };
});
import { DateValue, type Value } from 'obsidian';
import { DateHierarchyView, KEY, plain, dateCell } from '../src/view';
import { bindPro, resetPro } from '../src/pro';
import type { SponsorsManager } from '../src/license/index';
afterEach(() => { resetPro(); vi.useRealTimers(); document.body.empty(); });
function view(pro = false) {
 bindPro({ isPro: () => pro, onChange: () => () => {} } as unknown as SponsorsManager);
 const root = document.body.createDiv(); const set = vi.fn();
 const config = { name: 'Test', get: (key: string) => key === KEY.remember, getAsPropertyId: (key: string) => key === KEY.date ? 'note.date' : null, getOrder: () => ['file.name', 'note.date'], getDisplayName: (key: string) => key, set };
 const renderTo = vi.fn((el: HTMLElement) => el.createEl('a', { text: 'Related', cls: 'internal-link', href: 'Related.md' }));
 const value = { toString: () => '2026-10-21', renderTo };
 const v = Object.assign(Object.create(DateHierarchyView.prototype) as DateHierarchyView, { root, config, collapsed: new Set(), stateMode: null, persistTimer: null, groups: [], app: { metadataCache: { getFileCache: vi.fn(() => null) }, renderContext: {}, ['workspace']: { openLinkText: vi.fn() } }, data: { data: [{ file: { path: 'a.md', basename: 'a' }, getValue: () => value }] } });
 // Date property must use a genuine typed Bases value; cells still exercise renderTo.
 const date = Object.create(DateValue.prototype) as Value;
 Object.assign(date, { value: '2026-10-21T12:00', renderTo });
 v.data.data[0]!.getValue = () => date;
 return { v, set, renderTo };
}
it('converts Bases DateValue to a local calendar day', () => {
 const date = Object.assign(Object.create(DateValue.prototype) as Value, { value: '2026-10-21T12:00' });
 expect(plain(date)).toBe('2026-10-21');
});
it('uses singular note text and renders typed cells as links', () => {
 const { v, renderTo } = view(); v.render();
 expect(v.root.querySelector('.bdh-bar')?.textContent).toContain('1 note ·');
 expect(renderTo).toHaveBeenCalled(); expect(v.root.querySelectorAll('a.internal-link')).toHaveLength(2);
});
it('retains focused group DOM and scroll on repeated data updates', () => {
 const { v } = view(); v.render(); const summary = v.root.querySelector('summary')!;
 summary.focus(); v.root.scrollTop = 50; v.onDataUpdated();
 expect(document.activeElement).toBe(summary); expect(v.root.scrollTop).toBe(50);
});
it('collapse all persists only top groups after a debounce', () => {
 vi.useFakeTimers(); const { v, set } = view(true); v.render();
 const button = v.root.querySelector('[data-action="collapse"]')!;
 (v as unknown as { click(e: MouseEvent): void }).click({ target: button, type: 'click' } as unknown as MouseEvent);
 expect(set).not.toHaveBeenCalled(); vi.advanceTimersByTime(300);
 expect(set).toHaveBeenCalledWith(KEY.collapsed, ['["note.date","month","2026"]']);
});
it('opens a note in a new tab on middle click', () => {
 const { v } = view(); v.render();
 const link = v.root.querySelector('a')!; const preventDefault = vi.fn();
 (v as unknown as { click(e: MouseEvent): void }).click({ target: link, type: 'auxclick', button: 1, preventDefault } as unknown as MouseEvent);
 expect(v.app.workspace.openLinkText).toHaveBeenCalledWith('a.md', '', 'tab'); expect(preventDefault).toHaveBeenCalled();
});

it('keeps invalid raw note dates even if Bases normalizes them', () => {
 const { v } = view();
 vi.mocked(v.app.metadataCache.getFileCache).mockReturnValue({ frontmatter: { date: '2026-02-30' } });
 expect(dateCell(v.app, v.data.data[0]!, 'note.date')).toBe('2026-02-30');
 v.render(); expect(v.root.textContent).toContain('No date');
});
it('uses the typed Bases value for file dates', () => {
 const { v } = view(); expect(dateCell(v.app, v.data.data[0]!, 'file.ctime')).toBe('2026-10-21');
});
it('emits the registered hover preview event for internal note links', () => {
 const { v } = view(); v.render();
 const handlers = new Map<string, (event: unknown) => void>();
 const trigger = vi.fn(); Object.assign(v.app.workspace, { trigger });
 Object.assign(v, { register: vi.fn(), registerDomEvent: (_el: unknown, type: string, cb: (e: unknown) => void) => handlers.set(type, cb) });
 v.onload(); const link = v.root.querySelector('a')!;
 handlers.get('mouseover')!({ target: link });
 expect(trigger).toHaveBeenCalledWith('hover-link', expect.objectContaining({ source: 'bases-date-hierarchy', linktext: 'a.md', targetEl: link }));
});
