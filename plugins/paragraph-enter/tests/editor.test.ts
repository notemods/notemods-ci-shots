import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { paragraphEnterExtension, planKey, treeAllowsParagraph, type EnterHost } from '../src/editor';
import type { LineBreakStyle } from '../src/enter';

/** A small stand-in for the Obsidian Markdown tokenizer: it emits the token names that Obsidian uses. */
const fakeMarkdown = StreamLanguage.define<{ code: boolean }>({
	startState: () => ({ code: false }),
	token(stream, state) {
		if (stream.sol() && stream.match('```')) { state.code = !state.code; stream.skipToEnd(); return 'formatting-code-block hmd-codeblock'; }
		if (state.code) { stream.skipToEnd(); return 'hmd-codeblock'; }
		if (stream.sol() && stream.match('- ')) return 'formatting formatting-list formatting-list-ul list-1';
		if (stream.sol() && stream.match('@@')) { stream.skipToEnd(); return 'hmd-frontmatter'; }
		if (stream.match('%%')) { stream.skipTo('%%'); stream.match('%%'); return 'comment'; }
		stream.next();
		return null;
	},
	// Obsidian registers its token names the same way. The node name joins the tokens with "_".
	tokenTable: Object.fromEntries(['formatting', 'formatting-code-block', 'hmd-codeblock', 'formatting-list', 'formatting-list-ul', 'list-1', 'hmd-frontmatter', 'comment'].map((t) => [t, tags.meta])),
});

const host = (enabled = true, style: LineBreakStyle = 'newline'): EnterHost => ({ enabled: () => enabled, lineBreakStyle: () => style });
const views: EditorView[] = [];
afterEach(() => { for (const v of views.splice(0)) v.destroy(); document.body.innerHTML = ''; });

function makeView(doc: string, cursor: number, h = host()): EditorView {
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [history(), EditorState.allowMultipleSelections.of(true), paragraphEnterExtension(h)] }) });
	views.push(view);
	return view;
}
/** Sends a key event to the editor. True when a keymap handled it (and so the Obsidian default did not run). */
function press(view: EditorView, key: string, init: KeyboardEventInit = {}): boolean {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
	view.contentDOM.dispatchEvent(event);
	return event.defaultPrevented;
}

describe('keymap in an editor view', () => {
	it('Enter at the end of a paragraph inserts a blank line', () => {
		const v = makeView('Hello', 5);
		expect(press(v, 'Enter')).toBe(true);
		expect(v.state.doc.toString()).toBe('Hello\n\n');
		expect(v.state.selection.main.head).toBe(7);
	});
	it('Shift+Enter uses the chosen style', () => {
		const v = makeView('Hello', 5, host(true, 'html'));
		expect(press(v, 'Enter', { shiftKey: true })).toBe(true);
		expect(v.state.doc.toString()).toBe('Hello<br>\n');
	});
	it('one Enter is one undo step', () => {
		const v = makeView('Hello', 5);
		press(v, 'Enter');
		undo(v);
		expect(v.state.doc.toString()).toBe('Hello');
		expect(v.state.selection.main.head).toBe(5);
	});
	it('a list item passes Enter to the default keymap', () => {
		const v = makeView('- item', 6);
		expect(press(v, 'Enter')).toBe(false);
		expect(v.state.doc.toString()).toBe('- item');
	});
	it('the setting off passes every key on', () => {
		const v = makeView('Hello', 5, host(false));
		expect(press(v, 'Enter')).toBe(false);
		expect(press(v, 'Enter', { shiftKey: true })).toBe(false);
	});
	it('an IME key event passes Enter on', () => {
		const v = makeView('Hello', 5);
		expect(press(v, 'Enter', { isComposing: true })).toBe(false);
		expect(v.state.doc.toString()).toBe('Hello');
		expect(press(v, 'Enter')).toBe(true);
	});
	it('an active composition in the view passes Enter on', () => {
		const v = makeView('Hello', 5);
		v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		expect(v.composing || v.compositionStarted).toBe(true);
		expect(press(v, 'Enter')).toBe(false);
		expect(v.state.doc.toString()).toBe('Hello');
	});
	it('Vim normal mode passes Enter on, insert mode does not', () => {
		const v = makeView('Hello', 5);
		v.scrollDOM.classList.add('cm-vimMode');
		expect(press(v, 'Enter')).toBe(false);
		v.scrollDOM.classList.remove('cm-vimMode');
		expect(press(v, 'Enter')).toBe(true);
	});
	it('an open suggestion popup keeps Enter', () => {
		const v = makeView('See [[No', 8);
		const pop = document.body.createDiv({ cls: 'suggestion-container' });
		pop.getClientRects = () => [{}] as unknown as DOMRectList;
		expect(press(v, 'Enter')).toBe(false);
		pop.remove();
		expect(press(v, 'Enter')).toBe(true);
	});
	it('an editor inside another editor (a Live Preview table cell) keeps its own Enter', () => {
		const outer = document.body.createDiv({ cls: 'cm-editor' });
		const cell = outer.createDiv({ cls: 'table-cell-wrapper' });
		const view = new EditorView({ parent: cell, state: EditorState.create({ doc: 'a', selection: { anchor: 1 }, extensions: [paragraphEnterExtension(host())] }) });
		views.push(view);
		expect(press(view, 'Enter')).toBe(false);
		expect(view.state.doc.toString()).toBe('a');
	});
	it('several cursors keep the default', () => {
		const v = makeView('Hello\n\nWorld', 5);
		v.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(5), EditorSelection.cursor(12)]) });
		expect(press(v, 'Enter')).toBe(false);
	});
});

describe('syntax tree context', () => {
	const state = (doc: string, cursor: number) => EditorState.create({ doc, selection: { anchor: cursor }, extensions: [fakeMarkdown] });
	it('a plain line is allowed', () => expect(treeAllowsParagraph(state('Plain text', 10), 10)).toBe(true));
	it('a list token blocks the line', () => expect(treeAllowsParagraph(state('- item', 6), 6)).toBe(false));
	it('a code block token blocks the line even when the text check cannot see it', () => {
		// "@@" lines are plain text for enter.ts, but the tree marks them as front matter.
		const s = state('@@ meta', 7);
		expect(treeAllowsParagraph(s, 7)).toBe(false);
		expect(planKey(s, 'Enter', host())).toBe('default');
	});
	it('the cursor in an inline comment keeps the default', () => expect(treeAllowsParagraph(state('A %%note%% b', 6), 6)).toBe(false));
	it('a line after a fenced block is allowed', () => {
		const doc = '```\nx\n```\nText';
		expect(treeAllowsParagraph(state(doc, doc.length), doc.length)).toBe(true);
		expect(treeAllowsParagraph(state(doc, 5), 5)).toBe(false);
	});
	it('without a parser (no Markdown language) the text check decides', () => {
		expect(treeAllowsParagraph(EditorState.create({ doc: 'Hello' }), 5)).toBe(true);
	});
});
