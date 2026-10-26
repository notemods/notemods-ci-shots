// Pro side panel: outline, includes, outgoing xrefs and incoming links of the AsciiDoc file in the active tab.
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { findBacklinks, resolveXrefs } from './adoc/links';
import { extractOutline } from './adoc/outline';
import { isPro } from './pro';
import type { AsciidocView } from './view';
import type AsciidocFilesPlugin from './main';

export const LINKS_VIEW_TYPE = 'asciidoc-files-links';

export class LinksView extends ItemView {
	plugin: AsciidocFilesPlugin;
	private seq = 0;

	constructor(leaf: WorkspaceLeaf, plugin: AsciidocFilesPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.contentEl.addClass('adoc-links');
	}

	getViewType(): string {
		return LINKS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Outline and links';
	}

	getIcon(): string {
		return 'list-tree';
	}

	async onOpen(): Promise<void> {
		await this.refresh();
	}

	/** Draws the panel for the AsciiDoc tab the plugin last saw active. */
	async refresh(): Promise<void> {
		const seq = ++this.seq;
		const view = this.plugin.lastAdocView();
		const el = createDiv();
		if (!isPro()) this.drawLocked(el);
		else if (!view?.file) el.createEl('p', { cls: 'adoc-links-empty', text: 'Open an .adoc file to see its outline and links.' });
		else await this.draw(el, view);
		if (seq !== this.seq) return;
		this.contentEl.empty();
		this.contentEl.append(el);
	}

	private drawLocked(el: HTMLElement): void {
		el.createEl('p', { cls: 'adoc-links-locked', text: 'The outline and links panel is part of pro. Sponsor on GitHub, then sign in under the plugin settings.' });
	}

	private section(el: HTMLElement, title: string, count: number): HTMLElement {
		el.createEl('h4', { cls: 'adoc-links-heading', text: `${title} (${count})` });
		return el.createEl('ul', { cls: 'adoc-links-list' });
	}

	private item(list: HTMLElement, text: string, sub: string, onClick: () => void, cls = ''): void {
		const li = list.createEl('li', { cls: `adoc-links-item ${cls}`.trim() });
		const link = li.createEl('a', { text, href: '#' });
		if (sub) li.createSpan({ cls: 'adoc-links-sub', text: sub });
		link.addEventListener('click', (evt) => {
			evt.preventDefault();
			onClick();
		});
	}

	private async draw(el: HTMLElement, view: AsciidocView): Promise<void> {
		const file = view.file;
		if (!file) return;
		const path = file.path;
		el.createDiv({ cls: 'adoc-links-file', text: path });
		// Sections from the expanded text (with the included chapters); source lines only for the file's own sections.
		const own = new Map(extractOutline(view.data).sections.map((s) => [s.id, s.line]));
		const outline = extractOutline(view.expanded || view.data);
		const toc = this.section(el, 'Outline', outline.sections.length);
		for (const s of outline.sections) {
			const line = own.get(s.id) ?? null;
			this.item(toc, s.title || '(untitled)', line === null ? 'included' : '', () => view.revealSourceLine(line, s.id), `adoc-level-${s.level}`);
		}
		const includes = view.includes;
		const inc = this.section(el, 'Includes', includes.length);
		for (const r of includes) {
			const sub = r.status === 'ok' ? `line ${r.line}` : `${r.status}, line ${r.line}`;
			this.item(inc, r.path ?? r.target, sub, () => void this.plugin.openPath(r.path ?? r.target, null, false), r.status === 'ok' ? '' : 'is-broken');
		}
		const exists = (p: string): boolean => this.app.vault.getFileByPath(p) !== null;
		const xrefs = resolveXrefs(path, view.data, exists);
		const out = this.section(el, 'Cross references', xrefs.length);
		for (const x of xrefs) {
			const label = x.file ? `${x.path ?? x.file}${x.fragment ? `#${x.fragment}` : ''}` : `#${x.fragment ?? ''}`;
			const go = (): void => (x.file ? void this.plugin.openPath(x.path ?? x.file, x.fragment, false) : view.scrollToId(x.fragment ?? ''));
			this.item(out, label, `${x.ok ? '' : 'missing, '}line ${x.line + 1}`, go, x.ok ? '' : 'is-broken');
		}
		await this.drawIncoming(el, path);
	}

	private async drawIncoming(el: HTMLElement, path: string): Promise<void> {
		const docs = await this.plugin.adocDocs();
		const back = findBacklinks(path, docs);
		const notes = this.plugin.markdownLinksTo(path);
		const list = this.section(el, 'Linked from', back.length + notes.length);
		for (const b of back) this.item(list, b.from, `${b.kind}, line ${b.line + 1}`, () => void this.plugin.openPath(b.from, null, false));
		for (const n of notes) this.item(list, n, 'note link', () => void this.plugin.openPath(n, null, false));
	}
}
