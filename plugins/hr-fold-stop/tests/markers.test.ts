// End markers: `%% fold-stop %%` and `%% fold-stop N %%` lines end a heading fold without a divider line.
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldable, foldEffect, foldedRanges } from '@codemirror/language';
import { editorInfoField } from 'obsidian';
import { foldStopForText, foldStopLine, markerLevel, parseTopLevel, scanTopLevel } from '../src/boundaries';
import { foldStopExtension, type FoldStopConfig } from '../src/extension';

vi.mock('obsidian', async () => {
 const original = await import('obsidian-test-mocks/obsidian');
 const { StateField } = await import('@codemirror/state');
 return { ...original, editorInfoField: StateField.define({ create: () => ({ file: { path: 'A.md' } }), update: value => value }) };
});

const CONFIG: FoldStopConfig = { enabled: true, endMarkers: true, rule: { vaultEnabled: true, folders: [], overrideProperty: '' } };
const DOC = '# A\nBody\n\n%% fold-stop %%\nTail';
const make = (doc: string, config: Partial<FoldStopConfig> = {}) =>
 EditorState.create({ doc, extensions: [editorInfoField, codeFolding(), foldStopExtension(() => ({ ...CONFIG, ...config }))] });
const rangeAt = (state: EditorState, line = 1) => foldable(state, state.doc.line(line).from, state.doc.line(line).to);
const kindOf = (doc: string, line: number) => scanTopLevel(doc)[line - 1]!.kind;

describe('marker syntax (criterion 6)', () => {
 it.each([
  ['%%fold-stop%%', 1],
  ['%% FOLD-STOP %%', 1],
  ['   %% fold-stop 2 %%', 2],
  ['%% fold-stop %%', 1],
  ['%%  Fold-Stop 6  %%  ', 6],
  ['%% fold-stop 1 %%\r', 1],
 ])('%j is a marker of level %i', (text, level) => expect(markerLevel(text)).toBe(level));
 it.each([
  '%% fold-stop 7 %%',
  '%% fold-stop 0 %%',
  '%% fold-stop now %%',
  'text %% fold-stop %%',
  '%% fold-stop %% text',
  '    %% fold-stop %%',
  '%% fold-stop  2 %%',
  '%% fold-stop 12 %%',
  '%% foldstop %%',
  '% fold-stop %',
 ])('%j is not a marker', text => expect(markerLevel(text)).toBe(0));
});

describe('marker places (criterion 5)', () => {
 it.each([
  ['fenced code', '# A\n```\n%% fold-stop %%\n```\nTail', 3],
  ['tilde fence', '# A\n~~~\n%% fold-stop %%\n~~~\nTail', 3],
  ['indented code', '# A\n\n    %% fold-stop %%\n\nTail', 3],
  ['frontmatter', '---\na: 1\n%% fold-stop %%\n---\n# A\nTail', 3],
  ['list item', '# A\n- item\n  %% fold-stop %%\nTail', 3],
  ['ordered list item', '# A\n1. item\n   %% fold-stop %%\nTail', 3],
  ['blockquote', '# A\n> quote\n%% fold-stop %%\nTail', 3],
  ['callout', '# A\n> [!note] Title\n> text\n%% fold-stop %%\nTail', 4],
  ['open comment block', '# A\n%%\n%% fold-stop %%\n%%\nTail', 3],
  ['comment opened by text', '# A\nText %% starts a comment\n\n%% fold-stop %%\n\nends it %%\nTail', 4],
 ])('a marker in %s is not a stop', (_label, doc, line) => {
  expect(kindOf(doc, line)).not.toBe('marker');
  expect(foldStopForText(doc, doc.startsWith('---') ? 5 : 1, 1).kind).not.toBe('marker');
 });
 it('a comment delimiter in inline code does not open a comment', () => {
  expect(kindOf('# A\nUse `%%` for comments.\n\n%% fold-stop %%\nTail', 4)).toBe('marker');
 });
 it('a one-line comment does not open a comment block', () => {
  expect(kindOf('# A\n%% note %%\n\n%% fold-stop %%\nTail', 4)).toBe('marker');
 });
 it('a root paragraph after a list is a stop again', () => {
  expect(kindOf('# A\n- item\n\n%% fold-stop %%\nTail', 4)).toBe('marker');
 });
 it('sets the level to the digit or to 1', () => {
  const scan = scanTopLevel('# A\n\n%% fold-stop %%\n\n%% fold-stop 5 %%');
  expect(scan[2]).toEqual({ i: 2, kind: 'marker', level: 1 });
  expect(scan[4]).toEqual({ i: 4, kind: 'marker', level: 5 });
 });
});

describe('marker order (criterion 7)', () => {
 it('a marker before a rule wins', () => expect(foldStopForText('# A\nB\n\n%% fold-stop %%\n\n---\nT', 1, 1)).toEqual({ stop: 4, kind: 'marker' }));
 it('a rule before a marker wins', () => expect(foldStopForText('# A\nB\n\n---\n\n%% fold-stop %%\nT', 1, 1)).toEqual({ stop: 4, kind: 'rule' }));
 it('an equal heading before a marker wins', () => expect(foldStopForText('## A\nB\n## C\n\n%% fold-stop %%\nT', 1, 2)).toEqual({ stop: 3, kind: 'heading' }));
 it('a level N marker ends headings of level N and deeper only', () => {
  const doc = '### B\nbody\n#### C\nchild\n\n%% fold-stop 4 %%\nmore\n\n---\nTail';
  const scan = scanTopLevel(doc);
  expect(foldStopLine(scan, 2, 4)).toBe(5);
  expect(foldStopLine(scan, 0, 3)).toBe(8);
 });
 it('the setting off skips markers but keeps rules and headings', () => {
  const scan = scanTopLevel('# A\nB\n\n%% fold-stop %%\nT\n# C');
  expect(foldStopLine(scan, 0, 1, false)).toBe(5);
  expect(foldStopLine(scan, 0, 1, true)).toBe(3);
 });
});

