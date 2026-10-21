import { editorInfoField } from 'obsidian';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { Capture } from './model';

export const FORM = '.kanban-plugin__item-form';
export function captureContext(dom: HTMLElement, board: string | undefined): { board: string; lane: string } | null {
	const form = dom.closest(FORM);
	const lane = form?.closest('.kanban-plugin__lane');
	if (!form || !lane || !board) return null;
	return { board, lane: lane.querySelector('.kanban-plugin__lane-title-text')?.textContent?.trim() || 'Unknown lane' };
}

/** One identity per nonempty editor session. Lane titles are context only. */
export function draftExtension(onCapture: (capture: Capture) => void): ReturnType<typeof EditorView.updateListener.of> {
	const sessions = new WeakMap<EditorView, { id: string; board: string; lane: string }>();
	return EditorView.updateListener.of((update: ViewUpdate) => {
		if (!update.docChanged) return;
		const context = captureContext(update.view.dom, update.state.field(editorInfoField, false)?.file?.path);
		if (!context) return;
		const text = update.state.doc.toString();
		if (!text.trim()) {
			sessions.delete(update.view);
			return;
		}
		let session = sessions.get(update.view);
		if (!session || session.board !== context.board) {
			session = { ...context, id: crypto.randomUUID() };
			sessions.set(update.view, session);
		}
		onCapture({ ...session, text, at: Date.now() });
	});
}
