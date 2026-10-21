import { editorInfoField } from 'obsidian';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type TaskFieldLabelsPlugin from './main';
import type { LabelsRenderChild } from './adapter';

/** Live Preview runs code block renderers without general Markdown post processors. */
export function labelsEditorExtension(plugin: TaskFieldLabelsPlugin) {
	return ViewPlugin.fromClass(class {
		private readonly child: LabelsRenderChild;
		private path: string;
		constructor(private readonly view: EditorView) {
			this.path = this.sourcePath();
			this.child = plugin.createChild(view.dom, () => this.sourcePath());
			this.child.load();
		}
		private sourcePath(): string {
			return this.view.state.field(editorInfoField, false)?.file?.path ?? '';
		}
		update(): void {
			const path = this.sourcePath();
			if (path === this.path) return;
			this.path = path;
			this.child.adapter.refresh();
		}
		destroy(): void {
			this.child.unload();
		}
	});
}
