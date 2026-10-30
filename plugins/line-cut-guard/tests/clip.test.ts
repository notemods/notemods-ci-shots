// The DOM part with a real CodeMirror view in happy-dom. Clipboard events are plain objects with isTrusted, because a
// test cannot make a trusted event.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ClipGuard, lineCommand, markedIn, maybeSelected, resetLines, type GuardOptions } from '../src/clip';

const views: EditorView[] = [];
function editor(doc: string, sel?: EditorSelection, parent: HTMLElement = document.body): EditorView {
	const view = new EditorView({ state: EditorState.create({ doc, selection: sel, extensions: [EditorState.allowMultipleSelections.of(true)] }), parent });
	views.push(view);
	return view;
}
afterEach(() => {
	resetLines();
	for (const v of views.splice(0)) v.destroy();
	document.body.innerHTML = '';
});

interface FakeEvent { type: string; isTrusted: boolean; target: EventTarget | null; prevented: boolean; stopped: boolean; preventDefault(): void; stopImmediatePropagation(): void }
function clip(type: 'cut' | 'copy', target: EventTarget | null, isTrusted = true): FakeEvent {
	return {
		type, isTrusted, target, prevented: false, stopped: false,
		preventDefault() { this.prevented = true; },
		stopImmediatePropagation() { this.stopped = true; },
	};
}

function guard(opts: Partial<GuardOptions>, clock = { t: 1000 }) {
	const notices: string[] = [];
	const o: GuardOptions = { active: true, cut: 'block', copy: 'allow', notice: true, pro: false, ...opts };
	const g = new ClipGuard({ ['workspace']: { getActiveViewOfType: () => null } } as never, () => o, (t) => notices.push(t), () => clock.t);
	return { g, notices, o, clock };
}
const run = (g: ClipGuard, e: FakeEvent) => g.onClipboard(e as unknown as ClipboardEvent);
const key = (g: ClipGuard, repeat = false) => g.onKeyDown({ code: 'KeyX', key: 'x', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat } as KeyboardEvent);

