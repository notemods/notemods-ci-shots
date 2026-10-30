// The DOM part of Line Cut Guard: one capture listener for "cut" and "copy" on each window, one for "keydown", and
// the two line commands. The rules are in guard.ts.
//
// Platform facts (Obsidian 1.14.5 app.js):
// - The line cut and line copy of the editor is the CodeMirror 6 handler: with every selection range empty it copies
//   whole lines, and for "cut" it deletes them. CodeMirror listens on its content element, so a capture listener on
//   the window sees the event first. Stopping it there means that the note and the clipboard do not change.
// - Obsidian listens to "copy" on the window (bubble phase) and skips an event that is defaultPrevented.
// - A table cell range (class is-selected) and a selected image (class mod-image-selected on the editor) are
//   selections for the user, while the CodeMirror selection is a cursor. The plugin lets them through.
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { Platform, editorInfoField, type App } from 'obsidian';
import { lineRanges, mayNotify, noticeText, nothingSelected, shortcutKind, step, type Kind, type Mode, type Pending } from './guard';

export interface GuardOptions {
	/** False while the plugin is off or unloading: the guard does nothing. */
	active: boolean;
	cut: Mode;
	copy: Mode;
	notice: boolean;
	pro: boolean;
}

/** Elements that a user sees as selected while the CodeMirror selection is empty. */
const MARKED = '.cm-table-widget.is-selected, .cm-table-widget .is-selected, .cm-table-widget .has-selection, .cm-table-widget.has-selection, .mod-image-selected, .image-embed.is-selected, .internal-embed.is-selected';

/** Where a cut or copy happens, and whether nothing is selected there. */
export interface Place {
	token: string;
	nothing: boolean;
}

