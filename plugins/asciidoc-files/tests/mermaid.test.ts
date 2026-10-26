import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Component, MarkdownRenderer } from 'obsidian';
import vectors from './vectors/asciidoc-files.json';
import { mermaidMarkdown, prepareMermaid } from '../src/adoc/mermaid';
import { renderMermaidBlocks } from '../src/mermaid';
import { convert } from '../src/render';
import { sanitizeHtml } from '../src/adoc/sanitize';

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('Mermaid golden vectors', () => {
	for (const c of vectors.mermaid.cases) it(c.name, () => expect(prepareMermaid(c.args[0]!)).toBe(c.expected));
	for (const c of vectors.mermaidMarkdown.cases) it(c.name, () => expect(mermaidMarkdown(c.args[0]!)).toBe(c.expected));
});

describe('AsciiDoc diagram source', () => {
	it.each(['[mermaid]', '[source,mermaid]', '[,mermaid]'])('keeps the source of %s in preview and export', async (style) => {
		for (const target of ['preview', 'export'] as const) {
			const out = await convert({ text: `${style}\n----\nflowchart LR\nA --> B\n----`, path: 'docs/a.adoc', target });
			expect(out.html).toContain('class="language-mermaid"');
			expect(out.html).toContain('A --&gt; B');
			expect(sanitizeHtml(out.html)).toBe(out.html);
		}
	});
	it.each([
		'[mermaid,release-flow,svg]\n----\nA --> B\n----',
		'[mermaid]\n....\nA --> B\n....',
		'[mermaid]\n.Release flow\n----\nA --> B\n----',
	])('keeps the diagram extension form %j as diagram source', async (text) => {
		const out = await convert({ text, path: 'docs/a.adoc', target: 'preview' });
		expect(out.html).toContain('class="language-mermaid"');
		expect(out.html).toContain('A --&gt; B');
	});
});

function listing(language: string, text: string): HTMLElement {
	const root = createDiv();
	const pre = root.createEl('pre');
	pre.createEl('code', { cls: `language-${language}`, text });
	return root;
}

describe('diagram preview', () => {
	const app = {} as App;
	it('uses the public renderer with the source path and a lifecycle component', async () => {
		const root = listing('mermaid', 'flowchart LR\nA --> B');
		const component = new Component();
		const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
			el.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
		});
		await renderMermaidBlocks(app, root, 'docs/a.adoc', component, () => true);
		expect(render).toHaveBeenCalledWith(app, '```mermaid\nflowchart LR\nA --> B\n```', root.querySelector('.adoc-mermaid'), 'docs/a.adoc', component);
		expect(root.querySelector('pre')).toBeNull();
		expect(root.querySelector('.adoc-mermaid svg')).not.toBeNull();
	});
	it('keeps source and a visible note if the renderer rejects the diagram', async () => {
		const root = listing('mermaid', 'bad <source>');
		vi.spyOn(MarkdownRenderer, 'render').mockRejectedValue(new Error('invalid diagram'));
		await renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => true);
		expect(root.querySelector('code')?.textContent).toBe('bad <source>');
		expect(root.querySelector('.adoc-error')?.textContent).toContain('could not render');
		expect(root.querySelector('source')).toBeNull();
	});
	it('keeps source when the renderer returns no SVG', async () => {
		vi.useFakeTimers();
		const root = listing('mermaid', 'bad');
		vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue();
		const pending = renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => true);
		await vi.runAllTimersAsync();
		await pending;
		expect(root.querySelector('code')?.textContent).toBe('bad');
		expect(root.querySelector('.adoc-error')).not.toBeNull();
	});
	it('waits for a diagram that arrives after the Markdown promise', async () => {
		const root = listing('mermaid', 'flowchart LR\nA --> B');
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
			window.setTimeout(() => el.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg')), 20);
		});
		await renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => true);
		expect(root.querySelector('svg')).not.toBeNull();
		expect(root.querySelector('pre')).toBeNull();
	});
	it('cancels the wait when the preview component unloads', async () => {
		const root = listing('mermaid', 'flowchart LR\nA --> B');
		const component = new Component();
		component.load();
		vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue();
		const pending = renderMermaidBlocks(app, root, 'a.adoc', component, () => true);
		await Promise.resolve();
		component.unload();
		await pending;
		expect(root.querySelector('pre')).not.toBeNull();
		expect(root.querySelector('.adoc-error')).toBeNull();
	});
	it('keeps the source when Mermaid returns an error SVG', async () => {
		const root = listing('mermaid', 'bad');
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			text.setAttribute('class', 'error-text');
			svg.append(text);
			el.append(svg);
		});
		await renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => true);
		expect(root.querySelector('code')?.textContent).toBe('bad');
		expect(root.querySelector('.adoc-error')).not.toBeNull();
		expect(root.querySelector('svg')).toBeNull();
	});
	it('does not treat a copy button SVG as a rendered diagram', async () => {
		const root = listing('mermaid', 'this is not a diagram');
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
			const pre = el.createEl('pre');
			pre.createEl('code', { cls: 'language-mermaid', text: 'Error parsing Mermaid diagram!\nNo diagram type detected.' });
			pre.createEl('button', { text: 'Copy' }).append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
		});
		await renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => true);
		expect(root.querySelector('code')?.textContent).toBe('this is not a diagram');
		expect(root.querySelector('.adoc-error')).not.toBeNull();
	});
	it('keeps the app trust prompt and its source without an error note', async () => {
		const root = listing('mermaid', 'flowchart LR\nA --> B');
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _markdown, el) => {
			const prompt = el.createDiv({ cls: 'mermaid-wrapper is-guarded' });
			prompt.createEl('button', { text: 'Allow' });
			prompt.append(listing('mermaid', 'flowchart LR\nA --> B'));
		});
		const refresh = vi.fn();
		await renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => true, refresh);
		expect(root.querySelectorAll('pre')).toHaveLength(1);
		expect(root.querySelector('button')?.textContent).toBe('Allow');
		expect(root.querySelector('.adoc-error')).toBeNull();
		root.querySelector<HTMLButtonElement>('button')?.click();
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledTimes(1);
	});
	it('does not render other code languages', async () => {
		const root = listing('js', 'const a = 1;');
		const render = vi.spyOn(MarkdownRenderer, 'render');
		await renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => true);
		expect(render).not.toHaveBeenCalled();
		expect(root.querySelector('code')?.textContent).toBe('const a = 1;');
	});
	it('stops processing blocks when a newer preview replaces this one', async () => {
		const root = listing('mermaid', 'flowchart LR\nA --> B');
		root.append(listing('mermaid', 'flowchart LR\nB --> C'));
		let current = true;
		const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async () => { current = false; });
		await renderMermaidBlocks(app, root, 'a.adoc', new Component(), () => current);
		expect(render).toHaveBeenCalledTimes(1);
		expect(root.querySelectorAll('pre')).toHaveLength(2);
	});
});