describe('ClipGuard in a CodeMirror editor', () => {
	it('A1 stops a cut with only a cursor and shows one notice', () => {
		const v = editor('one\ntwo', EditorSelection.single(5));
		const { g, notices } = guard({});
		const e = clip('cut', v.contentDOM);
		run(g, e);
		expect([e.prevented, e.stopped]).toEqual([true, true]);
		expect(notices).toEqual(['Nothing is selected, so Ctrl+X did not cut the line.']);
	});

	it('A1 finds the editor from a text node target', () => {
		const v = editor('one\ntwo', EditorSelection.single(1));
		const text = v.contentDOM.querySelector('.cm-line')!.firstChild!;
		const { g } = guard({});
		const e = clip('cut', text);
		run(g, e);
		expect(e.prevented).toBe(true);
	});

	it('A2 lets a cut with a selection through', () => {
		const v = editor('one\ntwo', EditorSelection.single(0, 3));
		const { g, notices } = guard({});
		const e = clip('cut', v.contentDOM);
		run(g, e);
		expect(e.prevented).toBe(false);
		expect(notices).toEqual([]);
	});

	it('A6 stops with two empty cursors and passes with one cursor and one selection', () => {
		const a = editor('one\ntwo', EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(5)]));
		const { g } = guard({});
		const e1 = clip('cut', a.contentDOM);
		run(g, e1);
		expect(e1.prevented).toBe(true);
		const b = editor('one\ntwo', EditorSelection.create([EditorSelection.cursor(1), EditorSelection.range(4, 7)]));
		const e2 = clip('cut', b.contentDOM);
		run(g, e2);
		expect(e2.prevented).toBe(false);
	});

	it('A6 lets a cut through when table cells or an image are selected', () => {
		const v = editor('| a | b |\n|---|---|\n| 1 | 2 |', EditorSelection.single(2));
		const widget = v.contentDOM.appendChild(document.createElement('div'));
		widget.className = 'cm-table-widget';
		const td = widget.appendChild(document.createElement('td'));
		td.className = 'is-selected';
		const { g } = guard({});
		const e = clip('cut', v.contentDOM);
		run(g, e);
		expect(e.prevented).toBe(false);
		td.className = '';
		expect(markedIn(v.dom)).toBe(false);
		v.dom.classList.add('mod-image-selected');
		expect(markedIn(v.dom)).toBe(true);
	});

	it('A6 a table cell editor inside the note editor uses its own selection and the cell marks of the note editor', () => {
		const outer = editor('| a |\n|---|\n| 1 |', EditorSelection.single(0));
		const widget = outer.contentDOM.appendChild(document.createElement('div'));
		widget.className = 'cm-table-widget';
		const cell = editor('1', EditorSelection.single(1), widget.appendChild(document.createElement('td')));
		const { g } = guard({});
		const e1 = clip('cut', cell.contentDOM);
		run(g, e1);
		expect(e1.prevented).toBe(true);
		widget.appendChild(document.createElement('td')).className = 'is-selected';
		const e2 = clip('cut', cell.contentDOM);
		run(g, e2);
		expect(e2.prevented).toBe(false);
	});

	it('R6 text selected in a rendered part of the note (an embed) is a selection, so a copy passes', () => {
		const v = editor('Some text', EditorSelection.single(0));
		const embed = v.contentDOM.appendChild(document.createElement('div'));
		embed.className = 'internal-embed';
		embed.textContent = 'Text of the other note';
		const { g } = guard({ copy: 'block' });
		document.getSelection()!.selectAllChildren(embed);
		const e1 = clip('copy', embed);
		run(g, e1);
		expect(e1.prevented).toBe(false);
		document.getSelection()!.removeAllRanges();
		const e2 = clip('copy', v.contentDOM);
		run(g, e2);
		expect(e2.prevented).toBe(true);
	});

	it('R6 an editable field inside the editor (a property value) is not editor text', () => {
		const v = editor('one', EditorSelection.single(1));
		const field = v.contentDOM.appendChild(document.createElement('div'));
		field.setAttribute('contenteditable', 'true');
		const input = v.contentDOM.appendChild(document.createElement('input'));
		const { g } = guard({ copy: 'block' });
		for (const t of [field, input]) {
			const e = clip('cut', t);
			run(g, e);
			expect(e.prevented).toBe(false);
		}
	});

	it('A6 fail open without class names: read-only editor, cursor before an embed, unknown nested editor', () => {
		const ro = new EditorView({ state: EditorState.create({ doc: 'Ana', selection: EditorSelection.single(1), extensions: [EditorState.readOnly.of(true)] }), parent: document.body });
		views.push(ro);
		expect(maybeSelected(ro)).toBe(true);
		const img = editor('Text\n![[photo.png]]', EditorSelection.single(5));
		expect(maybeSelected(img)).toBe(true);
		const md = editor('Text\n[link](x)', EditorSelection.single(5));
		expect(maybeSelected(md)).toBe(false);
		const outer = editor('one', EditorSelection.single(0));
		const box = outer.contentDOM.appendChild(document.createElement('div'));
		const inner = editor('two', EditorSelection.single(1), box);
		expect(maybeSelected(inner)).toBe(true);
		const { g } = guard({});
		for (const v of [ro, img, inner]) {
			const e = clip('cut', v.contentDOM);
			run(g, e);
			expect(e.prevented).toBe(false);
		}
	});

	it('A3 mode allow, plugin off and untrusted events do nothing', () => {
		const v = editor('one', EditorSelection.single(1));
		for (const [opts, trusted] of [[{ cut: 'allow' as const }, true], [{ active: false }, true], [{}, false]] as const) {
			const { g, notices } = guard(opts);
			const e = clip('cut', v.contentDOM, trusted);
			run(g, e);
			expect([e.prevented, notices.length]).toEqual([false, 0]);
		}
	});

	it('A4 copy mode block stops a copy with nothing selected, copy default lets it through', () => {
		const v = editor('one', EditorSelection.single(1));
		const blocked = guard({ copy: 'block' });
		const e1 = clip('copy', v.contentDOM);
		run(blocked.g, e1);
		expect(e1.prevented).toBe(true);
		expect(blocked.notices).toEqual(['Nothing is selected, so Ctrl+C did not copy the line. Your clipboard did not change.']);
		const dflt = guard({});
		const e2 = clip('copy', v.contentDOM);
		run(dflt.g, e2);
		expect(e2.prevented).toBe(false);
	});

	it('R6 a target outside an editor is not touched (input, file list)', () => {
		const input = document.body.appendChild(document.createElement('input'));
		const { g } = guard({ copy: 'block' });
		for (const kind of ['cut', 'copy'] as const) {
			const e = clip(kind, input);
			run(g, e);
			expect(e.prevented).toBe(false);
		}
	});

	it('A8 notices: at most one in 2 seconds, none with the setting off', () => {
		const v = editor('one', EditorSelection.single(1));
		const clock = { t: 1000 };
		const { g, notices } = guard({}, clock);
		run(g, clip('cut', v.contentDOM));
		clock.t = 2999;
		run(g, clip('cut', v.contentDOM));
		clock.t = 3000;
		run(g, clip('cut', v.contentDOM));
		expect(notices.length).toBe(2);
		const off = guard({ notice: false });
		const e = clip('cut', v.contentDOM);
		run(off.g, e);
		expect([e.prevented, off.notices.length]).toEqual([true, 0]);
	});

	it('A7 Pro second press: stop, then pass 500 ms later; a held key does not count; an edit starts again', () => {
		const v = editor('one\ntwo', EditorSelection.single(5));
		const clock = { t: 1000 };
		const { g, notices } = guard({ cut: 'twice', pro: true, notice: false }, clock);
		key(g);
		const e1 = clip('cut', v.contentDOM);
		run(g, e1);
		expect(e1.prevented).toBe(true);
		expect(notices).toEqual(['Nothing is selected. Press Ctrl+X again to cut the line.']);
		clock.t = 1400;
		key(g, true);
		const held = clip('cut', v.contentDOM);
		run(g, held);
		expect(held.prevented).toBe(true);
		clock.t = 1600;
		key(g);
		const e2 = clip('cut', v.contentDOM);
		run(g, e2);
		expect(e2.prevented).toBe(false);
		// An editor update that changes neither the text nor the selection keeps the first press.
		clock.t = 4000;
		run(g, clip('cut', v.contentDOM));
		v.dispatch({});
		clock.t = 4500;
		const kept = clip('cut', v.contentDOM);
		run(g, kept);
		expect(kept.prevented).toBe(false);
		// New first press, then the user types: the text changes, so the next press is a first press again.
		clock.t = 5000;
		run(g, clip('cut', v.contentDOM));
		v.dispatch({ changes: { from: 0, insert: 'x' } });
		clock.t = 5500;
		const e3 = clip('cut', v.contentDOM);
		run(g, e3);
		expect(e3.prevented).toBe(true);
		expect(notices.length).toBe(4);
	});

	it('A7 the second press mode without Pro acts as Does nothing', () => {
		const v = editor('one', EditorSelection.single(1));
		const clock = { t: 1000 };
		const { g, notices } = guard({ cut: 'twice', pro: false }, clock);
		run(g, clip('cut', v.contentDOM));
		clock.t = 1500;
		const e = clip('cut', v.contentDOM);
		run(g, e);
		expect(e.prevented).toBe(true);
		expect(notices).toEqual(['Nothing is selected, so Ctrl+X did not cut the line.']);
	});
});

