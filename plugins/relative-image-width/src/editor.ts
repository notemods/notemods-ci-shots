// Live Preview: one ViewPlugin for each editor. It sizes the image embeds in the editor content, and it hides a Pandoc
// block "{...}" after an image link when the cursor is not on its line.
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { clearAll, sizeAll, type PassContext } from './dom';
import { findPandocAttrs, type CssSize } from './size';
import type { Options } from './settings';

/** Sends a redraw to every editor (a setting or the Pro state changed). */
const redrawEffect = StateEffect.define<null>();
const views = new Set<EditorView>();

/** Counts the DOM passes and their time in ms, for the end-to-end tests of rule 10 (no loop, typing speed). */
export const stats = { passes: 0, ms: 0 };

export function redrawViews(): void {
	for (const view of Array.from(views)) view.dispatch({ effects: redrawEffect.of(null) });
}

/** What the editor needs from the plugin: the options and the note property of a note. */
export interface EditorHost {
	options(): Options;
	property(path: string | null): unknown;
}

/** The longest line that the Pandoc scan reads. A longer line is not scanned (typing stays fast in huge lines). */
const MAX_LINE = 20000;

function livePreview(view: EditorView): boolean {
	return view.state.field(editorLivePreviewField, false) ?? false;
}

/** True when the position is in inline code, a code block or math (the syntax tree of the Markdown editor). */
function inCode(state: EditorState, pos: number): boolean {
	for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1), n = 0; node && n < 20; node = node.parent, n++) {
		if (/code|math/i.test(node.type.name)) return true;
	}
	return false;
}

/** Hides each Pandoc block in the visible lines, except on the lines that hold a cursor or a selection. */
function buildHidden(view: EditorView): DecorationSet {
	const b = new RangeSetBuilder<Decoration>();
	const { doc, selection } = view.state;
	const busy = new Set<number>();
	for (const r of selection.ranges) {
		const a = doc.lineAt(r.from).number;
		const z = doc.lineAt(r.to).number;
		for (let n = a; n <= z && n - a < 1000; n++) busy.add(n);
	}
	let last = -1;
	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = doc.lineAt(pos);
			if (line.number > last && !busy.has(line.number) && line.length <= MAX_LINE && line.text.includes('{')) {
				for (const m of findPandocAttrs(line.text)) {
					if (inCode(view.state, line.from + m.from)) continue;
					b.add(line.from + m.from, line.from + m.to, Decoration.replace({}));
				}
			}
			last = line.number;
			pos = line.to + 1;
		}
	}
	return b.finish();
}

/** The Pandoc size for an image widget: the first block after the link at the widget position. */
function pandocAt(view: EditorView, img: HTMLImageElement): CssSize | null {
	let pos: number;
	try {
		pos = view.posAtDOM(img.closest('.internal-embed') ?? img);
	} catch {
		return null;
	}
	const line = view.state.doc.lineAt(pos);
	if (line.length > MAX_LINE) return null;
	const at = pos - line.from;
	const m = findPandocAttrs(line.text).find((x) => x.from >= at);
	if (!m || (!m.attrs.width && !m.attrs.height)) return null;
	return { width: m.attrs.width, height: m.attrs.height };
}

export function relativeImageExtension(host: EditorHost) {
	return ViewPlugin.fromClass(
		class {
			hidden: DecorationSet = Decoration.none;
			private frame = 0;
			private observer: MutationObserver;

			constructor(readonly view: EditorView) {
				views.add(view);
				// Bounded: only the content of this editor, only added or removed nodes. The plugin changes only
				// attributes, so its own writes do not call the observer again.
				// The pass runs in the observer callback itself: it runs before the browser paints and before CodeMirror
				// measures the new lines, so an image never shows first at the wrong size (no scroll jump).
				this.observer = new MutationObserver(() => this.runNow());
				this.observer.observe(view.contentDOM, { childList: true, subtree: true });
				this.hidden = this.hideOn() ? buildHidden(view) : Decoration.none;
				this.schedule();
			}

			private hideOn(): boolean {
				return livePreview(this.view) && host.options().pandoc;
			}

			update(u: ViewUpdate): void {
				const redraw = u.transactions.some((t) => t.effects.some((e) => e.is(redrawEffect)));
				const mode = (u.startState.field(editorLivePreviewField, false) ?? false) !== livePreview(u.view);
				if (u.docChanged || u.viewportChanged || u.selectionSet || redraw || mode) {
					this.hidden = this.hideOn() ? buildHidden(u.view) : Decoration.none;
				}
				if (u.docChanged || u.viewportChanged || redraw || mode) this.schedule();
			}

			schedule(): void {
				if (this.frame) return;
				const win = this.view.dom.ownerDocument.defaultView ?? window;
				this.frame = win.requestAnimationFrame(() => {
					this.frame = 0;
					this.run();
				});
			}

			/** Runs the pass now, in place of a pass that waits for the next frame. */
			runNow(): void {
				if (this.frame) (this.view.dom.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.frame);
				this.frame = 0;
				this.run();
			}

			run(): void {
				stats.passes++;
				const t0 = performance.now();
				try {
					if (this.pass() > 0) this.view.requestMeasure();
				} finally {
					stats.ms += performance.now() - t0;
				}
			}

			/** Sizes the images in the editor. Returns the number of images that changed. */
			private pass(): number {
				const root = this.view.contentDOM;
				if (!livePreview(this.view)) {
					clearAll(root);
					return 0;
				}
				const file = this.view.state.field(editorInfoField, false)?.file ?? null;
				const ctx: PassContext = {
					opts: host.options(),
					property: host.property(file?.path ?? null),
					pandocAt: (img) => pandocAt(this.view, img),
				};
				// Images in a rendered callout, table or note embed belong to the Reading view post processor.
				return sizeAll(root, ctx, (img) => !img.closest('.markdown-rendered, .markdown-embed'));
			}

			destroy(): void {
				views.delete(this.view);
				this.observer.disconnect();
				if (this.frame) (this.view.dom.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.frame);
				this.frame = 0;
				clearAll(this.view.contentDOM);
			}
		},
		{ decorations: (v) => v.hidden },
	);
}
