import { describe, expect, it } from 'vitest';
import { MARK, clearAll, sizeAll, sizeImage, type PassContext } from '../src/dom';
import { defaultSize } from '../src/size';

const FREE: PassContext = { opts: { pandoc: false, fallback: null }, property: undefined };
const PANDOC: PassContext = { opts: { pandoc: true, fallback: null }, property: undefined };
const PRO: PassContext = { opts: { pandoc: false, fallback: (p) => defaultSize('100%', p) }, property: undefined };

/** The DOM that Obsidian 1.13.4 and 1.14.5 make for an image embed (CI spike, lanes/B7/spike.json). */
function embed(alt: string | null, width?: string): { root: HTMLElement; img: HTMLImageElement } {
	const root = document.createElement('p');
	const wrap = document.createElement('span');
	wrap.className = 'internal-embed media-embed image-embed is-loaded';
	wrap.setAttribute('src', 'wide.png');
	const img = document.createElement('img');
	if (alt !== null) {
		wrap.setAttribute('alt', alt);
		img.setAttribute('alt', alt);
	}
	if (width) {
		wrap.setAttribute('width', width);
		img.setAttribute('width', width);
	}
	wrap.appendChild(img);
	root.appendChild(wrap);
	return { root, img };
}

describe('sizeImage', () => {
	it('sizes a percent token and keeps the caption as alt', () => {
		const { img } = embed('cap|50%');
		expect(sizeImage(img, FREE)).toBe(true);
		expect(img.style.width).toBe('50%');
		expect(img.getAttribute('alt')).toBe('cap');
	});

	it('uses the file name as alt when there is no caption', () => {
		const { img } = embed('20rem');
		sizeImage(img, FREE);
		expect(img.style.width).toBe('20rem');
		expect(img.getAttribute('alt')).toBe('wide.png');
	});

	it('maps a percent height to vh and keeps the aspect ratio', () => {
		const { img } = embed('50%x30%');
		sizeImage(img, FREE);
		expect([img.style.width, img.style.height, img.style.getPropertyValue('object-fit')]).toEqual(['50%', '30vh', 'contain']);
	});

	it('does not touch a pixel size (core behavior)', () => {
		const { img } = embed(null, '200');
		const before = img.outerHTML;
		expect(sizeImage(img, FREE)).toBe(false);
		expect(sizeImage(img, PRO)).toBe(false);
		expect(img.outerHTML).toBe(before);
	});

	it('does not touch a pixel size with a caption', () => {
		const { img } = embed('cap|200');
		const before = img.outerHTML;
		expect(sizeImage(img, PRO)).toBe(false);
		expect(img.outerHTML).toBe(before);
	});

	it('leaves a core pixel size to core when the caption is a size (![[a.png|50%|200]])', () => {
		const { img } = embed('50%', '200');
		const before = img.outerHTML;
		expect(sizeImage(img, FREE)).toBe(false);
		expect(img.outerHTML).toBe(before);
	});

	it('does not read a bare size alt of an image that is not an embed', () => {
		const root = document.createElement('p');
		const img = document.createElement('img');
		img.setAttribute('alt', '50%');
		root.appendChild(img);
		expect(sizeAll(root, FREE)).toBe(0);
		expect(img.getAttribute('style')).toBeNull();
		img.setAttribute('alt', 'cap|50%');
		expect(sizeAll(root, FREE)).toBe(1);
		expect(img.style.width).toBe('50%');
	});

	it('follows a size that core changes in place (same img, new wrapper alt)', () => {
		const { root, img } = embed('50%');
		const wrap = root.firstElementChild!;
		sizeAll(root, FREE);
		expect(img.style.width).toBe('50%');
		wrap.setAttribute('alt', '25%');
		img.setAttribute('alt', '25%');
		sizeAll(root, FREE);
		expect([img.style.width, img.getAttribute('alt')]).toEqual(['25%', 'wide.png']);
		wrap.removeAttribute('alt');
		wrap.setAttribute('width', '200');
		img.setAttribute('width', '200');
		img.removeAttribute('alt');
		sizeAll(root, FREE);
		expect([img.getAttribute('style') ?? '', img.hasAttribute(MARK), img.getAttribute('alt')]).toEqual(['', false, null]);
		wrap.removeAttribute('width');
		img.removeAttribute('width');
		wrap.setAttribute('alt', '30em');
		img.setAttribute('alt', '30em');
		sizeAll(root, FREE);
		expect(img.style.width).toBe('30em');
	});

	it('is a no-op on the second pass (no layout loop)', () => {
		const { root } = embed('40vw');
		expect(sizeAll(root, FREE)).toBe(1);
		expect(sizeAll(root, FREE)).toBe(0);
	});

	it('does not size a note embed', () => {
		const { root, img } = embed('50%');
		root.firstElementChild!.className = 'internal-embed markdown-embed';
		expect(sizeImage(img, FREE)).toBe(false);
	});

	it('Pro default size applies only to an image with no size', () => {
		const a = embed('wide.png');
		expect(sizeImage(a.img, FREE)).toBe(false);
		expect(sizeImage(a.img, PRO)).toBe(true);
		expect(a.img.style.width).toBe('100%');
		expect(sizeImage(a.img, { ...PRO, property: '30rem' })).toBe(true);
		expect(a.img.style.width).toBe('30rem');
	});

	it('removes a default size when Pro turns off', () => {
		const a = embed('wide.png');
		sizeImage(a.img, PRO);
		expect(sizeImage(a.img, FREE)).toBe(true);
		expect(a.img.hasAttribute(MARK)).toBe(false);
		expect(a.img.style.width).toBe('');
	});
});

