/**
 * The text of rendered math. MathJax 4 (Obsidian 1.14) puts each glyph in the text of an mjx-c element.
 * MathJax 3 (Obsidian 1.13) leaves mjx-c empty and gives the code point in its class, for example mjx-c32 for "2".
 */
export function mathText(el: Element): string {
	const glyphs = Array.from(el.querySelectorAll('mjx-c'));
	if (glyphs.length === 0) return el.textContent ?? '';
	return glyphs
		.map((c) => {
			if (c.textContent) return c.textContent;
			const m = /(?:^|\s)mjx-c([0-9A-F]+)(?:\s|$)/.exec(c.getAttribute('class') ?? '');
			return m ? String.fromCodePoint(parseInt(m[1]!, 16)) : '';
		})
		.join('');
}

/**
 * The message of a math error in an element from renderMath, or null when there is no error.
 * The engine marks a parse error with data-mjx-error. It shows an undefined command as red text, not as an error.
 */
export function mathError(el: HTMLElement): string | null {
	const err = el.querySelector('[data-mjx-error]');
	if (err) return err.getAttribute('data-mjx-error') || 'Math error';
	const merror = el.querySelector('mjx-merror, merror');
	if (merror) return mathText(merror).trim() || 'Math error';
	for (const t of Array.from(el.querySelectorAll('mjx-mtext, mtext'))) {
		const text = mathText(t).trim();
		const style = (t.getAttribute('style') ?? '') + (t.getAttribute('mathcolor') ?? '');
		if (/^\\[A-Za-z]+$/.test(text) && style.includes('red')) return `Undefined control sequence ${text}`;
	}
	return null;
}
