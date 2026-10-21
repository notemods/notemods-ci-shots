import type { Editor, EditorPosition } from 'obsidian';
import { editText } from './converter';

export interface Snapshot {
	text: string;
	document: string;
	from: EditorPosition;
	to: EditorPosition;
}

export function snapshot(editor: Editor): Snapshot {
	return { text: editor.getSelection(), document: editor.getValue(), from: { ...editor.getCursor('from') }, to: { ...editor.getCursor('to') } };
}

export function sameSnapshot(saved: Snapshot, current: Snapshot): boolean {
	return current.document === saved.document && current.text === saved.text && current.from.line === saved.from.line && current.from.ch === saved.from.ch && current.to.line === saved.to.line && current.to.ch === saved.to.ch;
}

export function isFresh(editor: Editor, saved: Snapshot): boolean {
	return editor.listSelections().length === 1 && sameSnapshot(saved, snapshot(editor));
}

/** One transaction gives the edit one undo step. A changed document needs a new preview. */
export function applyEdit(editor: Editor, saved: Snapshot, output: string, mode: 'insert' | 'replace'): boolean {
	if (!isFresh(editor, saved)) return false;
	editor.transaction({ changes: [{ from: saved.from, to: saved.to, text: editText(saved.text, output, mode) }] }, 'epoch-note-converter');
	return true;
}
