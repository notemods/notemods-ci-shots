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

/** The decorations of one editor, for the visible lines only. */
export function buildDecorations(view: EditorView, host: EditorHost): DecorationSet {
	const state = view.state;
	const opts = host.options();
	if (!opts.livePreview || !state.field(editorLivePreviewField, false)) return Decoration.none;
	const doc = state.doc;
	const ranges = state.selection.ranges;
	const out: Array<Range<Decoration>> = [];
	let lastLine = 0;
	for (const { from, to } of view.visibleRanges) {
		for (let n = Math.max(doc.lineAt(from).number, lastLine + 1); n <= doc.lineAt(to).number; n++) {
			lastLine = n;
			const line = doc.line(n);
			if (!line.text.includes('[[') || !line.text.includes('|')) continue;
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
	}
	return Decoration.set(out, true);
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
				const treeChanged = syntaxTree(u.startState) !== syntaxTree(u.state);
				if (u.docChanged || u.viewportChanged || u.selectionSet || redraw || modeChanged || treeChanged) this.decorations = buildDecorations(u.view, host);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}