describe('Live Preview image wrapper', () => {
	it('moves a percent width to div.image-wrapper and clears it again', () => {
		const root = document.createElement('div');
		const embed = document.createElement('div');
		embed.className = 'internal-embed media-embed image-embed is-loaded';
		embed.setAttribute('alt', '50%x30%');
		const wrap = document.createElement('div');
		wrap.className = 'image-wrapper';
		const img = document.createElement('img');
		img.setAttribute('alt', '50%x30%');
		wrap.appendChild(img);
		embed.appendChild(wrap);
		root.appendChild(embed);
		sizeAll(root, FREE);
		expect([img.style.width, img.style.height, embed.style.getPropertyValue('--riw-width'), embed.classList.contains('riw-pct')]).toEqual(['100%', '30vh', '50%', true]);
		clearAll(root);
		expect([img.style.width, embed.style.getPropertyValue('--riw-width'), embed.classList.contains('riw-pct')]).toEqual(['', '', false]);
	});

	it('keeps a rem width on the image', () => {
		const { root, img } = embed('20rem');
		const wrap = document.createElement('div');
		wrap.className = 'image-wrapper';
		img.replaceWith(wrap);
		wrap.appendChild(img);
		sizeAll(root, FREE);
		expect(img.style.width).toBe('20rem');
		expect(root.querySelector('.riw-pct')).toBeNull();
	});
});

describe('Pandoc block in Reading view', () => {
	function pandoc(text: string): { root: HTMLElement; img: HTMLImageElement } {
		const root = document.createElement('p');
		const img = document.createElement('img');
		img.setAttribute('alt', 'Image');
		root.append(img, document.createTextNode(text));
		return { root, img };
	}

	it('sizes the image, sets id and class, and hides the block', () => {
		const { root, img } = pandoc('{#fig1 .wide width=50% height=50%} after');
		sizeAll(root, PANDOC);
		expect([img.style.width, img.style.height, img.id, img.className]).toEqual(['50%', '50vh', 'fig1', 'wide']);
		expect(root.querySelector('.riw-hidden')).not.toBeNull();
		expect(root.lastChild?.textContent).toBe(' after');
	});

	it('keeps the size on a second pass after the block is hidden', () => {
		const { root, img } = pandoc('{width=40%}');
		sizeAll(root, PANDOC);
		expect(sizeAll(root, PANDOC)).toBe(0);
		expect(img.style.width).toBe('40%');
		expect(root.querySelectorAll('.riw-hidden').length).toBe(1);
	});

	it('leaves the block as text when the setting is off', () => {
		const { root, img } = pandoc('{width=50%}');
		sizeAll(root, FREE);
		expect(img.style.width).toBe('');
		expect(root.textContent).toBe('{width=50%}');
	});

	it('clearAll puts everything back', () => {
		const { root, img } = pandoc('{#fig1 .wide width=50%} after');
		sizeAll(root, PANDOC);
		clearAll(root);
		expect([img.style.width, img.id, img.className, img.getAttribute('alt')]).toEqual(['', '', '', 'Image']);
		expect(root.textContent).toBe('{#fig1 .wide width=50%} after');
	});

	it('clearAll restores the alt text with the size token', () => {
		const { root, img } = embed('cap|50%');
		sizeAll(root, FREE);
		clearAll(root);
		expect(img.getAttribute('alt')).toBe('cap|50%');
		expect(img.style.width).toBe('');
	});
});
