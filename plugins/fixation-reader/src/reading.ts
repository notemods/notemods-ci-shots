import { wordStarts } from './words';
import type { FixationReaderSettings } from './settings';

const SKIP = '.markdown-source-view, pre, code, strong, b, .math, .MathJax, mjx-container, svg, script, style, textarea, button, .frontmatter, .metadata-container, .internal-embed';

/** Remove only the marks that this plugin made. Keep their text and child nodes. */
export function clearSection(el: HTMLElement): void {
	const parents = new Set<Node>();
	for (const mark of Array.from(el.querySelectorAll('[data-fixation-reader]'))) {
		const parent = mark.parentNode;
		mark.replaceWith(...Array.from(mark.childNodes));
		if (parent) parents.add(parent);
	}
	for (const parent of parents) parent.normalize();
}

export function markStyle(s: FixationReaderSettings, pro: boolean, ending = false): string {
	if (!pro) return '';
	return ending ? `--fx-ending-opacity:${s.endingOpacity}` : `--fx-weight:${s.weight};--fx-color:${s.color || 'inherit'}`;
}

/** Walk this rendered section once. Do not read or write the Markdown file. */
export function processSection(el: HTMLElement, s: FixationReaderSettings, active: boolean, pro: boolean): void {
	clearSection(el);
	if (!active || el.closest('.markdown-source-view') || el.closest(SKIP)) return;
	const doc = el.ownerDocument;
	const win = doc.win as typeof window;
	const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	});
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	for (const node of nodes) {
		const text = node.data;
		const words = wordStarts(text, s.strength, s.minimum);
		if (words.length === 0) continue;
		const frag = win.createFragment();
		let cursor = 0;
		for (const word of words) {
			frag.appendText(text.slice(cursor, word.from));
			const bold = win.createEl('b');
			bold.className = 'fx';
			bold.dataset.fixationReader = '';
			bold.textContent = text.slice(word.from, word.split);
			if (pro) bold.setAttribute('style', markStyle(s, pro));
			frag.appendChild(bold);
			if (pro && s.endingOpacity < 1 && word.split < word.to) {
				const end = win.createSpan();
				end.className = 'fx-end';
				end.dataset.fixationReader = '';
				end.setAttribute('style', markStyle(s, pro, true));
				end.textContent = text.slice(word.split, word.to);
				frag.appendChild(end);
			} else frag.appendText(text.slice(word.split, word.to));
			cursor = word.to;
		}
		frag.appendText(text.slice(cursor));
		node.replaceWith(frag);
	}
}
