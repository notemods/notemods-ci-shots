import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { wordStarts } from './words';
import { markStyle } from './reading';
import { isPro } from './pro';
import type FixationReaderPlugin from './main';

/** Use the parser to keep Markdown code, math, bold, HTML and metadata free of marks. */
export function editorMarks(view: EditorView, plugin: FixationReaderPlugin): DecorationSet {
	if (!isPro() || !plugin.settings.livePreview || !view.state.field(editorLivePreviewField, false)) return Decoration.none;
	const file = view.state.field(editorInfoField, false)?.file;
	if (!file || !plugin.activeFor(file.path)) return Decoration.none;
	const ranges = [];
	const s = plugin.settings;
	// The parser works in time slices. Parse up to the end of the visible text (100 ms at most), and leave text past the parsed tree unmarked.
	// A later parse step updates the view, and this function runs again.
	const end = view.visibleRanges.reduce((m, r) => Math.max(m, r.to), 0);
	const tree = ensureSyntaxTree(view.state, end, 100) ?? syntaxTree(view.state);
	for (const visible of view.visibleRanges) {
		const text = view.state.doc.sliceString(visible.from, visible.to);
		for (const w of wordStarts(text, s.strength, s.minimum)) {
			const from = visible.from + w.from;
			const split = visible.from + w.split;
			const to = visible.from + w.to;
			if (to > tree.length) continue;
			let node = tree.resolveInner(from, 1);
			let skip = false;
			for (;;) {
				if (/code|math|strong|frontmatter|hashtag|url|html|linkmark|formatting/i.test(node.name)) { skip = true; break; }
				if (!node.parent) break;
				node = node.parent;
			}
			if (skip) continue;
			ranges.push(Decoration.mark({ class: 'fx', attributes: { style: markStyle(s, true) } }).range(from, split));
			if (s.endingOpacity < 1 && split < to) ranges.push(Decoration.mark({ class: 'fx-end', attributes: { style: markStyle(s, true, true) } }).range(split, to));
		}
	}
	return Decoration.set(ranges, true);
}

export function fixationExtension(plugin: FixationReaderPlugin) {
	return ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = editorMarks(view, plugin); }
		update(update: { view: EditorView }): void { this.decorations = editorMarks(update.view, plugin); }
	}, { decorations: (v) => v.decorations });
}
