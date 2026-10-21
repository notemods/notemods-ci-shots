// The tab for an AsciiDoc file: CodeMirror source, rendered preview, or both side by side.
import { Component, Keymap, TextFileView, loadPrism, sanitizeHTMLToDom, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { createEditor, revealLine, setEditorText } from './editor';
import type { IncludeRecord } from './adoc/includes';
import { classifyHref } from './adoc/links';
import { extractOutline } from './adoc/outline';
import { dirOf, isUrl, joinPath } from './adoc/paths';
import { convert } from './render';
import { renderMermaidBlocks } from './mermaid';
import type { ViewMode } from './settings';
import type AsciidocFilesPlugin from './main';

export const VIEW_TYPE = 'asciidoc-files';

interface PrismLike {
	highlightElement(el: Element): void;
}

const isMode = (m: unknown): m is ViewMode => m === 'preview' || m === 'source' || m === 'split';

export class AsciidocView extends TextFileView {
	plugin: AsciidocFilesPlugin;
	mode: ViewMode;
	editor: EditorView | null = null;
	previewEl!: HTMLElement;
	sourceEl!: HTMLElement;
	/** Includes of the last render (the links panel lists them). */
	includes: IncludeRecord[] = [];
	/** Text of the last render after include expansion (the links panel reads the outline from it). */
	expanded = '';
	private sourceAction: HTMLElement | null = null;
	private splitAction: HTMLElement | null = null;
	private timer = 0;
	private seq = 0;
	private previewComponent: Component | null = null;
	private onEdit = (text: string): void => {
		this.data = text;
		this.requestSave();
		this.scheduleRender();
		this.plugin.refreshLinksSoon();
	};

	constructor(leaf: WorkspaceLeaf, plugin: AsciidocFilesPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.mode = plugin.settings.mode;
		this.contentEl.addClass('adoc-view');
		this.sourceEl = this.contentEl.createDiv({ cls: 'adoc-source' });
		this.previewEl = this.contentEl.createDiv({ cls: 'adoc-preview markdown-rendered' });
		this.editor = createEditor(this.sourceEl, this.onEdit);
		this.registerDomEvent(this.previewEl, 'click', (evt) => this.onPreviewClick(evt));
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getIcon(): string {
		return 'file-code';
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'AsciiDoc';
	}

	async onOpen(): Promise<void> {
		this.sourceAction = this.addAction('code', 'Show the source', () => this.setMode(this.mode === 'source' ? 'preview' : 'source'));
		this.splitAction = this.addAction('columns-2', 'Show source and preview side by side', () => this.setMode(this.mode === 'split' ? 'preview' : 'split'));
		this.applyMode();
		await super.onOpen();
	}

	async onClose(): Promise<void> {
		++this.seq;
		window.clearTimeout(this.timer);
		this.clearPreviewComponent();
		this.editor?.destroy();
		this.editor = null;
		await super.onClose();
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), mode: this.mode };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const mode = (state as { mode?: unknown } | null)?.mode;
		if (isMode(mode)) this.mode = mode;
		await super.setState(state, result);
		this.applyMode();
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, clear: boolean): void {
		this.data = data;
		if (this.editor) setEditorText(this.editor, data, clear, this.onEdit);
		if (clear) this.previewEl.scrollTop = 0;
		void this.render();
	}

	clear(): void {
		++this.seq;
		window.clearTimeout(this.timer);
		this.clearPreviewComponent();
		this.data = '';
		this.includes = [];
		this.expanded = '';
		this.previewEl.empty();
	}

	setMode(mode: ViewMode): void {
		this.mode = mode;
		this.applyMode();
		this.app.workspace.requestSaveLayout();
		if (mode !== 'preview') this.editor?.focus();
	}

	private applyMode(): void {
		this.contentEl.toggleClass('is-source', this.mode === 'source');
		this.contentEl.toggleClass('is-preview', this.mode === 'preview');
		this.contentEl.toggleClass('is-split', this.mode === 'split');
		if (this.sourceAction) {
			setIcon(this.sourceAction, this.mode === 'source' ? 'book-open' : 'code');
			this.sourceAction.setAttribute('aria-label', this.mode === 'source' ? 'Show the preview' : 'Show the source');
		}
		this.splitAction?.toggleClass('is-active', this.mode === 'split');
	}

	scheduleRender(): void {
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => void this.render(), this.plugin.settings.delay);
	}

	/** Renders the current text into the preview. Older renders that finish late are dropped. */
	async render(): Promise<void> {
		const file = this.file;
		if (!file) return;
		const seq = ++this.seq;
		const expanded = await this.plugin.expand(this.data, file.path);
		let frag: DocumentFragment;
		let warnings: string[] = [];
		try {
			const out = await convert({ text: expanded.text, path: file.path, target: 'preview' });
			frag = sanitizeHTMLToDom(out.html);
			warnings = out.warnings;
		} catch (e) {
			frag = createFragment((f) => f.createEl('p', { cls: 'adoc-error', text: `The preview failed: ${e instanceof Error ? e.message : String(e)}` }));
		}
		if (seq !== this.seq) return;
		this.clearPreviewComponent();
		const component = this.addChild(new Component());
		this.previewComponent = component;
		this.fixImages(frag, file.path);
		this.previewEl.empty();
		this.previewEl.append(frag);
		if (warnings.length) this.showWarnings(warnings);
		this.includes = expanded.includes;
		this.expanded = expanded.text;
		await renderMermaidBlocks(this.app, this.previewEl, file.path, component, () => seq === this.seq, () => void this.render());
		if (seq !== this.seq) return;
		await this.highlightCode();
		if (seq !== this.seq) return;
		const pending = this.plugin.takePendingAnchor(file.path);
		if (pending) this.scrollToId(pending);
		this.plugin.refreshLinksSoon();
	}

	private clearPreviewComponent(): void {
		if (this.previewComponent) this.removeChild(this.previewComponent);
		this.previewComponent = null;
	}

	private showWarnings(warnings: string[]): void {
		const box = this.previewEl.createEl('details', { cls: 'adoc-warnings' });
		box.createEl('summary', { text: `${warnings.length} AsciiDoc ${warnings.length === 1 ? 'warning' : 'warnings'}` });
		const list = box.createEl('ul');
		for (const w of warnings.slice(0, 50)) list.createEl('li', { text: w });
	}

	/** Relative image paths point to vault files; the app serves them by resource URL. */
	private fixImages(frag: DocumentFragment, path: string): void {
		frag.querySelectorAll('img').forEach((img) => {
			const src = img.getAttribute('src') ?? '';
			if (!src || isUrl(src) || src.startsWith('data:')) return;
			const target = joinPath(dirOf(path), safeDecode(src));
			const file = target ? this.app.vault.getFileByPath(target) : null;
			if (file) img.setAttribute('src', this.app.vault.getResourcePath(file));
			else img.addClass('adoc-missing-image');
		});
	}

	private async highlightCode(): Promise<void> {
		const blocks = this.previewEl.querySelectorAll('pre > code[class*="language-"]');
		if (!blocks.length) return;
		try {
			const prism = (await loadPrism()) as PrismLike;
			blocks.forEach((el) => prism.highlightElement(el));
		} catch {
			// Code stays readable without colors.
		}
	}

	private onPreviewClick(evt: MouseEvent): void {
		const a = evt.target instanceof Element ? evt.target.closest('a') : null;
		if (!a || !this.file) return;
		const t = classifyHref(a.getAttribute('href'), this.file.path);
		evt.preventDefault();
		if (t.kind === 'anchor') this.scrollToId(t.fragment);
		else if (t.kind === 'external') window.open(t.url, '_blank');
		else if (t.kind === 'file') void this.plugin.openPath(t.path, t.fragment, Keymap.isModEvent(evt) !== false);
	}

	/** Shows an anchor: scrolls the preview to it, and in source mode moves the cursor to its line. */
	scrollToId(id: string): void {
		if (this.mode === 'source') {
			const anchor = extractOutline(this.data).anchors.find((a) => a.id === id);
			if (anchor && this.editor) revealLine(this.editor, anchor.line);
			return;
		}
		const el = this.previewEl.querySelector(`[id="${CSS.escape(id)}"]`);
		el?.scrollIntoView({ block: 'start' });
	}

	/** Shows a 0-based source line (null = the section comes from an included file) and the section in the preview. */
	revealSourceLine(line: number | null, id: string | null): void {
		if (this.mode !== 'preview' && this.editor && line !== null) revealLine(this.editor, line);
		if (this.mode !== 'source' && id) this.previewEl.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });
	}
}

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}
