// CodeMirror 6 source editor for AsciiDoc. The app provides @codemirror/* at run time (esbuild marks them external).
import { Annotation, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, drawSelection, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { NO_BLOCK, type BlockState } from './adoc/blocks';
import { tokenizeLine } from './adoc/highlight';

/** Marks a change that came from the file (setViewData), so it is not saved back. */
export const fromFile = Annotation.define<boolean>();

/** Lines tokenized above the viewport to know the block state; past this the highlighter starts fresh. */
const MAX_LOOKBACK_LINES = 20000;

const marks = new Map<string, Decoration>();
function mark(cls: string): Decoration {
	let d = marks.get(cls);
	if (!d) {
		d = Decoration.mark({ class: cls.split(' ').map((c) => `adoc-tok-${c}`).join(' ') });
		marks.set(cls, d);
	}
	return d;
}

function decorate(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	const first = doc.lineAt(view.viewport.from).number;
	const last = doc.lineAt(view.viewport.to).number;
	let state: BlockState = NO_BLOCK;
	for (let n = Math.max(1, first - MAX_LOOKBACK_LINES); n <= last; n++) {
		const line = doc.line(n);
		const r = tokenizeLine(line.text, state);
		state = r.state;
		if (n < first) continue;
		for (const s of r.spans) builder.add(line.from + s.from, line.from + s.to, mark(s.cls));
	}
	return builder.finish();
}

const highlighter = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = decorate(view);
		}
		update(u: ViewUpdate): void {
			if (u.docChanged || u.viewportChanged) this.decorations = decorate(u.view);
		}
	},
	{ decorations: (v) => v.decorations },
);

export function editorExtensions(onChange: (text: string) => void): Extension[] {
	return [
		history(),
		drawSelection(),
		keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
		EditorView.lineWrapping,
		EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'off', 'aria-label': 'AsciiDoc source' }),
		highlighter,
		EditorView.updateListener.of((u) => {
			if (!u.docChanged || u.transactions.some((t) => t.annotation(fromFile))) return;
			onChange(u.state.doc.toString());
		}),
	];
}

export function createEditor(parent: HTMLElement, onChange: (text: string) => void): EditorView {
	return new EditorView({ parent, state: EditorState.create({ doc: '', extensions: editorExtensions(onChange) }) });
}

/** Replaces the whole text. clear = a different file: also drops the undo history. */
export function setEditorText(view: EditorView, text: string, clear: boolean, onChange: (text: string) => void): void {
	if (clear) {
		view.setState(EditorState.create({ doc: text, extensions: editorExtensions(onChange) }));
		return;
	}
	if (view.state.doc.toString() === text) return;
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: fromFile.of(true) });
}

/** Puts the cursor at the start of a 0-based line and scrolls it into view. */
export function revealLine(view: EditorView, line: number): void {
	const n = Math.max(1, Math.min(view.state.doc.lines, line + 1));
	const pos = view.state.doc.line(n).from;
	view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }) });
	view.focus();
}
