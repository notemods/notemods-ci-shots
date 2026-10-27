import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
vi.mock('obsidian', async () => ({ ...(await vi.importActual('obsidian-test-mocks/obsidian')), editorInfoField: StateField.define({ create: () => ({ file: { path: 'Drafts/test.md' } }), update: value => value }) }));
import { editorInfoField } from 'obsidian';
import { focusExtension } from '../src/extension';

const views: EditorView[] = [];
// Browsers queue selectionchange. Happy DOM dispatches it synchronously during
// CodeMirror's own DOM update, which causes a reentrant update for text ranges.
beforeEach(() => {
 const dispatch = document.dispatchEvent.bind(document);
 vi.spyOn(document, 'dispatchEvent').mockImplementation(event => {
  if (event.type === 'selectionchange') { queueMicrotask(() => dispatch(event)); return true; }
  return dispatch(event);
 });
});
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('native spelling attributes', () => {
 it('suppresses inactive lines and never forces spelling on', () => {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ doc: 'alpha\n\nbeta', parent, extensions: [editorInfoField, focusExtension(() => 'paragraph', true)] });
  views.push(view);
  view.focus(); view.dispatch({ selection: { anchor: 1 } });
  const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));
  expect(lines[0]?.dataset.spellFocus).toBe('active');
  expect(lines[0]?.getAttribute('spellcheck')).toBeNull();
  expect(lines[2]?.getAttribute('spellcheck')).toBe('false');
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  expect(lines[0]?.dataset.spellFocus).toBe('active');
  expect(lines[0]?.getAttribute('spellcheck')).toBeNull();
  view.dispatch({ selection: { anchor: 9 } });
  expect(lines[0]?.getAttribute('spellcheck')).toBe('false');
  expect(lines[2]?.getAttribute('spellcheck')).toBeNull();
 });
 it('removes focus attributes when the feature is off', () => {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ doc: 'alpha', parent, extensions: [editorInfoField, focusExtension(() => 'off', true)] });
  views.push(view);
  expect(view.contentDOM.querySelector('[data-spell-focus]')).toBeNull();
 });
});
