// Live Preview and Source mode: follow slug links on click, and write slugs in inserted heading links.
import { Annotation, EditorState, type ChangeSpec, type Extension, type Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Keymap, editorInfoField, editorLivePreviewField } from 'obsidian';
import { linkAt, mayHoldLink, planConvertWith, MAX_TEXT } from './slug';
import { asElement, type SlugIndex, type SlugTarget } from './resolve';
import { ORIGINAL_HREF } from './reading';

/** Marks the plugin's own rewrite, so that the filter never reads its own change. */
const ownRewrite = Annotation.define<boolean>();
/** Most lines of one change that the insert rewrite reads. A larger paste is left as it is. */
const MAX_REWRITE_LINES = 200;

export interface EditorOptions {
	useSlugs: () => boolean;
	rewriteInserted: () => boolean;
}

/** Counters for the e2e performance test. */
export const stats = { filterScans: 0 };

/**
 * A transaction filter: when one change inserts a whole markdown heading link in the Obsidian form
 * (`[t](#Heading%20Text)`), the same transaction writes the slug. One undo removes both.
 * Typed characters only cost the mayHoldLink test of the inserted text.
 */
export function insertRewriteExtension(
	index: Pick<SlugIndex, 'lookup'>,
	opts: EditorOptions,
	pathOf: (state: EditorState) => string | undefined = (state) => state.field(editorInfoField, false)?.file?.path,
): Extension {
	return EditorState.transactionFilter.of((tr: Transaction): Transaction | readonly (Transaction | TransactionSpec)[] => {
		if (!tr.docChanged || tr.annotation(ownRewrite) || !opts.useSlugs() || !opts.rewriteInserted()) return tr;
		let candidate = false;
		tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
			if (!candidate && inserted.length >= 5 && mayHoldLink(inserted.sliceString(0, MAX_TEXT * 10))) candidate = true;
		});
		if (!candidate) return tr;
		const sourcePath = pathOf(tr.startState);
		if (!sourcePath) return tr;
		stats.filterScans++;
		const doc = tr.newDoc;
		const lookup = index.lookup(sourcePath);
		const changes: ChangeSpec[] = [];
		tr.changes.iterChangedRanges((_fa, _ta, fromB, toB) => {
			if (toB - fromB < 5) return;
			const first = doc.lineAt(fromB);
			const last = doc.lineAt(toB);
			if (last.number - first.number > MAX_REWRITE_LINES) return;
			const text = doc.sliceString(first.from, last.to);
			for (const item of planConvertWith(text, lookup)) {
				const from = first.from + item.from;
				const to = first.from + item.to;
				// Only a link destination that the change inserted. Links that were there before stay.
				if (from < fromB || to > toB) continue;
				changes.push({ from, to, insert: item.new });
			}
		});
		if (changes.length === 0) return tr;
		return [tr, { changes, sequential: true, annotations: ownRewrite.of(true) }];
	});
}

/** The link target under a click in an editor, or null. */
function editorLinkAt(evt: MouseEvent, el: HTMLElement): { dest: string; sourcePath: string } | null {
	const editorEl = el.closest('.cm-editor');
	if (!(editorEl instanceof HTMLElement)) return null;
	const view = EditorView.findFromDOM(editorEl);
	if (!view || !el.closest('.cm-content')) return null;
	const live = view.state.field(editorLivePreviewField, false) ?? false;
	const mod = Keymap.isModEvent(evt) !== false;
	// Source mode follows a link only with Ctrl or Cmd, as core does.
	if (!live && !mod) return null;
	if (!el.closest('.cm-link, .cm-url, .cm-hmd-internal-link, .cm-underline')) return null;
	let pos: number;
	try {
		pos = view.posAtDOM(el);
	} catch {
		return null;
	}
	const line = view.state.doc.lineAt(pos);
	if (line.length > MAX_TEXT * 10) return null;
	const link = linkAt(line.text, pos - line.from);
	if (!link || link.fragment === null) return null;
	// In Live Preview, a plain click in a link that shows its markdown edits the link, as core does.
	const sel = view.state.selection.main;
	if (live && !mod && view.hasFocus && sel.from <= line.from + link.to && sel.to >= line.from + link.from) return null;
	const sourcePath = view.state.field(editorInfoField, false)?.file?.path;
	if (!sourcePath) return null;
	return { dest: line.text.slice(link.destFrom, link.destTo).replace(/^<|>$/g, ''), sourcePath };
}

/** The link target under a click in Reading view, or null. */
function readingLinkAt(el: HTMLElement, sourcePathOf: (el: HTMLElement) => string | null): { dest: string; sourcePath: string } | null {
	const a = el.closest('a.internal-link');
	if (!(a instanceof HTMLElement) || a.closest('.cm-editor')) return null;
	const dest = a.getAttribute(ORIGINAL_HREF) ?? a.getAttribute('data-href');
	const sourcePath = sourcePathOf(a);
	if (!dest || !sourcePath) return null;
	return { dest, sourcePath };
}

/**
 * Click handling for slug links, on the document in the capture phase. It runs before the editor and core handlers,
 * and it stops the event only for a link whose target is a GitHub slug of an existing heading.
 */
export class LinkClicks {
	constructor(
		private index: SlugIndex,
		private enabled: () => boolean,
		private sourcePathOf: (el: HTMLElement) => string | null,
	) {}

	private find(evt: MouseEvent): { target: SlugTarget; sourcePath: string } | null {
		if (!this.enabled() || evt.button !== 0) return null;
		const el = asElement(evt.target);
		if (!el) return null;
		const hit = readingLinkAt(el, this.sourcePathOf) ?? editorLinkAt(evt, el);
		if (!hit) return null;
		const target = this.index.resolve(hit.dest, hit.sourcePath);
		return target ? { target, sourcePath: hit.sourcePath } : null;
	}

	onMouseDown = (evt: MouseEvent): void => {
		if (!this.find(evt)) return;
		// Keep the cursor where it is and keep core from following the link text.
		evt.preventDefault();
		evt.stopImmediatePropagation();
	};

	onClick = (evt: MouseEvent): void => {
		const found = this.find(evt);
		if (!found) return;
		evt.preventDefault();
		evt.stopImmediatePropagation();
		void this.index.open(found.target, found.sourcePath, Keymap.isModEvent(evt));
	};
}
