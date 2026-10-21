import { describe, expect, it } from 'vitest';
import { clearSection, processSection } from '../src/reading';
import { DEFAULT_SETTINGS as defaults } from '../src/settings';

describe('section lifecycle', () => {
 it('has no repeated marks, removes marks and keeps links and listeners', () => {
  const el = document.createElement('div'); el.innerHTML = '<p>Reading <a href="local.md">fast words</a></p>';
  const link = el.querySelector('a')!; let clicks = 0; link.addEventListener('click', () => clicks++);
  const before = el.innerHTML;
  processSection(el, defaults, true, false); const first = el.innerHTML;
  processSection(el, defaults, true, false); expect(el.innerHTML).toBe(first);
  expect(el.querySelector('a')).toBe(link);
  clearSection(el); expect(el.innerHTML).toBe(before);
  link.click(); expect(clicks).toBe(1);
 });
 it('uses custom style only with Pro, and restores the free style on sign out', () => {
  const el = document.createElement('div'); el.textContent = 'Reading words';
  const s = { ...defaults, weight: 900, color:'#527a99', endingOpacity:0.5 };
  processSection(el,s,true,false); expect(el.querySelector('b')?.getAttribute('style')).toBeNull(); expect(el.querySelector('.fx-end')).toBeNull();
  processSection(el,s,true,true); expect(el.querySelector('b')?.getAttribute('style')).toContain('--fx-weight:900'); expect(el.querySelector('.fx-end')?.textContent).toBe('ing');
  processSection(el,s,true,false); expect(el.querySelector('.fx-end')).toBeNull(); expect(el.querySelector('b')?.getAttribute('style')).toBeNull();
 });
 it('processes only the given section', () => {
  const page = document.createElement('div'); page.innerHTML = '<section>Reading</section><section>other text</section>';
  processSection(page.firstElementChild as HTMLElement,defaults,true,false);
  expect(page.lastElementChild?.innerHTML).toBe('other text');
 });
});
