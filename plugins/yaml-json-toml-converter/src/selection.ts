import type { Editor, EditorPosition } from 'obsidian';
export interface SelectionSnapshot { source: string; document: string; from: EditorPosition; to: EditorPosition }
export function capture(editor: Editor): SelectionSnapshot {
	return { source: editor.getSelection(), document: editor.getValue(), from: { ...editor.getCursor('from') }, to: { ...editor.getCursor('to') } };
}
export function replaceGuarded(editor: Editor, snapshot: SelectionSnapshot, output: string): void {
	if (editor.getValue() !== snapshot.document || editor.getRange(snapshot.from, snapshot.to) !== snapshot.source) throw new Error('Source changed. Close this preview and select the data again.');
	editor.replaceRange(output, snapshot.from, snapshot.to);
}
