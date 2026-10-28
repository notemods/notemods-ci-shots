// The link to three parts of Obsidian that are not in obsidian.d.ts. Each part is checked before use. When one is
// missing, ready() is false and the plugin changes nothing (main.ts shows one notice).
//
// Facts from Obsidian 1.14.5 (app.js), tested on 1.13.4 and the latest version in CI:
// 1. Editor.addHighlights(ranges, cls, removePrevious) adds a mark to a core StateField (the field of the search
//    highlights). It dispatches one transaction with a filter effect and an add effect.
// 2. Live Preview does not draw the table widget when a mark with the class "obsidian-search-match-highlight" from
//    that field touches the table range. This is how a search match in a table shows the table text.
// 3. The table widget has receiveSelection(transaction). A widget that is not drawn still gets the call, and moves the
//    focus into a cell editor when the cursor is in its range. The plugin skips that call for a table that it shows
//    as text.
import type { Range, StateEffect, StateEffectType, Transaction } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { EditorPosition } from 'obsidian';

/** The class of the core search highlight. Live Preview skips the table widget for a mark of exactly this class. */
export const MATCH_CLASS = 'obsidian-search-match-highlight';

type Keep = (from: number, to: number, value: Decoration) => boolean;

export interface CoreHighlights {
	/** Adds marks to the core highlight field. */
	add: StateEffectType<Range<Decoration>[]>;
	/** Keeps only the marks for which the function returns true. */
	filter: StateEffectType<Keep>;
	/** The shared mark of MATCH_CLASS. Live Preview compares marks by identity with this value. */
	mark: Decoration;
}

interface HighlightEditor {
	addHighlights(ranges: { from: EditorPosition; to: EditorPosition }[], cls: string, removePrevious?: boolean, range?: unknown): void;
}

let highlights: CoreHighlights | null = null;

/** The captured core types, or null before capture() works. */
export function coreHighlights(): CoreHighlights | null {
	return highlights;
}

/** True when the plugin can show a table as text in this Obsidian version. */
export function ready(): boolean {
	return highlights !== null && widgetPatched;
}

function effectType(e: StateEffect<unknown>): StateEffectType<unknown> | null {
	const t = (e as unknown as { type?: unknown }).type;
	return t && typeof t === 'object' ? (t as StateEffectType<unknown>) : null;
}

/**
 * Reads the core effect types from one call of editor.addHighlights. The call goes to a stub dispatch, so the editor
 * does not change. Needs a note with at least one character. Returns true when the types are known.
 */
export function capture(view: EditorView, editor: unknown): boolean {
	if (highlights) return true;
	const ed = editor as Partial<HighlightEditor> | null;
	if (!ed || typeof ed.addHighlights !== 'function') return false;
	const doc = view.state.doc;
	if (doc.length < 1) return false;
	const first = doc.line(1);
	const to: EditorPosition = first.length > 0 ? { line: 0, ch: 1 } : { line: 1, ch: 0 };
	let spec: unknown = null;
	// The stub takes the place of view.dispatch for this one call. CodeMirror binds dispatch on the view object.
	const slot = view as unknown as Record<string, unknown>;
	const own = Object.prototype.hasOwnProperty.call(slot, 'dispatch');
	const real = slot.dispatch;
	slot.dispatch = (...args: unknown[]): void => {
		spec = args[0];
	};
	try {
		ed.addHighlights([{ from: { line: 0, ch: 0 }, to }], MATCH_CLASS, true);
	} catch {
		return false;
	} finally {
		if (own) slot.dispatch = real;
		else delete slot.dispatch;
	}
	const effects = (spec as { effects?: unknown } | null)?.effects;
	if (!Array.isArray(effects)) return false;
	let add: StateEffectType<Range<Decoration>[]> | null = null;
	let filter: StateEffectType<Keep> | null = null;
	let mark: Decoration | null = null;
	for (const e of effects as StateEffect<unknown>[]) {
		const type = effectType(e);
		if (!type) continue;
		if (Array.isArray(e.value)) {
			const r = (e.value as Range<Decoration>[])[0];
			if (r && r.value instanceof Decoration) {
				add = type as StateEffectType<Range<Decoration>[]>;
				mark = r.value;
			}
		} else if (typeof e.value === 'function') {
			filter = type as StateEffectType<Keep>;
		}
	}
	if (!add || !filter || !mark) return false;
	highlights = { add, filter, mark };
	return true;
}

/** Answers "does the plugin show the table that starts at this position as text, in this transaction?". */
export type ShownAsText = (tr: Transaction, tableStart: number) => boolean;

interface TableWidget {
	start?: unknown;
	receiveSelection(tr: Transaction): void;
	containsSelection(sel: unknown): boolean;
}

let widgetProto: TableWidget | null = null;
let originalReceive: ((this: TableWidget, tr: Transaction) => void) | null = null;
let widgetPatched = false;
let shownAsText: ShownAsText | null = null;

function isTableWidget(w: unknown): w is TableWidget {
	const o = w as Partial<TableWidget> | null;
	return !!o && typeof o.receiveSelection === 'function' && typeof o.containsSelection === 'function';
}

/** A table widget object that Live Preview draws in the view, or null when no table is drawn. */
function findWidget(view: EditorView): TableWidget | null {
	let found: TableWidget | null = null;
	for (const source of view.state.facet(EditorView.decorations)) {
		const set = typeof source === 'function' ? source(view) : source;
		set.between(0, view.state.doc.length, (_f, _t, deco) => {
			const w = (deco.spec as { widget?: unknown }).widget;
			if (isTableWidget(w)) {
				found = w;
				return false;
			}
			return undefined;
		});
		if (found) break;
	}
	return found;
}

/**
 * Wraps receiveSelection of the table widget class once: the call does nothing for a table that the plugin shows as
 * text. The class comes from a widget that Live Preview draws in the view. Returns 'ok' when the wrap is in place,
 * 'retry' when no table widget is drawn now, and 'unsupported' when the widget has no receiveSelection of its own.
 */
export function patchWidget(view: EditorView, check: ShownAsText): 'ok' | 'retry' | 'unsupported' {
	shownAsText = check;
	if (widgetPatched) return 'ok';
	const w = findWidget(view);
	if (!w) return 'retry';
	const proto = Object.getPrototypeOf(w) as TableWidget;
	if (!Object.prototype.hasOwnProperty.call(proto, 'receiveSelection')) return 'unsupported';
	widgetProto = proto;
	const original = (proto as unknown as Record<string, unknown>).receiveSelection as (this: TableWidget, tr: Transaction) => void;
	originalReceive = original;
	proto.receiveSelection = function (this: TableWidget, tr: Transaction): void {
		const start = typeof this.start === 'number' ? this.start : -1;
		if (shownAsText && start >= 0 && shownAsText(tr, start)) return;
		original.call(this, tr);
	};
	widgetPatched = true;
	return 'ok';
}

/** Restores the table widget class (plugin unload). */
export function unpatchWidget(): void {
	if (widgetProto && originalReceive) widgetProto.receiveSelection = originalReceive;
	widgetProto = null;
	originalReceive = null;
	widgetPatched = false;
	shownAsText = null;
}

/** Forgets the captured types (plugin unload). */
export function resetCore(): void {
	unpatchWidget();
	highlights = null;
}
