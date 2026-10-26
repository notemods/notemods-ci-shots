import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo, undoDepth } from '@codemirror/commands';
import { GuardController, cleanupSpec, guardPlan, ownedField } from '../src/guard';

const controllers: GuardController[] = [];
afterEach(() => { for (const c of controllers.splice(0)) { c.stop(); for (const v of c.views) v.destroy(); } });
function harness(doc = 'A $x{}+y$ end', cursor = 3) {
	let enabled = true;
	const c = new GuardController({ eligible: () => enabled }); controllers.push(c);
	const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [history(), EditorState.allowMultipleSelections.of(true), c.extension] }), parent: document.body });
	view.dispatch({ selection: { anchor: cursor } });
	return { view, c, off() { enabled = false; c.refresh(); } };
}
function space(view: EditorView) { const at = view.state.selection.main.head; view.dispatch({ changes: { from: at, insert: ' ' }, selection: { anchor: at + 1 }, userEvent: 'input.type' }); }
async function settle() { await Promise.resolve(); await Promise.resolve(); }

describe('owned source guards', () => {
	it('guards the opening boundary, hides only owned braces and keeps user braces', () => {
		const { view, c } = harness();
		expect(view.state.doc.toString()).toBe('A ${}x{}+y{}$ end');
		expect(view.state.selection.main.head).toBe(5);
		expect(view.state.field(ownedField)).toHaveLength(4);
		expect(c.cleanText(view)).toBe('A $x{}+y$ end');
		expect(undoDepth(view.state)).toBe(0);
		expect(view.contentDOM.textContent).toContain('x{}+y');
		expect(view.contentDOM.textContent).not.toContain('${}');
	});
	it('keeps a leading space and cleans on cursor exit', () => {
		const { view } = harness('A $x$ end'); space(view);
		expect(view.state.doc.toString()).toBe('A ${} x{}$ end');
		view.dispatch({ selection: { anchor: view.state.doc.length } });
		expect(view.state.doc.toString()).toBe('A $ x$ end');
		expect(view.state.field(ownedField)).toEqual([]);
	});
	it('keeps a trailing space before the closing guard', () => {
		const { view } = harness('A $x$ end', 4); space(view);
		expect(view.state.doc.toString()).toBe('A ${}x {}$ end');
		view.dispatch({ selection: { anchor: 0 } });
		expect(view.state.doc.toString()).toBe('A $x $ end');
	});
	it('Undo and Redo use one event and keep the caret', () => {
		const { view } = harness('A $x$ end'); const start = view.state.selection.main.head; space(view);
		expect(undoDepth(view.state)).toBe(1);
		expect(undo(view)).toBe(true);
		expect(view.state.doc.toString()).toBe('A ${}x{}$ end');
		expect(view.state.selection.main.head).toBe(start);
		expect(undo(view)).toBe(false);
		expect(redo(view)).toBe(true);
		expect(view.state.doc.toString()).toBe('A ${} x{}$ end');
		expect(view.state.selection.main.head).toBe(start + 1);
	});
	it('Undo after cleanup removes only the space; Redo keeps source clean after exit', async () => {
		const { view, c } = harness('A $x$ end'); space(view); view.dispatch({ selection: { anchor: 0 } });
		expect(undo(view)).toBe(true); await settle();
		expect(c.cleanText(view)).toBe('A $x$ end');
		expect(redo(view)).toBe(true); await settle(); view.dispatch({ selection: { anchor: 0 } });
		expect(view.state.doc.toString()).toBe('A $ x$ end');
	});
	it('edits before the equation map owned positions', () => {
		const { view, c } = harness(); view.dispatch({ changes: { from: 0, insert: 'Intro ' } });
		expect(c.cleanText(view)).toBe('Intro A $x{}+y$ end'); c.stop();
		expect(view.state.doc.toString()).toBe('Intro A $x{}+y$ end');
	});
	it('inserting user text inside an owned pair keeps the inserted text', () => {
		const { view, c } = harness('A $x$ end'); view.dispatch({ changes: { from: 4, insert: 'user' } }); c.stop();
		expect(view.state.doc.toString()).toBe('A $userx$ end');
	});
	it('partial deletion of an owned pair does not delete the adjacent text', () => {
		const { view, c } = harness('A $x$ end'); view.dispatch({ changes: { from: 3, to: 4 } }); c.stop();
		expect(view.state.doc.toString()).toBe('A $x$ end');
	});
	it('Undo of a deleted guard restores ownership', async () => {
		const { view, c } = harness('A $x$ end'); view.dispatch({ changes: { from: 3, to: 4 }, userEvent: 'delete.backward' });
		expect(undo(view)).toBe(true); await settle(); c.stop();
		expect(view.state.doc.toString()).toBe('A $x$ end');
	});
	it('deleting the equation then Undo does not leave owned braces', async () => {
		const { view, c } = harness('A $x$ end'); view.dispatch({ changes: { from: 2, to: 9 }, selection: { anchor: 2 }, userEvent: 'delete' }); await settle();
		expect(view.state.doc.toString()).toBe('A  end'); expect(undo(view)).toBe(true); await settle(); c.stop();
		expect(view.state.doc.toString()).toBe('A $x$ end');
	});
	it('multiple selections do not cause guard text changes', () => {
		const { view } = harness('A $x$ end'); const text = view.state.doc.toString();
		view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)]) });
		expect(view.state.doc.toString()).toBe(text);
	});
	it('disabling cleans the guard and retains user braces', () => { const { view, off } = harness(); off(); expect(view.state.doc.toString()).toBe('A $x{}+y$ end'); });
	it('unloading cleans while the caret is inside', () => { const { view, c } = harness(); c.stop(); expect(view.state.doc.toString()).toBe('A $x{}+y$ end'); });
	it('composition blocks source maintenance until it ends', async () => {
		const { view, c } = harness('A $x$ end', 0);
		view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		view.dispatch({ selection: { anchor: 3 } }); await settle();
		expect(view.state.doc.toString()).toBe('A $x$ end');
		view.dispatch({ changes: { from: 3, insert: '日' }, selection: { anchor: 4 }, userEvent: 'input.type.compose' }); await settle();
		expect(c.cleanText(view)).toBe('A $日x$ end'); expect(view.state.field(ownedField)).toEqual([]);
		view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 20)); await settle();
		expect(view.state.field(ownedField)).toHaveLength(4);
		c.stop(); expect(view.state.doc.toString()).toBe('A $日x$ end');
	});
	it('selected text is not guarded', () => { const { view } = harness('A $x$ end', 0); view.dispatch({ selection: { anchor: 3, head: 4 } }); expect(view.state.doc.toString()).toBe('A $x$ end'); });
	it('no cleanup exists when this instance owns nothing', () => { const s = EditorState.create({ doc: '$x{}$', extensions: [ownedField] }); expect(cleanupSpec(s)).toBeNull(); expect(guardPlan(s, false)).toBeNull(); });
	it.each(['`$x$`', '$$x$$', '| $x$ |', '\\$5', '```\n$x$\n```', '# $x$', '> $x$', '- $x$', '    $x$', '$x', '$ $'])('skips uncertain markup %s', (doc) => {
		const { view } = harness(doc, Math.max(1, doc.indexOf('x'))); expect(view.state.doc.toString()).toBe(doc);
	});
});

