// Reading view (rule 15): a Markdown post processor replaces the core embed element of a selected block embed with
// the inline span. The post processor also runs for PDF export, so the export keeps the inline text (criterion 10).
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian';
import { selectEmbeds } from './embeds';
import { INLINE_CLASS, type EmbedRef, type InlineEmbeds } from './render';

const SRC_RE = /^([^#|]*)#\^([A-Za-z0-9-]+)$/;
/** Elements that do not count as text on the line: list bullets, fold arrows, task boxes. */
const SKIP = '.list-bullet, .list-collapse-indicator, .collapse-indicator, input';
const BLOCK_TAGS = new Set(['P', 'LI', 'TD', 'TH', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DD', 'DT', 'SECTION']);

function counts(node: Node): boolean {
	if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').trim() !== '';
	if (!node.instanceOf(HTMLElement)) return false;
	if (node.matches(SKIP)) return false;
	if (node.tagName === 'BR') return false;
	return (node.textContent ?? '').trim() !== '' || node.matches('img, .internal-embed, .math, mjx-container');
}

/** Rule 2 in the DOM: true when the line of the element (between <br> tags in its block) has other content. */
export function lineHasOtherContent(el: HTMLElement): boolean {
	let node: HTMLElement = el;
	for (;;) {
		for (const dir of ['previousSibling', 'nextSibling'] as const) {
			for (let s = node[dir]; s; s = s[dir]) {
				if (s.instanceOf(HTMLElement) && s.tagName === 'BR') break;
				if (counts(s)) return true;
			}
		}
		const parent = node.parentElement;
		if (!parent || BLOCK_TAGS.has(parent.tagName)) return false;
		node = parent;
	}
}

export class ReadingView {
	constructor(private readonly inline: InlineEmbeds) {}

	/** The aliases that the section text gives to each embed source, in order. */
	private aliases(el: HTMLElement, ctx: MarkdownPostProcessorContext): Map<string, Array<string | null>> | null {
		const info = ctx.getSectionInfo(el);
		if (!info) return null;
		const map = new Map<string, Array<string | null>>();
		const lines = info.text.split('\n').slice(info.lineStart, info.lineEnd + 1);
		for (const line of lines) {
			for (const m of selectEmbeds(line)) {
				const list = map.get(m.linktext) ?? [];
				list.push(m.alias);
				map.set(m.linktext, list);
			}
		}
		return map;
	}

	process(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> | void {
		const embeds = Array.from(el.querySelectorAll<HTMLElement>('.internal-embed[src*="#^"]'));
		if (!embeds.length) return;
		const opts = this.inline.options();
		const aliases = this.aliases(el, ctx);
		const seen = new Map<string, number>();
		const waits: Promise<void>[] = [];
		for (const embed of embeds) {
			if (embed.closest(`.${INLINE_CLASS}`)) continue;
			const src = embed.getAttribute('src') ?? '';
			const m = SRC_RE.exec(src);
			if (!m) continue;
			const path = (m[1] ?? '').trim();
			const blockId = m[2] ?? '';
			const linktext = `${path}#^${blockId}`;
			const n = seen.get(linktext) ?? 0;
			seen.set(linktext, n + 1);
			const alias = aliases ? (aliases.get(linktext)?.[n] ?? null) : altAlias(embed, path, blockId);
			if (!opts.drawAll && !lineHasOtherContent(embed)) continue;
			const ref: EmbedRef = { path, blockId, linktext, display: alias ?? linktext };
			const plan = this.inline.plan(ref, ctx.sourcePath);
			if (plan.state === 'native') continue;
			const span = createSpan();
			const child = new MarkdownRenderChild(span);
			ctx.addChild(child);
			const made = this.inline.createSpan(plan, ctx.sourcePath, [], child, span);
			embed.replaceWith(made.el);
			waits.push(made.done);
		}
		if (waits.length) return Promise.all(waits).then(() => undefined);
	}
}

/** The alias from the alt text of the core element, when the section text is not known. */
function altAlias(embed: HTMLElement, path: string, blockId: string): string | null {
	const alt = (embed.getAttribute('alt') ?? '').trim();
	const defaults = new Set(['', `${path}#^${blockId}`, `${path} > ^${blockId}`, `${path} > ${blockId}`, `^${blockId}`]);
	return defaults.has(alt) ? null : alt;
}