describe('editor folds with markers', () => {
 it('starts on the heading line and keeps the newline before the marker (criterion 1)', () => {
  const state = make(DOC);
  expect(rangeAt(state)).toEqual({ from: 3, to: 9 });
  expect(state.doc.sliceString(9)).toBe('\n%% fold-stop %%\nTail');
 });
 it('folds the H4 to the level 4 marker and the H3 past it to the rule (criterion 2)', () => {
  const doc = '### B\nbody\n#### C\nchild body\n\n%% fold-stop 4 %%\nmore H3 text\n\n---\nTail';
  const state = make(doc);
  const child = rangeAt(state, 3)!;
  expect(state.doc.sliceString(child.from, child.to)).toBe('\nchild body\n');
  const parent = rangeAt(state, 1)!;
  expect(state.doc.sliceString(parent.from, parent.to)).toContain('%% fold-stop 4 %%');
  expect(state.doc.sliceString(parent.to)).toBe('\n---\nTail');
 });
 it('with the setting off the stock range hides the marker and the tail (criterion 3)', () => {
  expect(rangeAt(make(DOC, { endMarkers: false }))).toBeNull();
  let state = make(DOC, { endMarkers: false });
  state = state.update({ effects: foldEffect.of({ from: 3, to: state.doc.length }) }).state;
  const cursor = foldedRanges(state).iter();
  expect([cursor.from, cursor.to]).toEqual([3, DOC.length]);
 });
 it('gives no custom range after the restore command or with the vault rule off (criteria 4 and 12)', () => {
  expect(rangeAt(make(DOC, { enabled: false }))).toBeNull();
  expect(rangeAt(make(DOC, { rule: { vaultEnabled: false, folders: [], overrideProperty: '' } }))).toBeNull();
  expect(rangeAt(make(DOC, { rule: { vaultEnabled: false, folders: [], overrideProperty: 'fold-stop' }, noteOverride: true }))).toEqual({ from: 3, to: 9 });
 });
 it('clips a native fold effect at the marker and keeps the text', () => {
  let state = make(DOC);
  state = state.update({ effects: foldEffect.of({ from: 3, to: DOC.length }) }).state;
  const cursor = foldedRanges(state).iter();
  expect([cursor.from, cursor.to]).toEqual([3, 9]);
  expect(state.doc.toString()).toBe(DOC);
 });
 it('a heading with a marker directly below it has no body to hide', () => {
  let state = make('# A\n%% fold-stop %%\nTail');
  expect(rangeAt(state)).toBeNull();
  state = state.update({ effects: foldEffect.of({ from: 3, to: state.doc.length }) }).state;
  expect(foldedRanges(state).size).toBe(0);
  expect(state.doc.toString()).toBe('# A\n%% fold-stop %%\nTail');
 });
 it('an edit before a marker shifts the stop line (criterion 8)', () => {
  let state = make(DOC);
  state = state.update({ effects: foldEffect.of(rangeAt(state)!) }).state;
  state = state.update({ changes: { from: 4, insert: 'Added\n' } }).state;
  const cursor = foldedRanges(state).iter();
  expect(state.doc.sliceString(cursor.from, cursor.to)).toBe('\nAdded\nBody\n');
  expect(rangeAt(state)).toEqual({ from: 3, to: 15 });
  expect(foldStopForText(state.doc.toString(), 1, 1)).toEqual({ stop: 5, kind: 'marker' });
 });
 it('an edit that opens a comment above the marker removes the stop', () => {
  let state = make(DOC);
  state = state.update({ changes: { from: 4, insert: '%%\n' } }).state;
  expect(rangeAt(state)).toBeNull();
  state = state.update({ changes: { from: 4, to: 7 } }).state;
  expect(rangeAt(state)).toEqual({ from: 3, to: 9 });
 });
 it('typing a marker adds the stop and changes no other text', () => {
  let state = make('# A\nBody\n\nTail');
  expect(rangeAt(state)).toBeNull();
  state = state.update({ changes: { from: 10, insert: '%% fold-stop %%\n' } }).state;
  expect(state.doc.toString()).toBe(DOC);
  expect(rangeAt(state)).toEqual({ from: 3, to: 9 });
 });
});

describe('incremental parse with markers', () => {
 it('gives the same scan as a full parse after random edits', () => {
  const pieces = ['%% fold-stop %%\n', '%% fold-stop 3 %%\n', '%%\n', 'a %% b\n', '# A\n', '### C\n', 'text\n', '\n', '---\n', '```\n', '    x\n', '> q\n', '- i\n', '  %% fold-stop %%\n'];
  let seed = 3;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 300; run++) {
   let doc = Array.from({ length: 25 }, () => pieces[rand(pieces.length)]).join('');
   let parse = parseTopLevel(doc);
   for (let step = 0; step < 20; step++) {
    const from = rand(doc.length + 1);
    const to = Math.min(doc.length, from + rand(6));
    const insert = rand(2) ? pieces[rand(pieces.length)]! : '';
    const next = doc.slice(0, from) + insert + doc.slice(to);
    const delta = insert.length - (to - from);
    parse = parseTopLevel(next, parse, [{ fromA: from, toA: to, fromB: from, toB: from + insert.length }], pos => pos <= from ? pos : pos >= to ? pos + delta : from);
    doc = next;
    expect(parse.scan).toEqual(scanTopLevel(doc));
   }
  }
 });
});
