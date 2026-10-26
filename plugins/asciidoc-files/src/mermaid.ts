import { MarkdownRenderer, type App, type Component } from 'obsidian';
import { mermaidMarkdown } from './adoc/mermaid';

type DiagramState = 'rendered' | 'prompt' | 'failed' | 'stale';

/** The app can finish its code block after the Markdown render promise resolves. */
function waitForDiagram(el: HTMLElement, component: Component, current: () => boolean): Promise<DiagramState> {
	const state = (): DiagramState | null => {
		if (!current()) return 'stale';
		// Keep the app's vault trust prompt and the source that it supplies.
		if (el.querySelector('.mermaid-wrapper.is-guarded')) return 'prompt';
		const code = el.querySelector('pre > code.language-mermaid');
		if (code?.textContent?.startsWith('Error parsing Mermaid diagram!')) return 'failed';
		// A code block's copy button also has an SVG. It is not a diagram.
		const svg = Array.from(el.querySelectorAll('svg')).find((node) => !node.closest('button'));
		if (svg?.querySelector('.error-icon, .error-text')) return 'failed';
		if (svg) return 'rendered';
		return null;
	};
	const ready = state();
	if (ready) return Promise.resolve(ready);
	return new Promise((resolve) => {
		const finish = (result: DiagramState): void => {
			observer.disconnect();
			window.clearTimeout(timer);
			resolve(result);
		};
		const observer = new MutationObserver(() => {
			const result = state();
			if (result) finish(result);
		});
		const timer = window.setTimeout(() => finish('failed'), 10000);
		observer.observe(el, { childList: true, subtree: true });
		component.register(() => finish('stale'));
	});
}

/** Use the app's diagram renderer. Keep the source when a diagram cannot render. */
export async function renderMermaidBlocks(app: App, root: HTMLElement, path: string, component: Component, current: () => boolean, refresh: () => void = () => undefined): Promise<void> {
	for (const code of Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'))) {
		if (!current()) return;
		const pre = code.parentElement;
		if (!pre) continue;
		const diagram = createDiv({ cls: 'adoc-mermaid' });
		pre.before(diagram);
		try {
			await MarkdownRenderer.render(app, mermaidMarkdown(code.textContent ?? ''), diagram, path, component);
			const result = await waitForDiagram(diagram, component, current);
			if (result === 'stale') return;
			if (result === 'failed') throw new Error('No diagram was rendered.');
			if (result === 'prompt') {
				// The app refreshes Markdown views after Allow. Refresh this file view too.
				const onClick = (evt: MouseEvent): void => {
					if (evt.target instanceof Element && evt.target.closest('button')) queueMicrotask(() => { if (current()) refresh(); });
				};
				diagram.addEventListener('click', onClick, true);
				component.register(() => diagram.removeEventListener('click', onClick, true));
			}
			pre.remove();
		} catch {
			diagram.empty();
			diagram.createEl('p', { cls: 'adoc-error', text: 'The Mermaid diagram could not render. Check the source below.' });
		}
	}
}