describe('source edit safety', () => {
	it('range edits, Undo and Redo keep user text across guard cleanup', async () => {
		const source = 'A $x{}+y$ end';
		for (let from = 0; from <= 17; from++) for (let to = from; to <= 17; to++) {
			const { view, c } = harness(source);
			const before = view.state.doc.toString();
			const owned = new Set(view.state.field(ownedField).map((ch) => ch.pos));
			const expected = before.split('').filter((_ch, pos) => !owned.has(pos) && (pos < from || pos >= to));
			const prefix = before.slice(0, from).split('').filter((_ch, pos) => !owned.has(pos)).join('');
			const suffix = before.slice(to).split('').filter((_ch, pos) => !owned.has(pos + to)).join('');
			view.dispatch({ changes: { from, to, insert: '文{}' }, selection: { anchor: from + 3 }, userEvent: 'input' });
			await settle();
			expect(c.cleanText(view), `edit ${from}..${to}`).toBe(prefix + '文{}' + suffix);
			expect(expected.join('').length).toBe(prefix.length + suffix.length);
			expect(undo(view)).toBe(true); await settle();
			expect(c.cleanText(view), `undo ${from}..${to}`).toBe(source);
			expect(redo(view)).toBe(true); await settle(); c.stop();
			expect(view.state.doc.toString(), `redo ${from}..${to}`).toBe(prefix + '文{}' + suffix);
			view.destroy();
		}
	});
});


describe('editor focus', () => {
	it('cleans when focus leaves the editor and adds guards when focus returns', async () => {
		const c = new GuardController({ eligible: () => true, focusOnly: true }); controllers.push(c);
		const view = new EditorView({ state: EditorState.create({ doc: 'A $x$ end', extensions: [c.extension] }), parent: document.body });
		view.focus(); view.dispatch({ selection: { anchor: 3 } }); await settle(); expect(view.state.field(ownedField)).toHaveLength(4);
		const button = document.createElement('button'); document.body.appendChild(button); button.focus(); await settle(); expect(view.state.doc.toString()).toBe('A $x$ end');
		view.focus(); await settle(); expect(view.state.field(ownedField)).toHaveLength(4); c.stop(); button.remove();
	});
});

describe('closed editors', () => {
	it('reports the guarded and clean source when an editor closes with owned guards', () => {
		const lost: [string, string][] = [];
		const c = new GuardController({ eligible: () => true, onLost: (state, clean) => lost.push([state.doc.toString(), clean]) }); controllers.push(c);
		const view = new EditorView({ state: EditorState.create({ doc: 'A $x{}+y$ end', extensions: [c.extension] }), parent: document.body });
		view.dispatch({ selection: { anchor: 3 } }); view.destroy();
		expect(lost).toEqual([['A ${}x{}+y{}$ end', 'A $x{}+y$ end']]);
	});
	it('reports the guarded source when the caret leaves and cleanup runs', () => {
		const lost: [string, string][] = [];
		const c = new GuardController({ eligible: () => true, onLost: (state, clean) => lost.push([state.doc.toString(), clean]) }); controllers.push(c);
		const view = new EditorView({ state: EditorState.create({ doc: 'A $x$ end', extensions: [c.extension] }), parent: document.body });
		view.dispatch({ selection: { anchor: 3 } }); space(view); view.dispatch({ selection: { anchor: 0 } });
		expect(view.state.doc.toString()).toBe('A $ x$ end');
		expect(lost).toEqual([['A ${} x{}$ end', 'A $ x$ end']]);
		view.destroy();
	});
	it('reports nothing for a clean editor or after unload cleanup', () => {
		const lost: string[] = [];
		const c = new GuardController({ eligible: () => true, onLost: (_state, clean) => lost.push(clean) }); controllers.push(c);
		const view = new EditorView({ state: EditorState.create({ doc: 'A $x$ end', extensions: [c.extension] }), parent: document.body });
		view.destroy();
		const other = new EditorView({ state: EditorState.create({ doc: 'A $x$ end', extensions: [c.extension] }), parent: document.body });
		other.dispatch({ selection: { anchor: 3 } }); c.stop(); other.destroy();
		expect(lost).toEqual([]);
	});
});