describe('line commands', () => {
	it('A5 cut with a cursor writes the line, then removes it with the line break', async () => {
		const v = editor('a\nb\nc', EditorSelection.single(2));
		const write = vi.fn(async () => {});
		expect(await lineCommand(v, 'cut', write)).toBe('done');
		expect(write).toHaveBeenCalledWith('b');
		expect(v.state.doc.toString()).toBe('a\nc');
	});

	it('A5 copy does not change the note; cut of a selection removes only the selection', async () => {
		const v = editor('alpha\nbeta', EditorSelection.single(1));
		const write = vi.fn(async () => {});
		await lineCommand(v, 'copy', write);
		expect(write).toHaveBeenLastCalledWith('alpha');
		expect(v.state.doc.toString()).toBe('alpha\nbeta');
		// A new editor: happy-dom fires selectionchange inside a dispatch after focus, which a browser does not do.
		const w = editor('alpha\nbeta', EditorSelection.single(6, 8));
		await lineCommand(w, 'cut', write);
		expect(write).toHaveBeenLastCalledWith('be');
		expect(w.state.doc.toString()).toBe('alpha\nta');
	});

	it('A5 two cursors on two lines cut both lines', async () => {
		const v = editor('a\nb\nc', EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(4)]));
		const write = vi.fn(async () => {});
		await lineCommand(v, 'cut', write);
		expect(write).toHaveBeenCalledWith('a\nc');
		expect(v.state.doc.toString()).toBe('b\n');
	});

	it('A5 a failed clipboard write keeps the note', async () => {
		const v = editor('a\nb', EditorSelection.single(0));
		const result = await lineCommand(v, 'cut', async () => {
			throw new Error('denied');
		});
		expect(result).toBe('no-clipboard');
		expect(v.state.doc.toString()).toBe('a\nb');
	});

	it('A5 an edit while the clipboard write waits keeps the note', async () => {
		const v = editor('a\nb', EditorSelection.single(0));
		const result = await lineCommand(v, 'cut', async () => {
			v.dispatch({ changes: { from: 3, insert: '!' } });
		});
		expect(result).toBe('done');
		expect(v.state.doc.toString()).toBe('a\nb!');
	});

	it('A6 a selected image or cell range: the command does nothing', async () => {
		const v = editor('![[x.png]]', EditorSelection.single(0));
		v.dom.classList.add('mod-image-selected');
		const write = vi.fn(async () => {});
		expect(await lineCommand(v, 'cut', write)).toBe('marked');
		expect(write).not.toHaveBeenCalled();
		expect(v.state.doc.toString()).toBe('![[x.png]]');
	});

	it('A5 after a line cut of the command, a paste of the same text puts the whole line above the cursor line', async () => {
		const v = editor('Alpha\nBravo\nCharlie', EditorSelection.single(8));
		await lineCommand(v, 'cut', async () => {});
		expect(v.state.doc.toString()).toBe('Alpha\nCharlie');
		v.dispatch({ selection: EditorSelection.single(8) });
		const { g } = guard({});
		const paste = { ...clip('copy', v.contentDOM), type: 'paste', clipboardData: { getData: () => 'Bravo' } };
		g.onPaste(paste as unknown as ClipboardEvent);
		expect(paste.prevented).toBe(true);
		expect(v.state.doc.toString()).toBe('Alpha\nBravo\nCharlie');
		// Other text, or a user cut or copy in between: a normal paste.
		const other = { ...clip('copy', v.contentDOM), type: 'paste', clipboardData: { getData: () => 'Other' } };
		g.onPaste(other as unknown as ClipboardEvent);
		expect(other.prevented).toBe(false);
		run(g, clip('copy', v.contentDOM));
		const later = { ...clip('copy', v.contentDOM), type: 'paste', clipboardData: { getData: () => 'Bravo' } };
		g.onPaste(later as unknown as ClipboardEvent);
		expect(later.prevented).toBe(false);
	});
});
