import { describe, expect, it, vi } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import { codeFolding, foldable, foldEffect, foldedRanges, foldService } from '@codemirror/language';
import { editorInfoField } from 'obsidian';
import { expandFolds, foldStopExtension, type FoldStopConfig } from '../src/extension';
import vectors from './vectors/hr-fold-stop.json';
import type { EditorView } from '@codemirror/view';

vi.mock('obsidian', async () => {
 const original = await import('obsidian-test-mocks/obsidian');
 const { StateField } = await import('@codemirror/state');
 return { ...original, editorInfoField: StateField.define({ create: () => ({ file: { path: 'Archive/A.md' } }), update: value => value }) };
});

const DOC = '# A\nBody\n\n---\nTail\n# B\nEnd';
const CONFIG: FoldStopConfig = { enabled: true, rule: { vaultEnabled: true, folders: [], overrideProperty: '' } };
function create(getConfig: (path: string) => FoldStopConfig = () => CONFIG) {
 return EditorState.create({ doc: DOC, extensions: [editorInfoField, codeFolding(), foldStopExtension(getConfig)] });
}
function range(state: EditorState) {
 const line = state.doc.line(1);
 return foldable(state, line.from, line.to);
}

describe('public fold service', () => {
 it('starts on the heading line and keeps the newline before the rule', () => {
  const state = create();
  expect(range(state)).toEqual({ from: 3, to: 9 });
  expect(state.doc.sliceString(9)).toBe('\n---\nTail\n# B\nEnd');
 });
 it('reads the file path of its own editor for folder rules', () => {
  const get = vi.fn(() => ({ ...CONFIG, rule: { ...CONFIG.rule, folders: [{ folder: 'Archive', enabled: false }] } }));
  expect(range(create(get))).toBeNull();
  expect(get).toHaveBeenCalledWith('Archive/A.md');
 });
 it('uses a note override when the vault default is off', () => {
  expect(range(create(() => ({ ...CONFIG, rule: { vaultEnabled: false, folders: [], overrideProperty: 'fold-stop' }, noteOverride: true })))).toEqual({ from: 3, to: 9 });
 });
 it('returns no custom range when disabled', () => expect(range(create(() => ({ ...CONFIG, enabled: false })))).toBeNull());
 it('keeps the rule visible when the section has no body', () => {
  let state = EditorState.create({ doc: '# A\n---\nTail', extensions: [editorInfoField, codeFolding(), foldStopExtension(() => CONFIG)] });
  state = state.update({ effects: foldEffect.of({ from: 3, to: state.doc.length }) }).state;
  expect(foldedRanges(state).size).toBe(0);
  expect(state.doc.toString()).toBe('# A\n---\nTail');
 });
 it('clips a native fold effect that extends past the rule', () => {
  let state = create();
  state = state.update({ effects: foldEffect.of({ from: 3, to: 18 }) }).state;
  const cursor = foldedRanges(state).iter();
  expect(foldedRanges(state).size).toBe(1);
  expect(cursor.from).toBe(3);
  expect(cursor.to).toBe(9);
 });
 it('maps a fold through edits and rescans for the next fold', () => {
  let state = create();
  state = state.update({ effects: foldEffect.of(range(state)!) }).state;
  state = state.update({ changes: { from: 4, insert: 'Added\n' } }).state;
  const cursor = foldedRanges(state).iter();
  expect(state.doc.sliceString(cursor.from, cursor.to)).toContain('Added');
  expect(state.doc.sliceString(cursor.from, cursor.to)).not.toContain('---');
  expect(range(state)).toEqual({ from: 3, to: 15 });
 });
 it('expands old ranges without changing the document', () => {
  let state = create();
  state = state.update({ effects: foldEffect.of(range(state)!) }).state;
  const view = { get state() { return state; }, dispatch: (spec: Parameters<EditorState['update']>[0]) => { state = state.update(spec).state; } };
  expandFolds(view as unknown as EditorView);
  expect(foldedRanges(state).size).toBe(0);
  expect(state.doc.toString()).toBe(DOC);
 });
 it('unload removes the custom service and preserves the text', () => {
  let state = create();
  expect(state.facet(foldService)).toHaveLength(1);
  state = state.update({ effects: StateEffect.reconfigure.of([codeFolding(), editorInfoField]) }).state;
  expect(state.facet(foldService)).toHaveLength(0);
  expect(range(state)).toBeNull();
  expect(state.doc.toString()).toBe(DOC);
 });
});

for (const c of vectors.editorCases) {
 it(c.name, () => {
  let state = EditorState.create({ doc: c.args[1] as string, extensions: [editorInfoField, codeFolding(), foldStopExtension(() => CONFIG)] });
  state = state.update({ effects: foldEffect.of(range(state)!) }).state;
  if (c.args[0] === 'edit') state = state.update({ changes: c.args[2] as { from: number; insert: string } }).state;
  else {
   expandFolds({ get state() { return state; }, dispatch: (spec: Parameters<EditorState['update']>[0]) => { state = state.update(spec).state; } } as unknown as EditorView);
   if (c.args[0] === 'unload') state = state.update({ effects: StateEffect.reconfigure.of([codeFolding(), editorInfoField]) }).state;
  }
  const folds: number[][] = [];
  for (const cursor = foldedRanges(state).iter(); cursor.value; cursor.next()) folds.push([cursor.from, cursor.to]);
  expect({ text: state.doc.toString(), folds, services: state.facet(foldService).length }).toEqual(c.expected);
 });
}
