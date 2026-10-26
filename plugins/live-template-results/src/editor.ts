import { StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Component, editorInfoField, editorLivePreviewField } from 'obsidian';
import { commands, planNote, type Snapshot } from './model';
import { isPro } from './pro';
import { renderCommand } from './render';
import type LiveTemplateResultsPlugin from './main';

const redraw = StateEffect.define<null>();

class ResultWidget extends WidgetType {
 constructor(readonly text: string, readonly from: number, readonly error: boolean) { super(); }
 eq(other: ResultWidget): boolean { return other.text === this.text && other.from === this.from && other.error === this.error; }
 toDOM(view: EditorView): HTMLElement {
  const el = createSpan();
  el.className = this.error ? 'ltr-error' : 'ltr-result';
  el.textContent = this.error ? ` ${this.text}` : this.text || '(empty result)';
  el.setAttribute('aria-label', this.error ? this.text : `Template result: ${this.text}. Edit command.`);
  el.setAttribute('role', 'button'); el.tabIndex = 0;
  const edit = () => { view.dispatch({ selection: { anchor: this.from + 3 }, scrollIntoView: true }); view.focus(); };
  el.addEventListener('pointerdown', (event) => { event.preventDefault(); edit(); });
  el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); } });
  return el;
 }
 ignoreEvent(): boolean { return false; }
}

export class ResultsEditor {
 decorations: DecorationSet = Decoration.none;
 snapshot?: Snapshot;
 pending: Promise<void> = Promise.resolve();
 busy = false;
 private generation = 0;
 private running = 0;
 private dead = false;
 private active = false;
 private ownerPath = '';
 private metadataSource?: string;
 private scope = new Component();
 constructor(readonly view: EditorView, readonly plugin: LiveTemplateResultsPlugin) {
  this.scope.load();
  plugin.editors.add(this);
  // Dispatch only after the host finishes its current editor update.
  queueMicrotask(() => { if (!this.dead) this.sync(); });
 }
 get path(): string { return this.view.state.field(editorInfoField, false)?.file?.path ?? ''; }
 get source(): string { return this.view.state.doc.toString(); }
 get metadataPending(): boolean { return this.metadataSource !== undefined; }
 get allowed(): boolean { return !!this.view.state.field(editorLivePreviewField, false) && this.plugin.isEnabled(this.path); }
 update(update: ViewUpdate): void {
  const switched = this.ownerPath !== this.path || this.active !== this.allowed;
  if (switched) { queueMicrotask(() => { if (!this.dead) this.sync(); }); }
  if (update.docChanged) {
   this.invalidate();
   if (this.metadataSource !== undefined) queueMicrotask(() => this.flushMetadataRefresh());
  }
  if (update.docChanged || update.selectionSet || switched || update.transactions.some((t) => t.effects.some((e) => e.is(redraw)))) this.draw();
 }
 sync(): void {
  const changed = this.ownerPath !== this.path || this.active !== this.allowed;
  this.ownerPath = this.path; this.active = this.allowed;
  if (!this.active || !isPro()) this.metadataSource = undefined;
  if (changed) {
   this.invalidate();
   if (this.active) { void this.refresh(); return; }
  }
  this.paint();
 }
 requestMetadataRefresh(source: string): void {
  if (this.busy || this.running > 0 || !this.allowed || !isPro()) return;
  this.metadataSource = source;
  this.flushMetadataRefresh();
 }
 private flushMetadataRefresh(): void {
  if (this.dead || !isPro() || !this.allowed) { this.metadataSource = undefined; return; }
  if (this.metadataSource === this.source && !this.busy && this.running === 0) {
   this.metadataSource = undefined;
   void this.refresh();
  }
 }
 invalidate(): void {
  this.generation++;
  this.snapshot = undefined;
  this.busy = false;
  this.scope.unload(); this.scope = new Component();
  if (!this.dead) this.scope.load();
 }
 refresh(): Promise<void> {
  this.invalidate();
  if (!this.allowed || this.dead) { this.paint(); return Promise.resolve(); }
  const generation = this.generation, path = this.path, source = this.source, scope = this.scope;
  const valid = () => !this.dead && this.generation === generation && this.allowed && this.path === path && this.source === source;
  this.snapshot = { path, source, results: [] };
  this.busy = true;
  this.plugin.rememberMetadata(path);
  this.paint();
  this.pending = (async () => {
   for (const command of commands(source)) {
    if (!valid()) break;
    try {
     const text = await this.plugin.queue.run(valid, async () => {
      this.running++;
      try { return await renderCommand(this.plugin.app, command.source, path, scope); }
      finally { this.running--; }
     });
     if (valid() && text !== undefined) this.snapshot!.results.push({ ...command, text });
    } catch (error) {
     if (valid()) this.snapshot!.results.push({ ...command, error: error instanceof Error ? error.message : 'No result produced.' });
    }
    if (valid()) this.paint();
   }
   if (valid()) { this.busy = false; this.paint(); }
  })();
  return this.pending;
 }
 private paint(): void {
  if (this.dead) return;
  this.view.dispatch({ effects: redraw.of(null) });
  this.plugin.drawPanels();
 }
 private draw(): void {
  const planned = planNote({ path: this.path, source: this.source, enabled: this.plugin.isEnabled(this.path), live: !!this.view.state.field(editorLivePreviewField, false), selections: this.view.state.selection.ranges, snapshot: this.snapshot });
  this.decorations = Decoration.set(planned.flatMap((r) => {
   if (r.display === 'result') return [Decoration.replace({ widget: new ResultWidget(r.text, r.from, false) }).range(r.from, r.to)];
   if (r.display === 'error') return [Decoration.widget({ widget: new ResultWidget(r.text, r.from, true), side: 1 }).range(r.to)];
   return [];
  }), true);
 }
 destroy(): void { this.dead = true; this.invalidate(); this.plugin.editors.delete(this); this.plugin.drawPanels(); }
}

export function resultsExtension(plugin: LiveTemplateResultsPlugin) {
 return ViewPlugin.fromClass(class extends ResultsEditor { constructor(view: EditorView) { super(view, plugin); } }, { decorations: (v) => v.decorations });
}
