// Live Preview (rules 6 to 9): the alias text stays editor text. The plugin hides the markup characters and puts a
// style class on the text between them, so core keeps its link decorations, its click and its hover preview. When
// the selection touches a link, the plugin adds nothing and the raw source shows, as core shows it.
import { syntaxTree } from '@codemirror/language';
import { StateEffect, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { Keymap, editorInfoField, editorLivePreviewField, type App } from 'obsidian';
import { planLine } from './markup';
import type { MathApi } from './reading';
import type { Options } from './settings';

/** Tells every editor to draw its decorations again (settings or Pro changed). */
export const redrawEffect = StateEffect.define<null>();

const views = new Set<EditorView>();

export function redrawViews(): void {
	for (const view of Array.from(views)) view.dispatch({ effects: redrawEffect.of(null) });
}

/** Core class and plugin class for each markup type. Themes style the core classes. */
export const MARK_CLASS: Record<string, string> = {
	code: 'cm-inline-code wam-code',
	strong: 'cm-strong wam-strong',
	em: 'cm-em wam-em',
	del: 'cm-strikethrough wam-del',
	mark: 'cm-highlight wam-mark',
};

const hide = Decoration.replace({});
const marks = new Map<string, Decoration>();
function markOf(type: string): Decoration {
	let deco = marks.get(type);
	if (!deco) {
		deco = Decoration.mark({ class: MARK_CLASS[type] ?? `wam-${type}` });
		marks.set(type, deco);
	}
	return deco;
}

/** Token names of Obsidian's parser where `[[` is not a link: code, math, comments, front matter. */
const NOT_LINK = /(?:^|_)(?:comment|math|inline-code|hmd-codeblock|hmd-frontmatter|formatting-code|hmd-html)(?:_|$)/;

/**
 * True when Obsidian's syntax tree marks `[[` at pos as the start of a link. The tree uses the same names as the
 * classes of Live Preview, without the `cm-` prefix.
 */
export function isLinkStart(state: EditorState, pos: number): boolean {
	const tree = syntaxTree(state);
	if (pos + 2 > tree.length) return false;
	const node = tree.resolveInner(pos + 1, 1);
	return /link/.test(node.name) && !NOT_LINK.test(node.name);
}

export interface EditorHost {
	app: App;
	options(): Options;
	math: MathApi;
}

/** Pro: inline math in an alias. A click opens the link; the pointer shows the hover preview, as on core link text. */
class MathWidget extends WidgetType {
	constructor(
		readonly host: EditorHost,
		readonly tex: string,
		readonly target: string,
	) {
		super();
	}

	eq(other: MathWidget): boolean {
		return other.tex === this.tex && other.target === this.target;
	}

	toDOM(view: EditorView): HTMLElement {
		const el = createSpan({ cls: 'wam-math cm-hmd-internal-link' });
		el.setAttribute('data-wam-target', this.target);
		el.setAttribute('aria-label', this.target);
		const info = view.state.field(editorInfoField, false);
		const sourcePath = info?.file?.path ?? '';
		void this.host.math.load().then(() => {
			if (!el.isConnected && !el.parentElement) return;
			el.empty();
			el.appendChild(this.host.math.render(this.tex));
			void this.host.math.finish();
		});
		el.textContent = `$${this.tex}$`;
		el.addEventListener('mouseover', (event) => {
			this.host.app.workspace.trigger('hover-link', { event, source: 'editor', hoverParent: info ?? null, targetEl: el, linktext: this.target, sourcePath });
		});
		el.addEventListener('click', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			void this.host.app.workspace.openLinkText(this.target, sourcePath, Keymap.isModEvent(event));
		});
		return el;
	}

	ignoreEvent(event: Event): boolean {
		return event.type === 'mousedown' || event.type === 'click';
	}
}

/** Adds the decorations of one line to out. */
function buildLine(state: EditorState, n: number, host: EditorHost, opts: Options, out: Array<Range<Decoration>>): void {
	const line = state.doc.line(n);
	if (!line.text.includes('[[') || !line.text.includes('|')) return;
	const ranges = state.selection.ranges;
	for (const plan of planLine(line.text, opts)) {
		const a = line.from + plan.from;
		const b = line.from + plan.to;
		// Rule 7: the cursor or the selection touches the link, ends included. Core shows the source.
		if (ranges.some((r) => r.from <= b && r.to >= a)) continue;
		if (!isLinkStart(state, a)) continue;
		for (const d of plan.decos) {
			const x = line.from + d.from;
			const y = line.from + d.to;
			if (d.kind === 'hide') out.push(hide.range(x, y));
			else if (d.kind === 'mark') {
				if (y > x) out.push(markOf(d.value ?? '').range(x, y));
			} else out.push(Decoration.replace({ widget: new MathWidget(host, d.value ?? '', plan.target) }).range(x, y));
		}
	}
}

