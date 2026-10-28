import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { spellFocusRange } from './core/index';
import type { FocusScope } from './policy';

export function focusExtension(policy: (path: string) => FocusScope, highlight: boolean) {
 return ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate): void {
   if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) this.decorations = this.build(update.view);
  }
  build(view: EditorView): DecorationSet {
   const file = view.state.field(editorInfoField, false)?.file;
   const scope = policy(file?.path ?? '');
   if (scope === 'off') return Decoration.none;
   const selection = view.state.selection;
   const active = view.hasFocus && selection.ranges.length === 1
    ? spellFocusRange(view.state.doc.toString(), selection.main.head, scope) : null;
   const ranges = new RangeSetBuilder<Decoration>();
   const seen = new Set<number>();
   for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
     if (!seen.has(line.from)) {
      seen.add(line.from);
      const inside = active !== null && line.from >= active.from && line.from <= active.to;
      const attributes: Record<string, string> = { 'data-spell-focus': inside ? 'active' : 'muted' };
      // Never set true: the native global setting and syntax exclusions remain authoritative.
      if (!inside) attributes.spellcheck = 'false';
      if (inside && highlight) attributes.class = 'paragraph-spell-focus-active';
      ranges.add(line.from, line.from, Decoration.line({ attributes }));
     }
     if (line.number >= view.state.doc.lines) break;
     line = view.state.doc.line(line.number + 1);
    }
   }
   return ranges.finish();
  }
 }, { decorations: value => value.decorations });
}
