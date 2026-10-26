import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { cleanupSpec, guardPlan, ownedField, ownershipHistory } from '../src/guard';

export type Step = 'space' | 'leave' | 'off' | 'unload' | 'undo' | 'redo' | 'multi' | 'compose' | 'end-compose';
/** Golden vectors run the real guard plan and the CodeMirror history field. */
export function runScenario(doc: string, caret: number, steps: Step[] = []): { text: string; owned: number; undoDepth: number } {
	let state = EditorState.create({ doc, selection: { anchor: caret }, extensions: [ownedField, ownershipHistory, history(), EditorState.allowMultipleSelections.of(true)] });
	let enabled = true;
	let blocked = false;
	const maintain = () => { for (let i = 0; i < 3; i++) { const spec = guardPlan(state, enabled, blocked); if (!spec) break; state = state.update(spec).state; } };
	if (steps[0] !== 'compose' && steps[0] !== 'multi') maintain();
	for (const step of steps) {
		if (step === 'space') { const pos = state.selection.main.head; state = state.update({ changes: { from: pos, insert: ' ' }, selection: { anchor: pos + 1 }, userEvent: 'input.type' }).state; }
		if (step === 'leave') state = state.update({ selection: { anchor: state.doc.length } }).state;
		if (step === 'off') enabled = false;
		if (step === 'unload') { const spec = cleanupSpec(state); if (spec) state = state.update(spec).state; enabled = false; }
		if (step === 'undo' || step === 'redo') (step === 'undo' ? undo : redo)({ state, dispatch: (tr: Transaction) => { state = tr.state; } });
		if (step === 'multi') state = state.update({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(caret)]) }).state;
		if (step === 'compose') blocked = true;
		if (step === 'end-compose') blocked = false;
		maintain();
	}
	return { text: state.doc.toString(), owned: state.field(ownedField).length, undoDepth: undoDepth(state) };
}