function active(state: EditorState, opts: Options): boolean {
	return opts.livePreview && state.field(editorLivePreviewField, false) === true;
}

/** Numbers of the visible lines, in order. */
function visibleLines(view: EditorView): number[] {
	const doc = view.state.doc;
	const out: number[] = [];
	let last = 0;
	for (const { from, to } of view.visibleRanges) {
		for (let n = Math.max(doc.lineAt(from).number, last + 1); n <= doc.lineAt(to).number; n++) {
			last = n;
			out.push(n);
		}
	}
	return out;
}

/** The decorations of one editor, for the visible lines only. */
export function buildDecorations(view: EditorView, host: EditorHost): DecorationSet {
	const state = view.state;
	const opts = host.options();
	if (!active(state, opts)) return Decoration.none;
	const out: Array<Range<Decoration>> = [];
	for (const n of visibleLines(view)) buildLine(state, n, host, opts, out);
	return Decoration.set(out, true);
}

/** Above this number of lines to draw again, one update draws all visible lines again. */
const MAX_LINES = 60;

/**
 * Rule 9: a keystroke or a cursor move draws only the lines that it can change again: the changed lines and the lines
 * of the old and the new selection. The decorations of the other lines move with the change. Returns null when the
 * whole visible part must be drawn again.
 */
export function updateDecorations(old: DecorationSet, u: ViewUpdate, host: EditorHost): DecorationSet | null {
	const state = u.state;
	const doc = state.doc;
	const opts = host.options();
	if (!active(state, opts)) return Decoration.none;
	const visible = visibleLines(u.view);
	if (!visible.length) return Decoration.none;
	const first = visible[0]!;
	const lastVisible = visible[visible.length - 1]!;
	const lines = new Set<number>();
	const addRange = (from: number, to: number): boolean => {
		const a = Math.max(doc.lineAt(Math.min(from, doc.length)).number, first);
		const b = Math.min(doc.lineAt(Math.min(to, doc.length)).number, lastVisible);
		for (let n = a; n <= b; n++) {
			lines.add(n);
			if (lines.size > MAX_LINES) return false;
		}
		return true;
	};
	if (u.docChanged) {
		let ok = true;
		u.changes.iterChangedRanges((_fA, _tA, fB, tB) => {
			if (ok) ok = addRange(fB, tB);
		});
		if (!ok) return null;
	}
	for (const r of u.startState.selection.ranges) {
		const from = u.docChanged ? u.changes.mapPos(r.from, -1) : r.from;
		const to = u.docChanged ? u.changes.mapPos(r.to, 1) : r.to;
		if (!addRange(from, to)) return null;
	}
	for (const r of state.selection.ranges) if (!addRange(r.from, r.to)) return null;
	let set = u.docChanged ? old.map(u.changes) : old;
	for (const n of Array.from(lines).sort((x, y) => x - y)) {
		const line = doc.line(n);
		const add: Array<Range<Decoration>> = [];
		buildLine(state, n, host, opts, add);
		set = set.update({ filterFrom: line.from, filterTo: line.to, filter: (from, to) => to < line.from || from > line.to, add, sort: true });
	}
	return set;
}

/** The editor extension. */
export function aliasMarkupExtension(host: EditorHost): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(readonly view: EditorView) {
				views.add(view);
				this.decorations = buildDecorations(view, host);
			}
			destroy(): void {
				views.delete(this.view);
			}
			update(u: ViewUpdate): void {
				const redraw = u.transactions.some((t) => t.effects.some((e) => e.is(redrawEffect)));
				const modeChanged = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
				const oldTree = syntaxTree(u.startState);
				const newTree = syntaxTree(u.state);
				// The parser reached text that it had not parsed before: links there can be drawn now.
				const grew = oldTree !== newTree && oldTree.length < Math.min(newTree.length, u.view.viewport.to);
				if (redraw || modeChanged || u.viewportChanged || grew) {
					this.decorations = buildDecorations(u.view, host);
					return;
				}
				if (!u.docChanged && !u.selectionSet) return;
				this.decorations = updateDecorations(this.decorations, u, host) ?? buildDecorations(u.view, host);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}
