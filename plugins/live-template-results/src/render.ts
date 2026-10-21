import { Component, MarkdownRenderer, type App } from 'obsidian';
import { rendererInput } from './model';

export const NO_RESULT = 'No result produced. Enable Templater and check this command.';

export async function renderCommand(app: App, source: string, path: string, owner: Component): Promise<string> {
 const child = owner.addChild(new Component());
 const el = createDiv();
 try {
  await MarkdownRenderer.render(app, rendererInput(source), el, path, child);
  const text = el.textContent ?? '';
  if (text === source) throw new Error(NO_RESULT);
  return text;
 } finally {
  owner.removeChild(child);
  el.remove();
 }
}
