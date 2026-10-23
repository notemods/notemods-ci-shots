import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';
import vectors from './vectors/paragraph-enter.json';
import { enterAction, type CursorArg, type EnterSettings } from '../src/enter';
import { planKey, planSpec } from '../src/editor';

interface UndoCheck { typed: string; doc: string; cursor: number; steps: number }
interface Case { name: string; args: [string, CursorArg, EnterSettings]; expected: unknown; undo?: UndoCheck }

describe('golden acceptance vectors (packages/spec/vectors/paragraph-enter.json)', () => {
	const cases = vectors.cases as unknown as Case[];
	it('covers acceptance criteria 1 to 8', () => {
		for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) expect(cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
	});
	for (const c of cases) {
		it(c.name, () => expect(enterAction(...c.args)).toEqual(c.expected));
		it(`${c.name}: the editor plan matches`, () => {
			const [doc, cursor, settings] = c.args;
			const sel = typeof cursor === 'number' ? { anchor: cursor } : { anchor: cursor.anchor, head: cursor.head };
			const state = EditorState.create({ doc, selection: sel });
			const plan = planKey(state, settings.key ?? 'Enter', { enabled: () => settings.enabled, lineBreakStyle: () => settings.lineBreakStyle ?? 'newline' });
			expect(plan).toEqual(c.expected);
		});
	}
	for (const c of cases.filter((v) => v.undo)) {
		it(`${c.name}: real CodeMirror history`, () => {
			const u = c.undo!;
			let state = EditorState.create({ doc: '', extensions: [history()] });
			// Type the text one character at a time, fast, so that the history would merge it with Enter without isolation.
			for (const ch of u.typed) state = state.update({ changes: { from: state.doc.length, insert: ch }, selection: { anchor: state.doc.length + 1 }, userEvent: 'input.type' }).state;
			const before = undoDepth(state);
			const plan = enterAction(state.doc.toString(), state.selection.main.head, c.args[2]);
			if (plan === 'default') throw new Error('expected an edit');
			state = state.update(planSpec(plan)).state;
			expect(state.doc.toString()).toBe((c.expected as { doc: string }).doc);
			expect(undoDepth(state) - before).toBe(u.steps);
			undo({ state, dispatch: (tr: Transaction) => { state = tr.state; } });
			expect(state.doc.toString()).toBe(u.doc);
			expect(state.selection.main.head).toBe(u.cursor);
		});
	}
});