/** The element of an event target: the element itself, or the parent of a text node. No instanceof, so popout windows work. */
function elementOf(target: EventTarget | null): Element | null {
	const node = target as Node | null;
	if (!node || typeof node.nodeType !== 'number') return null;
	return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/** The outermost editor around dom (a table cell editor sits inside the note editor). */
function outerEditor(dom: Element): Element {
	let top = dom;
	for (let p = top.parentElement?.closest('.cm-editor'); p; p = p.parentElement?.closest('.cm-editor')) top = p;
	return top;
}

/** True when the editor shows a selected table, table cells or image (Obsidian class names). */
export function markedIn(dom: Element): boolean {
	const top = outerEditor(dom);
	return top.querySelector(MARKED) !== null || top.closest('.mod-image-selected') !== null;
}

/**
 * Fail open: true when something else may be selected, without the class names of markedIn. If Obsidian renames its
 * classes, these checks still let the cut through.
 * - A read-only editor: Obsidian makes the cell editor read-only while a cell range is selected (app.js
 *   updateCellReadonly). A read-only editor also has no line to lose.
 * - A cursor at the start of an embed ("![" ): Obsidian puts the cursor there while an image is selected.
 * - An editor inside another editor that is not a table cell: an unknown widget.
 */
export function maybeSelected(view: EditorView): boolean {
	if (view.state.readOnly) return true;
	const top = outerEditor(view.dom);
	if (top !== view.dom && !(view.dom.closest('.cm-table-widget') && view.dom.closest('td, th'))) return true;
	return view.state.selection.ranges.some((r) => view.state.sliceDoc(r.from, r.from + 2) === '![');
}

/**
 * The editor view of a DOM element in its text, or null. An input or another editable element inside the editor (a
 * property value, for example) is not editor text.
 */
export function editorAt(el: Element | null): EditorView | null {
	const content = el?.closest('.cm-content');
	if (!el || !content) return null;
	const editable = el.closest('input, textarea, select, [contenteditable]');
	if (editable && editable !== content) return null;
	const dom = content.closest('.cm-editor');
	if (!dom) return null;
	return EditorView.findFromDOM(dom as HTMLElement);
}

/** True when the document has selected text that the browser shows (also text in a rendered embed). */
function domSelection(doc: Document): boolean {
	const sel = doc.getSelection();
	return !!sel && sel.rangeCount > 0 && !sel.isCollapsed;
}

export class ClipGuard {
	private pending: Pending | null = null;
	private lastKey: { kind: Kind; time: number; repeat: boolean } | null = null;
	private lastNotice: number | null = null;
	private readonly ids = new WeakMap<object, number>();
	private nextId = 1;

	constructor(
		private readonly app: App,
		private readonly options: () => GuardOptions,
		private readonly notify: (text: string) => void,
		private readonly now: () => number = () => Date.now(),
	) {}

	/** Forgets a first press and the notice time (settings changed). */
	reset(): void {
		this.pending = null;
		this.lastKey = null;
		this.lastNotice = null;
	}

	private id(o: object): number {
		let n = this.ids.get(o);
		if (n === undefined) {
			n = this.nextId++;
			this.ids.set(o, n);
		}
		return n;
	}

	/** Keydown, capture phase: notes the last Ctrl/Cmd+X or C and whether it is a held key. */
	readonly onKeyDown = (e: KeyboardEvent): void => {
		const kind = shortcutKind(e.code ?? '', e.key ?? '', e.ctrlKey, e.metaKey, e.altKey, e.shiftKey, Platform.isMacOS);
		if (kind) this.lastKey = { kind, time: this.now(), repeat: e.repeat };
	};

	/** The place of a cut or copy, or null when the plugin does not act there. */
	locate(target: EventTarget | null): Place | null {
		const el = elementOf(target);
		if (!el) return null;
		const view = editorAt(el);
		if (view) {
			const ranges = view.state.selection.ranges.map((r) => [r.from, r.to] as const);
			// Text selected in a rendered part of the note (an embed in Live Preview) is a browser selection, while the
			// editor selection is a cursor. It counts as a selection.
			const marked = markedIn(view.dom) || maybeSelected(view) || domSelection(el.ownerDocument);
			// Same token = same view, same text and same selection. Other editor updates do not reset a first press.
			const sel = ranges.map(([a, b]) => `${a}-${b}`).join(',');
			return { token: `e${this.id(view)}:${this.id(view.state.doc)}:${sel}`, nothing: nothingSelected(ranges, marked) };
		}
		// Not in editor text: inputs, the file list, Canvas and Reading view keep their own cut and copy.
		return null;
	}

	/** Cut and copy, capture phase on the window. */
	readonly onClipboard = (e: ClipboardEvent): void => {
		// Synthetic events: the line commands of this plugin and the copy that Obsidian sends on again.
		if (!e.isTrusted) return;
		if (e.type !== 'cut' && e.type !== 'copy') return;
		const kind: Kind = e.type;
		const o = this.options();
		if (!o.active || o[kind] === 'allow') return;
		const place = this.locate(e.target);
		if (!place) return;
		const now = this.now();
		const key = this.lastKey && this.lastKey.kind === kind && now - this.lastKey.time < 1000 ? this.lastKey : null;
		this.lastKey = null;
		const out = step({ kind, mode: o[kind], pro: o.pro, nothingSelected: place.nothing, token: place.token, now, repeat: key?.repeat ?? false, pending: this.pending });
		this.pending = out.pending;
		if (out.action === 'stop') {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
		// "Press again" is the only hint of the second press mode, so it shows also with notices off.
		if (out.message && (o.notice || out.message === 'press-again') && mayNotify(this.lastNotice, now, out.message)) {
			this.lastNotice = now;
			this.notify(noticeText(kind, out.message, Platform.isMacOS ? 'Cmd' : 'Ctrl'));
		}
	};
}

/** Editor views of open notes, for the commands (an Editor gives no public way to its view). */
const views = new Set<EditorView>();

/**
 * Tracks the editor views. onView runs when a view is created and on each update (cheap: the caller checks a set), so
 * the caller can listen in the document of the view. A Canvas card edits in an iframe with its own document.
 */
export function viewRegistry(onView: (view: EditorView) => void = () => {}, onGone: (view: EditorView) => void = () => {}): Extension {
	return ViewPlugin.define((view) => {
		views.add(view);
		onView(view);
		return {
			update: (u) => onView(u.view),
			destroy: () => {
				views.delete(view);
				onGone(view);
			},
		};
	});
}

export function clearViews(): void {
	views.clear();
}

/** The view of the focused editor text (also a table cell), else the view of the editor. */
export function viewFor(editor: unknown, doc: Document): EditorView | null {
	const focused = editorAt(elementOf(doc.activeElement));
	if (focused) return focused;
	for (const view of views) if (view.state.field(editorInfoField, false)?.editor === editor) return view;
	return null;
}

export type LineResult = 'done' | 'marked' | 'no-clipboard';

/**
 * The line commands: cut or copy the selected text, or with nothing selected the line of each cursor, as Obsidian does
 * on Ctrl/Cmd+X and C. They work whatever the settings. The text comes from the CodeMirror copy handler (a synthetic
 * copy event with its own DataTransfer), so a later paste of the same text puts whole lines above the cursor, as after
 * Ctrl/Cmd+X. The clipboard is written first; a cut deletes the text only after that write worked.
 */
export async function lineCommand(view: EditorView, kind: Kind, write: (text: string) => Promise<void>): Promise<LineResult> {
	if (markedIn(view.dom)) return 'marked';
	// CodeMirror handles a copy only while the DOM selection is in the editor. After the command palette closes, the
	// focus may not be back yet: give the editor the focus, and wait one frame if CodeMirror still did not handle it.
	if (!view.hasFocus) view.focus();
	let handled = copyThroughEditor(view);
	if (handled === null) {
		await new Promise<void>((r) => (view.dom.ownerDocument.defaultView ?? window).requestAnimationFrame(() => r()));
		if (!view.hasFocus) view.focus();
		handled = copyThroughEditor(view);
	}
	const state = view.state;
	const empty = state.selection.ranges.every((r) => r.empty);
	let ranges: Array<[number, number]>;
	let text: string;
	if (empty) {
		const lines = lineRanges(state.doc.toString(), state.selection.ranges.map((r) => r.from), state.lineBreak);
		ranges = lines.ranges;
		text = lines.text;
	} else {
		const parts = state.selection.ranges.filter((r) => !r.empty);
		ranges = parts.map((r) => [r.from, r.to]);
		text = parts.map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak);
	}
	// CodeMirror also applies the clipboard filters of Obsidian. Use its text when it handled the event.
	if (handled) text = handled;
	try {
		await write(text);
	} catch {
		return 'no-clipboard';
	}
	if (kind === 'cut' && !view.state.readOnly && view.state.doc === state.doc) {
		view.dispatch({ changes: ranges.map(([from, to]) => ({ from, to })), scrollIntoView: true, userEvent: 'delete.cut' });
	}
	return 'done';
}

/**
 * Sends a synthetic copy event with its own DataTransfer to the CodeMirror handler. CodeMirror then remembers the text
 * as a line copy, so that Ctrl/Cmd+V of the same text pastes whole lines. Returns its text, "" for an empty line, or
 * null when CodeMirror did not handle the event.
 */
function copyThroughEditor(view: EditorView): string | null {
	try {
		const data = new DataTransfer();
		const ev = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
		view.contentDOM.dispatchEvent(ev);
		return ev.defaultPrevented ? data.getData('text/plain') : null;
	} catch {
		// No DataTransfer constructor on this platform.
		return null;
	}
}
