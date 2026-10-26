import { describe, expect, it, vi } from 'vitest';
import { commands, RenderQueue, enabledFor, rendererInput, planNote, type PlanInput } from '../src/model';
import vectors from './vectors/live-template-results.json';

describe('golden vectors', () => {
 for (const vector of vectors.cases) it(vector.name, () => expect(planNote(vector.args[0] as PlanInput)).toEqual(vector.expected));
});
describe('trust rules', () => {
 const rules = { enabled: ['Manual.md'], disabled: ['Trusted/Blocked.md'], folders: 'Trusted\nWork/Notes/', property: 'live-results' };
 it('keeps manual enable free', () => expect(enabledFor('Manual.md', {}, rules, false)).toBe(true));
 it('rejects rules without Pro', () => expect(enabledFor('Trusted/A.md', { 'live-results': true }, rules, false)).toBe(false));
 it('includes a folder and its descendants', () => expect(enabledFor('Trusted/Sub/A.md', {}, rules, true)).toBe(true));
 it('matches folder boundaries', () => expect(enabledFor('TrustedElse/A.md', {}, rules, true)).toBe(false));
 it('requires a Boolean property', () => expect(enabledFor('A.md', { 'live-results': 'true' }, rules, true)).toBe(false));
 it('accepts the Boolean property', () => expect(enabledFor('A.md', { 'live-results': true }, rules, true)).toBe(true));
 it('keeps a manual disable above rules', () => expect(enabledFor('Trusted/Blocked.md', { 'live-results': true }, rules, true)).toBe(false));
 it('does not enable notes through empty rules', () => expect(enabledFor('A.md', {}, { enabled: [], disabled: [], folders: '\n/', property: '' }, true)).toBe(false));
});
describe('render queue', () => {
 it('serializes jobs and executes each once', async () => {
  const queue = new RenderQueue(); const order: string[] = [];
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.run(() => true, async () => { order.push('a start'); await wait; order.push('a end'); return 'a'; });
  const second = queue.run(() => true, async () => { order.push('b'); return 'b'; });
  await Promise.resolve(); expect(order).toEqual(['a start']);
  release(); expect(await Promise.all([first, second])).toEqual(['a', 'b']);
  expect(order).toEqual(['a start', 'a end', 'b']);
 });
 it('does not start an obsolete job', async () => {
  const queue = new RenderQueue(), job = vi.fn(async () => 'bad');
  expect(await queue.run(() => false, job)).toBeUndefined(); expect(job).not.toHaveBeenCalled();
 });
 it('continues after a rejected command', async () => {
  const queue = new RenderQueue();
  await expect(queue.run(() => true, async () => { throw new Error('bad'); })).rejects.toThrow('bad');
  expect(await queue.run(() => true, async () => 'ok')).toBe('ok');
 });
 it('preserves punctuation and Unicode as numeric entities', () => {
  const source = '<%+ "a_b**<&😀" %>';
  const el = document.createElement('div'); el.innerHTML = rendererInput(source);
  expect(el.textContent).toBe(source);
 });
});

describe('nested code contexts', () => {
 it('excludes a fence nested under a list marker', () => expect(commands('- ```js\n  <%+ 1 %>\n  ```')).toEqual([]));
 it('excludes HTML code elements', () => expect(commands('<code><%+ 1 %></code>')).toEqual([]));
 it('excludes multiline HTML pre elements', () => expect(commands('<pre>\n<%+ 1 %>\n</pre>')).toEqual([]));
});
