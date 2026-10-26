// A keystroke must not parse a large note twice from the start. The incremental parse must give the full-parse result.
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldable } from '@codemirror/language';
import { parser } from '@lezer/markdown';
import { editorInfoField } from 'obsidian';
import { foldStopExtension, type FoldStopConfig } from '../src/extension';
import { parseTopLevel, scanTopLevel } from '../src/boundaries';

vi.mock('obsidian', async () => {
 const original = await import('obsidian-test-mocks/obsidian');
 const { StateField } = await import('@codemirror/state');
 return { ...original, editorInfoField: StateField.define({ create: () => ({ file: { path: 'A.md' } }), update: value => value }) };
});

const CONFIG: FoldStopConfig = { enabled: true, endMarkers: true, rule: { vaultEnabled: true, folders: [], overrideProperty: '' } };
const BIG = Array.from({ length: 20000 }, (_, i) => i % 50 === 0 ? `## H${i}` : i % 97 === 0 ? '---' : `Line ${i} with **text**`).join('\n');

describe('incremental parse', () => {
 it('parses once for each keystroke and reuses the last tree', () => {
  let state = EditorState.create({ doc: BIG, extensions: [editorInfoField, codeFolding(), foldStopExtension(() => CONFIG)] });
  const spy = vi.spyOn(parser, 'parse');
  for (let k = 0; k < 5; k++) state = state.update({ changes: { from: 5000 + k, insert: 'x' } }).state;
  expect(spy).toHaveBeenCalledTimes(5);
  for (const call of spy.mock.calls) expect((call[1] ?? []).length).toBeGreaterThan(0);
  spy.mockRestore();
 });

 it('gives the same scan as a full parse after random edits', () => {
  const pieces = ['---\n', 'title: x\n', '# A\n', '## B\n', 'text\n', '\n', '***\n', '```\n', '    code\n', '> quote\n', '- item\n', '...\n', 'Setext\n', '===\n'];
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 400; run++) {
   let doc = Array.from({ length: 30 }, () => pieces[rand(pieces.length)]).join('');
   let parse = parseTopLevel(doc);
   for (let step = 0; step < 25; step++) {
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

 it('gives the same fold ranges as a new editor after multi-cursor edits', () => {
  const pieces = ['---\n', 'a: 1\n', '# A\n', '## B\n', 'text\n', '\n', '___\n', '~~~\n', '    x\n', '> q\n', '1. n\n', 'S\n', '---\n'];
  let seed = 11;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const make = (doc: string) => EditorState.create({ doc, extensions: [editorInfoField, codeFolding(), foldStopExtension(() => CONFIG)] });
  const folds = (state: EditorState) => Array.from({ length: state.doc.lines }, (_, i) => foldable(state, state.doc.line(i + 1).from, state.doc.line(i + 1).to));
  for (let run = 0; run < 150; run++) {
   let state = make(Array.from({ length: 25 }, () => pieces[rand(pieces.length)]).join(''));
   for (let step = 0; step < 10; step++) {
    const len = state.doc.length;
    const points = [rand(len + 1), rand(len + 1), rand(len + 1)].sort((x, y) => x - y);
    const changes = [...new Set(points)].map(from => ({ from, to: Math.min(len, from + rand(3)), insert: rand(2) ? pieces[rand(pieces.length)]! : '' }))
     .filter((c, i, all) => i === 0 || c.from >= all[i - 1]!.to);
    state = state.update({ changes }).state;
    expect(folds(state)).toEqual(folds(make(state.doc.toString())));
   }
  }
 });
});
