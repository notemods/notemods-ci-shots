import { expect, it } from 'vitest';
import { patchChildren } from '../src/dom';
function tree(label: string): HTMLElement {
 const el = document.createElement('div');
 const details = el.createEl('details'); details.dataset.group = '2026'; details.open = true;
 details.createEl('summary', { text: label }); return el;
}
it('patches counts in place and retains focused summary and scroll', () => {
 const root = tree('2026 (1)'); document.body.append(root);
 const summary = root.querySelector('summary')!; summary.tabIndex = 0; summary.focus(); root.scrollTop = 120;
 patchChildren(root, tree('2026 (2)'));
 expect(root.querySelector('summary')).toBe(summary); expect(document.activeElement).toBe(summary);
 expect(summary.textContent).toBe('2026 (2)'); expect(root.scrollTop).toBe(120); root.remove();
});
it('reorders keyed groups while retaining their DOM nodes', () => {
 const root = tree('2026'); const existing = root.firstChild;
 const fresh = tree('2026 updated'); const other = fresh.createEl('details'); other.dataset.group = '2025';
 fresh.prepend(other); patchChildren(root, fresh);
 expect(root.lastChild).toBe(existing); expect(root.children).toHaveLength(2);
});
it('removes groups excluded by a filter', () => {
 const root = tree('2026'); patchChildren(root, document.createElement('div')); expect(root.children).toHaveLength(0);
});
