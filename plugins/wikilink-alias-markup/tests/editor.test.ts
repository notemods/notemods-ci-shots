import { afterEach, describe, expect, it } from 'vitest';
import { StreamLanguage, forceParsing } from '@codemirror/language';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { aliasMarkupExtension, buildDecorations, type EditorHost } from '../src/editor';

// A small stream language for the tree: `[[` is a "link" token, a code block line is a "comment" token. The default
// token table of CodeMirror knows these names. Obsidian's own names (formatting-link, hmd-codeblock) were checked in
// the real app by the end-to-end tests.
const md = StreamLanguage.define<{ code: boolean }>({
	startState: () => ({ code: false }),
	token(stream, st) {
		if (stream.sol() && stream.match('```')) {
			st.code = !st.code;
			return 'comment';
		}
		if (st.code) {
			stream.skipToEnd();
			return 'comment';
		}
		if (stream.match('[[')) return 'link';
		stream.next();
		return null;
	},
});

const host: EditorHost = { app: {} as never, options: () => ({ livePreview: true, math: false }), math: { load: () => Promise.resolve(), render: () => document.createElement('span'), finish: () => undefined } };

const views: EditorView[] = [];
afterEach(() => {
	for (const v of views.splice(0)) v.destroy();
});

function make(doc: string, live = true): { view: EditorView; plugin: () => DecorationSet } {
	const ext = aliasMarkupExtension(host);
	const state = EditorState.create({ doc, extensions: [md, editorLivePreviewField.init(() => live), ext] });
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	const view = new EditorView({ state, parent });
	views.push(view);
	// The parser runs in the background in an editor. The test parses at once; the tree change draws the links.
	forceParsing(view, view.state.doc.length, 1e6);
	const plugin = (): DecorationSet => (view.plugin(ext as ViewPlugin<{ decorations: DecorationSet }>) as unknown as { decorations: DecorationSet }).decorations;
	return { view, plugin };
}

function list(set: DecorationSet): string[] {
	const out: string[] = [];
	set.between(0, 1e9, (from, to, d) => {
		out.push(`${from}-${to}:${(d.spec as { class?: string }).class ?? 'hide'}`);
	});
	return out;
}

describe('Live Preview decorations', () => {
	it('A1 hides the backticks and marks the code of post 1', () => {
		const { plugin } = make('Intro\n\nPost 1: [[Obsidian|`obsidian`]] here.\n\nEnd');
		expect(list(plugin())).toEqual(['26-27:hide', '27-35:cm-inline-code wam-code', '35-36:hide']);
	});

	it('A6 adds nothing to a link that the cursor touches, ends included', () => {
		const { view, plugin } = make('Post 1: [[Obsidian|`obsidian`]] here.\nEnd');
		for (const pos of [8, 20, 31]) {
			view.dispatch({ selection: { anchor: pos } });
			expect(list(plugin())).toEqual([]);
		}
		view.dispatch({ selection: { anchor: 33 } });
		expect(list(plugin()).length).toBe(3);
	});

	it('A9 leaves links in a code block and links without alias alone', () => {
		const { plugin } = make('End\n```\n[[A|`x`]]\n```\n[[snake_case]] [[B|plain]]');
		expect(list(plugin())).toEqual([]);
	});

	it('draws nothing outside Live Preview', () => {
		const { plugin } = make('x\n[[A|`x`]]', false);
		expect(list(plugin())).toEqual([]);
	});

	it('A10 the update after each edit and cursor move equals a full build (random edits)', () => {
		const lines = Array.from({ length: 80 }, (_, i) => (i % 3 === 0 ? `L${i} [[T|\`c${i}\`]] and [[U|**b** *i*]] x` : i % 3 === 1 ? `plain ${i} [[T]]` : `${i} ==[[V|~~d~~]]==`));
		const { view, plugin } = make(lines.join('\n'));
		let seed = 7;
		const rnd = (n: number): number => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed % n;
		};
		const pieces = ['x', '`', '*', '[[', ']]', '|', '\n', '**', '~~', ' '];
		let drawn = 0;
		for (let step = 0; step < 400; step++) {
			const len = view.state.doc.length;
			const kind = rnd(4);
			if (kind === 0) {
				const at = rnd(len + 1);
				view.dispatch({ changes: { from: at, insert: pieces[rnd(pieces.length)]! }, selection: { anchor: at + 1 } });
			} else if (kind === 1 && len > 2) {
				const at = rnd(len - 1);
				view.dispatch({ changes: { from: at, to: at + 1 + rnd(Math.min(3, len - at - 1)) } });
			} else if (kind === 2) {
				const a = rnd(len + 1);
				view.dispatch({ selection: EditorSelection.single(a, Math.min(len, a + rnd(30))) });
			} else {
				view.dispatch({ selection: { anchor: rnd(len + 1) } });
			}
			forceParsing(view, view.state.doc.length, 1e6);
			const now = list(plugin());
			expect(now).toEqual(list(buildDecorations(view, host)));
			if (now.length) drawn++;
		}
		// The check is not empty: most steps have drawn links.
		expect(drawn).toBeGreaterThan(300);
	});
});
