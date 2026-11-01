// Reading view (rules 4, 5 and 10): a Markdown post processor puts the markup of an alias inside the core link
// element. The link element keeps its classes and data-href, so core still opens it on click and shows the hover
// preview. The same post processor runs for callouts, table cells, embeds, hover previews and PDF export.
import { finishRenderMath, loadMathJax, renderMath, type MarkdownPostProcessorContext } from 'obsidian';
import { findAliasLinks, hasMarkup, isDefaultText, parseAlias, type Inline } from './markup';
import type { Options } from './settings';

/** Class on a core link element that this plugin changed. */
export const DONE_CLASS = 'wam-alias';

const TAGS: Record<string, keyof HTMLElementTagNameMap> = { strong: 'strong', em: 'em', del: 'del', mark: 'mark', code: 'code' };

export interface MathApi {
	load(): Promise<void>;
	render(source: string): HTMLElement;
	finish(): Promise<void> | void;
}

export const OBSIDIAN_MATH: MathApi = {
	load: () => loadMathJax(),
	render: (source) => renderMath(source, false),
	finish: () => finishRenderMath(),
};

/** Appends the DOM of the parsed alias to parent. Math uses the math API; without it, math shows its source. */
export function appendNodes(parent: HTMLElement, nodes: Inline[], math: MathApi | null): void {
	const doc = parent.ownerDocument;
	for (const n of nodes) {
		if (n.type === 'text' || n.type === 'escape') {
			parent.appendChild(doc.createTextNode(n.text));
		} else if (n.type === 'code') {
			parent.createEl('code', { text: n.text });
		} else if (n.type === 'math') {
			parent.appendChild(math ? math.render(n.text) : doc.createTextNode(`$${n.text}$`));
		} else {
			appendNodes(parent.createEl(TAGS[n.type] ?? 'span'), n.children, math);
		}
	}
}

function hasMath(nodes: Inline[]): boolean {
	return nodes.some((n) => n.type === 'math' || ((n.type === 'strong' || n.type === 'em' || n.type === 'del' || n.type === 'mark') && hasMath(n.children)));
}

/** The aliases of each link target in the section source, in text order. Null when core gives no section. */
export function sectionAliases(el: HTMLElement, ctx: MarkdownPostProcessorContext): Map<string, string[]> | null {
	const info = ctx.getSectionInfo(el);
	if (!info) return null;
	const map = new Map<string, string[]>();
	const lines = info.text.split('\n').slice(info.lineStart, info.lineEnd + 1);
	for (const line of lines) {
		for (const link of findAliasLinks(line)) {
			const list = map.get(link.target) ?? [];
			list.push(link.alias);
			map.set(link.target, list);
		}
	}
	return map;
}

/** True when the element holds only text, so the plugin can replace its content without loss. */
function textOnly(el: HTMLElement): boolean {
	for (const node of Array.from(el.childNodes)) if (node.nodeType !== Node.TEXT_NODE) return false;
	return true;
}

export class ReadingView {
	private unloaded = false;

	constructor(
		private readonly options: () => Options,
		private readonly math: MathApi = OBSIDIAN_MATH,
	) {}

	/** Work in flight (a MathJax load) does nothing after this call. */
	unload(): void {
		this.unloaded = true;
	}

	process(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> | void {
		if (this.unloaded) return;
		const anchors = Array.from(el.querySelectorAll<HTMLElement>('a.internal-link')).filter((a) => !a.hasClass(DONE_CLASS) && !a.closest('code, pre') && textOnly(a));
		if (!anchors.length) return;
		const opts = this.options();
		const aliases = sectionAliases(el, ctx);
		const jobs: Array<{ anchor: HTMLElement; text: string; nodes: Inline[] }> = [];
		for (const anchor of anchors) {
			const text = anchor.textContent ?? '';
			const href = anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
			let source: string | null;
			if (aliases) {
				// The source of the section is known: use the next alias of this target. Core shows the alias text as
				// it is written, so a link whose text differs from the alias has no alias (or another plugin changed it).
				const list = aliases.get(href.trim());
				const next = list?.[0];
				if (next === undefined || next !== text) continue;
				list!.shift();
				source = next;
			} else {
				source = isDefaultText(text, href) ? null : text;
			}
			if (source === null) continue;
			const nodes = parseAlias(source, opts);
			if (!hasMarkup(nodes)) continue;
			jobs.push({ anchor, text, nodes });
		}
		if (!jobs.length) return;
		const needMath = jobs.some((j) => hasMath(j.nodes));
		const apply = (): void => {
			if (this.unloaded) return;
			for (const { anchor, text, nodes } of jobs) {
				// Another post processor or a rerender can change the link while MathJax loads.
				if (anchor.textContent !== text || !textOnly(anchor)) continue;
				anchor.empty();
				appendNodes(anchor, nodes, needMath ? this.math : null);
				anchor.addClass(DONE_CLASS);
				anchor.setAttribute('data-wam-source', text);
			}
		};
		if (!needMath) {
			apply();
			return;
		}
		return this.math
			.load()
			.then(() => {
				apply();
				if (!this.unloaded) return this.math.finish();
			})
			.catch((e: unknown) => {
				console.warn('Wikilink Alias Markup: math did not load', e);
			});
	}
}
