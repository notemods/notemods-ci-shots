import { htmlToMarkdown } from 'obsidian';

/** Parse in an inert document. Do not insert source HTML into the app. */
export function convertBody(html: string, converter: (fragment: DocumentFragment) => string = htmlToMarkdown): string {
	// Keep source nodes inside template content, which has no browsing context.
	// Escape template end tags so source text cannot close the outer template.
	const parsed = new DOMParser().parseFromString(`<template>${html.replace(/<\/template/gi, '&lt;/template')}</template>`, 'text/html');
	const template = parsed.querySelector('template');
	if (!template) throw new Error('The HTML template could not be parsed.');
	const doc = template.content;
	for (const el of Array.from(doc.querySelectorAll('script, style, iframe, object, embed, link, meta, base, audio, video, source, form, input, svg, math'))) el.remove();
	let prefix = 'substack-import-image-';
	while (html.includes(prefix)) prefix += 'x';
	const imageUrls = new Map<string, string>();
	for (const el of Array.from(doc.querySelectorAll('*'))) {
		for (const attr of Array.from(el.attributes)) {
			if (attr.name.startsWith('on') || attr.name === 'style' || attr.name === 'srcset') el.removeAttribute(attr.name);
		}
		for (const key of ['href', 'src']) {
			const value = el.getAttribute(key)?.trim() ?? '';
			if (value && /^(?:javascript|vbscript|data):/i.test(Array.from(value).filter((c) => c.charCodeAt(0) > 32).join(''))) el.removeAttribute(key);
		}
		if (el.tagName.toLowerCase() === 'img') {
			const src = el.getAttribute('src');
			if (src) {
				// The end marker stops placeholder 1 from matching inside placeholder 10.
				const placeholder = `data:,${prefix}${imageUrls.size}-end`;
				imageUrls.set(placeholder, src.replace(/\s/g, '%20').replace(/[()]/g, '\\$&'));
				el.setAttribute('src', placeholder);
			}
		}
	}
	// A converter can adopt fragment nodes into its document. Keep remote image
	// addresses out of that step, then restore them in the Markdown text.
	let markdown = converter(doc);
	for (const [placeholder, url] of imageUrls) markdown = markdown.split(placeholder).join(url);
	return markdown;
}
