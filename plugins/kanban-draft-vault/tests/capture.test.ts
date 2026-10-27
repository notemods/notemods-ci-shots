import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { captureContext, draftExtension } from '../src/capture';
import type { Capture } from '../src/model';

vi.mock('obsidian', async (original) => {
	const actual = await original<Record<string, unknown>>();
	const { StateField } = await import('@codemirror/state');
	return { ...actual, editorInfoField: StateField.define({ create: () => ({ file: { path: 'Board A.md' } }), update: (value) => value }) };
});
const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.empty(); });
function newEditor(callback: (capture: Capture) => void, label = 'Todo', formClass = 'kanban-plugin__item-form') {
	const lane = document.body.createDiv({ cls: 'kanban-plugin__lane' });
	lane.createDiv({ cls: 'kanban-plugin__lane-title-text', text: label });
	const form = lane.createDiv({ cls: formClass });
	const view = new EditorView({ state: EditorState.create({ extensions: [editorInfoField, draftExtension(callback)] }), parent: form });
	views.push(view); return view;
}
function set(view: EditorView, text: string) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); }

describe('public editor extension', () => {
	it('scopes capture to the new-card form and gets the owner file', () => {
		const captures: Capture[] = []; const view = newEditor((value) => captures.push(value));
		set(view, 'Call Ana'); expect(captures[0]).toMatchObject({ board: 'Board A.md', lane: 'Todo', text: 'Call Ana' });
	});
	it('does not capture existing-card, lane-title or normal-note editors', () => {
		const callback = vi.fn();
		for (const cls of ['kanban-plugin__item', 'kanban-plugin__lane-title', 'markdown-source-view']) set(newEditor(callback, 'Todo', cls), 'Private note text');
		expect(callback).not.toHaveBeenCalled();
	});
	it('rejects a new-card form with no owner file', () => {
		const view = newEditor(() => {});
		expect(captureContext(view.dom, undefined)).toBeNull();
	});
	it('uses separate identities for two lanes with the same title', () => {
		const captures: Capture[] = [];
		set(newEditor((value) => captures.push(value)), 'First lane');
		set(newEditor((value) => captures.push(value)), 'Second lane');
		expect(captures[0]?.id).not.toBe(captures[1]?.id);
		expect(captures.map((c) => c.lane)).toEqual(['Todo', 'Todo']);
	});
	it('keeps the same identity during typing and the captured label after a rename', () => {
		const captures: Capture[] = []; const view = newEditor((value) => captures.push(value));
		set(view, 'Call'); view.dom.closest('.kanban-plugin__lane')!.querySelector('.kanban-plugin__lane-title-text')!.textContent = 'Next';
		set(view, 'Call Ana'); expect(captures[0]?.id).toBe(captures[1]?.id); expect(captures[1]?.lane).toBe('Todo');
	});
	it('ignores empty changes and makes a new identity after submission clears the editor', () => {
		const captures: Capture[] = []; const view = newEditor((value) => captures.push(value));
		set(view, 'Card one'); set(view, ''); set(view, 'Card two');
		expect(captures.map((c) => c.text)).toEqual(['Card one', 'Card two']);
		expect(captures[0]?.id).not.toBe(captures[1]?.id);
	});
	it('does not erase a record on editor destruction', () => {
		const callback = vi.fn(); const view = newEditor(callback); set(view, 'Line one\nLine two');
		views.splice(views.indexOf(view), 1); view.destroy();
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback.mock.calls[0]![0].text).toBe('Line one\nLine two');
	});
});
