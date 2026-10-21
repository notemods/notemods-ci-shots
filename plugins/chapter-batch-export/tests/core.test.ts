import { describe, expect, it } from 'vitest';
import { buildPlan, chapterSources, DEFAULT_OPTIONS, stripInitialFrontmatter } from '../src/core';
describe('source preservation and input limits', () => {
	it('keeps trailing spaces, blank lines and body frontmatter', () => {
		const text = 'Body with a hard break  \n\n---\nbody: text\n---\n';
		expect(stripInitialFrontmatter('---\ntype: scene\n---\n' + text)).toBe(text);
		const plan = buildPlan({ longform: { format: 'scenes', sceneFolder: '/', scenes: ['A'] } }, 'Index.md', { 'A.md': text }, DEFAULT_OPTIONS);
		expect(plan.chapters[0]!.content).toBe('# A\n\n' + text + '\n');
	});
	it('keeps body text when a dot line follows an initial divider', () => {
		// Obsidian closes frontmatter only with a dash line, so it shows this text as the body.
		const text = '---\nThe storm broke.\n...\nShe waited.\n';
		expect(stripInitialFrontmatter(text)).toBe(text);
	});
	it('keeps a BOM when there is no initial frontmatter', () => { expect(stripInitialFrontmatter('\uFEFFBody')).toBe('\uFEFFBody'); });
	it('refuses a YAML cycle', () => {
		const scenes: unknown[] = ['A']; scenes.push(scenes);
		expect(() => chapterSources({ longform: { format: 'scenes', sceneFolder: '/', scenes } }, 'Index.md')).toThrow('YAML cycle');
	});
	it('refuses a tree above 64 levels', () => {
		let scenes: unknown[] = ['Leaf']; for (let n = 0; n < 66; n++) scenes = ['A', scenes];
		expect(() => chapterSources({ longform: { format: 'scenes', sceneFolder: '/', scenes } }, 'Index.md')).toThrow('too deep');
	});
	it('refuses more than 10000 entries', () => {
		expect(() => chapterSources({ longform: { format: 'scenes', sceneFolder: '/', scenes: Array.from({ length: 10001 }, () => 'A') } }, 'Index.md')).toThrow('10000 entries');
	});
});
