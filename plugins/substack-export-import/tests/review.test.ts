import { describe, expect, it } from 'vitest';
import { convertBody } from '../src/convert';

describe('review regressions', () => {
	it('keeps each image URL in a body with more than ten images', () => {
		const urls = Array.from({ length: 12 }, (_, i) => `https://images.example.test/${i}.jpg`);
		const html = urls.map((u) => `<img src="${u}">`).join('');
		const body = convertBody(html, (fragment) => Array.from(fragment.querySelectorAll('img')).map((img) => `![](${img.getAttribute('src') ?? ''})`).join('\n'));
		expect(body.split('\n')).toEqual(urls.map((u) => `![](${u})`));
	});
	it('keeps each image URL with the default converter', () => {
		const urls = Array.from({ length: 12 }, (_, i) => `https://images.example.test/${i}.jpg`);
		const body = convertBody(urls.map((u) => `<p><img src="${u}"></p>`).join(''));
		for (const u of urls) expect(body).toContain(`(${u})`);
		expect(body).not.toMatch(/\.jpg\d/);
	});
});
