import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { buildOutline, toMarkdownList } from '../src/outline';
import { collect, MAX_NOTES } from '../src/source';
import { FREE, PRO } from './sample-expect';
import { fakeSource } from './scan';

describe('large embedded outlines', () => {
	it('reports omitted notes at the read limit', async () => {
		const files: Record<string, string> = { 'Root.md': Array.from({ length: MAX_NOTES }, (_, i) => `![[Child ${i}]]`).join('\n') };
		for (let i = 0; i < MAX_NOTES; i++) files[`Child ${i}.md`] = `# Child ${i}`;
		const app = App.createConfigured__({ files });
		const src = await collect(app as never, 'Root.md', 1);
		expect(buildOutline('Root.md', src, FREE).truncated).toBe(true);
	});
	it('does not report truncation for an exact fit with repeated embeds', async () => {
		const files: Record<string, string> = { 'Root.md': Array.from({ length: MAX_NOTES - 1 }, (_, i) => `![[Child ${i}]]`).join('\n') + '\n![[Child 0]]' };
		for (let i = 0; i < MAX_NOTES - 1; i++) files[`Child ${i}.md`] = `# Child ${i}`;
		const app = App.createConfigured__({ files });
		const src = await collect(app as never, 'Root.md', 1);
		expect(buildOutline('Root.md', src, FREE).truncated).toBe(false);
	});
	it('keeps 500 headings and nested Unicode paths', () => {
		const src = fakeSource({ 'Root.md': '![[資料/Chapter]]', '資料/Chapter.md': Array.from({ length: 500 }, (_, i) => `## Heading ${i}`).join('\n') });
		const out = buildOutline('Root.md', src, FREE);
		expect(out.items[0]?.children).toHaveLength(500);
		expect(out.truncated).toBe(false);
	});
	it('writes resolved paths for embeds nested in another folder', () => {
		const src = fakeSource({ 'Root.md': '![[資料/Chapter]]', '資料/Chapter.md': '![[Child#Section]]', '資料/Child.md': '# Section' });
		const out = buildOutline('Root.md', src, PRO);
		const text = toMarkdownList(out, { linkText: p => p.replace(/\.md$/, ''), words: false });
		expect(text).toContain('[[資料/Child#Section]]');
	});
});
