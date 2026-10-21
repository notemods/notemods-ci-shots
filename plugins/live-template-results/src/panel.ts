import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { isPro, PRO_UI } from './pro';
import type LiveTemplateResultsPlugin from './main';
export const PANEL = 'live-template-results-panel';
export class ResultsPanel extends ItemView {
 constructor(leaf: WorkspaceLeaf, readonly plugin: LiveTemplateResultsPlugin) { super(leaf); }
 getViewType(): string { return PANEL; }
 getDisplayText(): string { return PRO_UI.panelTitle; }
 async onOpen(): Promise<void> { this.draw(); }
 draw(): void {
  this.contentEl.empty(); this.contentEl.addClass('ltr-panel');
  this.contentEl.createEl('h4', { text: this.getDisplayText() });
  if (!isPro()) { this.contentEl.createEl('p', { text: 'Sign in with a GitHub account that meets the payment requirement to use this panel. Free results stay in the editor.' }); return; }
  let count = 0;
  for (const editor of this.plugin.editors) {
   if (!editor.allowed) continue;
   const section = this.contentEl.createDiv();
   section.createEl('h5', { text: editor.path });
   if (editor.busy) section.createEl('p', { text: 'Render in progress…' });
   const results = editor.snapshot?.results ?? [];
   if (!results.length) section.createEl('p', { text: 'No cached results. Use the refresh command in this note.' });
   for (const result of results) {
    count++;
    section.createEl('code', { text: result.source });
    section.createEl('p', { text: result.error ?? result.text ?? '', cls: result.error ? 'ltr-error' : 'ltr-panel-result' });
   }
  }
  if (!count) this.contentEl.createEl('p', { text: 'Open an enabled note in live preview to show results here.' });
 }
}
