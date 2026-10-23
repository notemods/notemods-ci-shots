import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { StreamLanguage, defaultHighlightStyle, type StringStream } from '@codemirror/language';
import { App, Component, MarkdownRenderer, editorLivePreviewField } from 'obsidian';
import { DEFAULT_SETTINGS, normalizeSettings, type CalloutTableFootnotesSettings } from '../src/settings';
import { FootnoteWidgets, REF_CLASS } from '../src/widgets';
import { applyChanges, convertInline, locateInline, maskLine, panelItems, scanFootnotes } from '../src/footnotes';

// A small stream parser that gives the token classes of the Obsidian Markdown parser for footnotes, code spans and
// math: "^[" is inline-footnote-start, the closing "]" is inline-footnote-end, "[^" is a footref link start.
interface ParseState {
	depth: number;
	inside: boolean;
}
// A stream parser makes a tree node only for a token class with a highlight tag, so each class gets one.
const TAG = defaultHighlightStyle.specs[0]!.tag;
const CLASSES = ['inline-footnote-start', 'formatting-inline-footnote', 'footref', 'inline-footnote', 'inline-footnote-end', 'formatting', 'formatting-link', 'formatting-link-start', 'hmd-barelink', 'inline-code', 'math', 'hmd-escape-char'];
const markdownLike = StreamLanguage.define<ParseState>({
	tokenTable: Object.fromEntries(CLASSES.map((c) => [c, TAG])),
	startState: () => ({ depth: 0, inside: false }),
	token(stream: StringStream, state: ParseState): string | null {
		if (stream.sol()) state.inside = false;
		if (!state.inside && stream.match(/^`[^`]*`/)) return 'inline-code';
		if (!state.inside && stream.match(/^\$[^$]+\$/)) return 'math';
		if (stream.match('\\')) {
			stream.next();
			return 'hmd-escape-char';
		}
		if (!state.inside && stream.match('^[')) {
			state.inside = true;
			state.depth = 0;
			return 'inline-footnote-start formatting-inline-footnote footref inline-footnote';
		}
		if (state.inside) {
			if (stream.match('[')) {
				state.depth++;
				return 'footref inline-footnote';
			}
			if (stream.match(']')) {
				if (state.depth > 0) {
					state.depth--;
					return 'footref inline-footnote';
				}
				state.inside = false;
				return 'footref inline-footnote inline-footnote-end formatting-inline-footnote';
			}
			stream.next();
			return 'footref inline-footnote';
		}
		if (stream.match(/^\[\^[^\]\s]+\]/, false)) {
			stream.match('[^');
			return 'formatting formatting-link formatting-link-start hmd-barelink footref';
		}
		stream.next();
		return null;
	},
});

const views: EditorView[] = [];
afterEach(() => {
	for (const v of views.splice(0)) v.destroy();
	document.body.empty();
});

function setup(doc: string, opts: { cursor?: number; livePreview?: boolean; settings?: Partial<CalloutTableFootnotesSettings> } = {}) {
	let settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...opts.settings });
	const widgets = new FootnoteWidgets({
		app: App.createConfigured__({ files: {} }) as never,
		component: new Component(),
		getSettings: () => settings,
		isPro: () => false,
	});
	const parent = document.body.createDiv();
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc,
			selection: EditorSelection.cursor(opts.cursor ?? 0),
			extensions: [markdownLike, editorLivePreviewField.init(() => opts.livePreview ?? true), widgets.extension()],
		}),
	});
	views.push(view);
	const set = (next: Partial<CalloutTableFootnotesSettings>): void => {
		settings = normalizeSettings({ ...settings, ...next });
		widgets.refresh();
	};
	return { widgets, view, set };
}

/** The label of each number widget in the editor, in text order. */
function numbers(view: EditorView): string[] {
	return Array.from(view.contentDOM.querySelectorAll(`.${REF_CLASS}`)).map((e) => e.textContent ?? '');
}

describe('settings for paragraph footnotes (rules 1 and 10)', () => {
	it('turns inline paragraph footnotes on and named paragraph references off by default', () => {
		expect(DEFAULT_SETTINGS.inlineParagraphs).toBe(true);
		expect(DEFAULT_SETTINGS.namedParagraphs).toBe(false);
		expect(normalizeSettings({ inlineParagraphs: 'yes' as unknown as boolean, namedParagraphs: true })).toMatchObject({ inlineParagraphs: true, namedParagraphs: true });
		expect(normalizeSettings(null)).toMatchObject({ inlineParagraphs: true, namedParagraphs: false });
	});
});

describe('number widgets in paragraphs (Live Preview)', () => {
	it('case 1: gives two widgets with the numbers 1 and 2', () => {
		const { view } = setup('A^[one] and B^[two].\n\nEnd.', { cursor: 24 });
		expect(numbers(view)).toEqual(['1', '2']);
		expect(view.contentDOM.textContent).toBe('A1 and B2.End.');
	});

	it('case 2: counts a named reference first and numbers it only with the setting on', () => {
		const doc = 'Named[^x] then inline^[y]\n\n[^x]: def';
		const off = setup(doc, { cursor: doc.length });
		expect(numbers(off.view)).toEqual(['2']);
		const on = setup(doc, { cursor: doc.length, settings: { namedParagraphs: true } });
		expect(numbers(on.view)).toEqual(['1', '2']);
	});

	it('case 3: a callout footnote above the paragraph gets 1, the paragraph footnote 2', () => {
		const doc = '> [!note] Source\n> Callout^[c]\n\nParagraph^[p].';
		const { view } = setup(doc);
		expect(numbers(view)).toEqual(['2']);
		expect(locateInline(doc).map((m) => m.number)).toEqual([2]);
	});

	it('case 4: code spans, escaped carets and code fences give no widget', () => {
		const { view } = setup('`code ^[no]` and \\^[no] and $x^[m]$\n\n```\nfenced^[no]\n```\n%% ^[c] %%');
		expect(numbers(view)).toEqual([]);
	});

	it('case 5: keeps nested links and code in the text of one widget', () => {
		const doc = 'Text^[see [[Note]] and `x`].\n';
		const { view, widgets } = setup(doc, { cursor: doc.length });
		expect(numbers(view)).toEqual(['1']);
		expect(widgets.marksOf(view).map((m) => m.text)).toEqual(['see [[Note]] and `x`']);
	});

	it('case 6: a footnote across a line break stays as drawn', () => {
		const { view } = setup('x\nStart^[crosses\nthe break] end.');
		expect(numbers(view)).toEqual([]);
	});

	it('rule 4: shows the raw text while the selection touches the footnote', () => {
		const doc = 'A^[one] and B^[two].\n\nEnd.';
		const { view } = setup(doc, { cursor: doc.length });
		expect(numbers(view)).toEqual(['1', '2']);
		for (const at of [1, 4, 7]) {
			view.dispatch({ selection: { anchor: at } });
			expect(numbers(view)).toEqual(['2']);
			expect(view.contentDOM.textContent).toContain('A^[one]');
		}
		view.dispatch({ selection: { anchor: 0, head: doc.length } });
		expect(numbers(view)).toEqual([]);
		view.dispatch({ selection: { anchor: doc.length } });
		expect(numbers(view)).toEqual(['1', '2']);
	});

	it('rule 2: draws no widget when the parser does not mark the range as a footnote', () => {
		const doc = 'A^[one].\n';
		const { view } = setup(doc, { cursor: doc.length });
		expect(numbers(view)).toEqual(['1']);
		const plain = new EditorView({ parent: document.body.createDiv(), state: EditorState.create({ doc, extensions: [editorLivePreviewField.init(() => true), new FootnoteWidgets({ app: App.createConfigured__({ files: {} }) as never, component: new Component(), getSettings: () => DEFAULT_SETTINGS, isPro: () => false }).extension()] }) });
		views.push(plain);
		expect(numbers(plain)).toEqual([]);
	});

	it('draws nothing in source mode or with the setting off, and again after the setting comes back', () => {
		const doc = 'A^[one].\n';
		expect(numbers(setup(doc, { cursor: doc.length, livePreview: false }).view)).toEqual([]);
		const { view, set } = setup(doc, { cursor: doc.length, settings: { inlineParagraphs: false } });
		expect(numbers(view)).toEqual([]);
		set({ inlineParagraphs: true });
		expect(numbers(view)).toEqual(['1']);
	});

	it('includes list items, tasks and blockquotes', () => {
		const doc = '- Item^[a]\n- [ ] Task^[b]\n> Quote^[c]\n';
		expect(numbers(setup(doc, { cursor: doc.length }).view)).toEqual(['1', '2', '3']);
	});

	it('rule 7: a click or Enter on the number puts the cursor at the start of the footnote text', () => {
		vi.useFakeTimers();
		try {
			const doc = 'Intro.\n\nA^[one] and B^[two].';
			const { view } = setup(doc);
			const links = view.contentDOM.querySelectorAll<HTMLElement>(`.${REF_CLASS} a`);
			links[1]?.click();
			expect(view.state.selection.main.head).toBe(doc.indexOf('two'));
			expect(numbers(view)).toEqual(['1']);
			view.dispatch({ selection: { anchor: 0 } });
			view.contentDOM.querySelector<HTMLElement>(`.${REF_CLASS} a`)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			expect(view.state.selection.main.head).toBe(doc.indexOf('one'));
		} finally {
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});

	it('rule 6: hover shows the footnote text rendered as Markdown in the popup', async () => {
		const doc = 'A^[**bold** text].\n';
		const { view } = setup(doc, { cursor: doc.length, settings: { hoverDelayMs: 0 } });
		const render = vi.spyOn(MarkdownRenderer, 'render');
		const link = view.contentDOM.querySelector<HTMLElement>(`.${REF_CLASS} a`);
		link?.dispatchEvent(new MouseEvent('mouseenter'));
		await vi.waitFor(() => expect(document.querySelector('.footnote-live-popover.is-shown')).not.toBeNull());
		expect(render.mock.calls[0]?.[1]).toBe('**bold** text');
		expect(document.querySelector('.footnote-live-popover')?.classList.contains('markdown-rendered')).toBe(true);
		render.mockRestore();
		link?.dispatchEvent(new MouseEvent('mouseleave'));
		expect(document.querySelector('.footnote-live-popover')).toBeNull();
	});

	it('rule 11: never changes the note text', () => {
		const doc = 'A^[one] and B^[two].\n\n> Quote^[q]\n';
		const { view } = setup(doc, { cursor: doc.length });
		for (const at of [0, 3, 10, 15, doc.length]) view.dispatch({ selection: { anchor: at } });
		view.contentDOM.querySelector<HTMLElement>(`.${REF_CLASS} a`)?.click();
		expect(view.state.doc.toString()).toBe(doc);
	});

	it('rule 12: the Reading view post processor leaves paragraphs alone', () => {
		const { widgets } = setup('A^[one].');
		const p = document.body.createEl('p', { text: 'A1.' });
		expect(widgets.process(p)).toBe(0);
		expect(p.innerHTML).toBe('A1.');
	});

	it('case 7: draws the visible widgets of a 5,000-line note with 1,000 footnotes quickly', () => {
		const doc = Array.from({ length: 1000 }, () => 'Fact^[n] text.\nPlain line.\n- Item line.\n> Quote line.\n').join('\n');
		expect(doc.split('\n').length).toBe(5000);
		const start = performance.now();
		const marks = locateInline(doc);
		expect(performance.now() - start).toBeLessThan(100);
		expect(marks.length).toBe(1000);
		const { view } = setup(doc, { cursor: doc.length });
		expect(numbers(view).slice(0, 2)).toEqual(['1', '2']);
	});
});

describe('Pro: paragraph footnotes in the panel and the conversion', () => {
	it('lists paragraph inline footnotes in the panel', () => {
		const items = panelItems(scanFootnotes('A^[one] and B^[two].'));
		expect(items.map((i) => [i.label, i.text, i.where])).toEqual([
			['1', 'one', 'body'],
			['2', 'two', 'body'],
		]);
	});

	it('case 10: converts the inline footnote at the cursor and adds the definition at the end', () => {
		const text = 'A^[one] and B^[two].';
		const plan = convertInline(text, 0);
		expect(plan?.id).toBe('1');
		expect(applyChanges(text, plan?.changes ?? [])).toBe('A[^1] and B^[two].\n\n[^1]: one');
		expect(applyChanges(text, convertInline(text, 15)?.changes ?? [])).toBe('A^[one] and B[^1].\n\n[^1]: two');
	});

	it('uses a free number and joins an existing definition list', () => {
		const text = 'A[^1] and B^[two].\n\n[^1]: one\n';
		const plan = convertInline(text, 0);
		expect(plan?.id).toBe('2');
		expect(applyChanges(text, plan?.changes ?? [])).toBe('A[^1] and B[^2].\n\n[^1]: one\n[^2]: two\n');
	});

	it('keeps the numbers of the converted note in the same order', () => {
		const text = 'A^[one] and B^[two].';
		const after = applyChanges(text, convertInline(text, 0)?.changes ?? []);
		expect(scanFootnotes(after).numbers).toEqual({ '1': 1, 'inline 0:11': 2 });
	});

	it('gives null when the cursor line has no inline footnote', () => {
		expect(convertInline('A^[one].\nNo footnote.', 12)).toBeNull();
		expect(convertInline('`^[code]`', 0)).toBeNull();
	});

	it('undo restores the text in one step', () => {
		const text = 'A^[one] and B^[two].';
		const state = EditorState.create({ doc: text });
		const plan = convertInline(text, 0);
		const tr = state.update({ changes: plan?.changes ?? [] });
		expect(tr.newDoc.toString()).toBe('A[^1] and B^[two].\n\n[^1]: one');
		expect(tr.changes.invert(state.doc).apply(tr.newDoc).toString()).toBe(text);
	});
});

describe('maskLine', () => {
	it('blanks code, inline math, display math and comments, and keeps the length', () => {
		const line = 'a `c` $x^[m]$ $$y$$ %%z%% <!-- w --> \\$q$ $5 and $ 6 b';
		const { masked, open } = maskLine(line);
		expect(masked.length).toBe(line.length);
		expect(open).toBeNull();
		expect(masked.replace(/ +/g, ' ')).toBe('a \\$q$ $5 and $ 6 b');
	});

	it('carries an open comment or math block to the next lines', () => {
		expect(maskLine('text %% open', null)).toEqual({ masked: 'text        ', open: '%%' });
		expect(maskLine('inside ^[x]', '%%')).toEqual({ masked: '           ', open: '%%' });
		expect(maskLine('end %% after^[y]', '%%').masked).toBe('       after^[y]');
		expect(maskLine('$$', null).open).toBe('$$');
	});

	it('reads a long line with many dollars in linear time', () => {
		const line = '$a '.repeat(50000);
		const start = performance.now();
		expect(maskLine(line).masked.length).toBe(line.length);
		expect(performance.now() - start).toBeLessThan(2000);
	});
});
