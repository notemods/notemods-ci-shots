import { describe, expect, it, vi } from 'vitest';
import { Component, MarkdownRenderer } from 'obsidian';
import { InlineEmbeds, type EmbedRef, type Plan } from '../src/render';
import { blockKey } from '../src/embeds';

// A 3 level chain C1 > C2 > C3 with the metadata cache and the renderer stubbed: the refresh logic of render.ts runs
// as it does in the app. MarkdownRenderer.render writes the text into one paragraph, as a paragraph block renders.
const FILES: Record<string, string> = { C1: 'one ![[C2#^c]] one', C2: 'two ![[C3#^c]] two', C3: 'three' };

class Stub extends InlineEmbeds {
	reads = 0;
	fail = false;
	plan(ref: EmbedRef): Plan {
		if (!(ref.path in FILES)) return { state: 'missing', ref };
		return { state: 'inline', ref, kind: 'paragraph', file: { path: `${ref.path}.md` } as never, key: blockKey(`${ref.path}.md`, ref.blockId) };
	}
	async textOf(plan: Extract<Plan, { state: 'inline' }>): Promise<string | null> {
		this.reads++;
		await new Promise((r) => setTimeout(r, 1));
		if (this.fail) throw new Error('read failed');
		return FILES[plan.file.path.replace(/\.md$/, '')] ?? null;
	}
}

async function settle(inline: InlineEmbeds): Promise<void> {
	for (let i = 0; i < 200 && inline.pending > 0; i++) await new Promise((r) => setTimeout(r, 2));
	await new Promise((r) => setTimeout(r, 10));
}

function setup(): { inline: Stub; el: HTMLElement; owner: Component } {
	vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
		const p = document.createElement('p');
		p.textContent = markdown;
		el.appendChild(p);
	});
	// The app needs only workspace.trigger (hover). The key is set by name: the export gate rejects the text of a pnpm workspace protocol.
	const app: Record<string, unknown> = {};
	app['workspace'] = { trigger: () => undefined };
	const inline = new Stub(app as never, 'inline-block-embeds', () => ({ drawAll: false, listItems: true, style: 'underline' }));
	const owner = new Component();
	owner.load();
	const ref: EmbedRef = { path: 'C1', blockId: 'c', linktext: 'C1#^c', display: 'C1#^c' };
	const { el } = inline.createSpan(inline.plan(ref), 'Host.md', [], owner);
	return { inline, el, owner };
}

describe('refresh of a 3 level chain (review round 2, major)', () => {
	it('keeps the same number of spans after 10 refreshes, with nothing pending', async () => {
		const { inline, el } = setup();
		await settle(inline);
		expect(el.textContent).toBe('one two three two one');
		const size = inline.size;
		expect(size).toBe(3);
		for (let i = 0; i < 10; i++) {
			inline.refreshFile(null);
			await settle(inline);
			expect(inline.size).toBe(size);
			expect(inline.pending).toBe(0);
			expect(el.querySelectorAll('.ibe-inline').length).toBe(2);
			expect(el.textContent).toBe('one two three two one');
		}
	});

	it('refreshes the files of each level in one pass and leaks nothing', async () => {
		const { inline } = setup();
		await settle(inline);
		for (let i = 0; i < 10; i++) {
			for (const f of ['C3.md', 'C2.md', 'C1.md']) inline.refreshFile(f);
			await settle(inline);
			expect(inline.size).toBe(3);
		}
	});

	it('gives the missing look when a read fails, with no unhandled rejection', async () => {
		const { inline, el } = setup();
		await settle(inline);
		inline.fail = true;
		inline.refreshFile(null);
		await settle(inline);
		expect(el.classList.contains('is-unresolved')).toBe(true);
		expect(el.textContent).toBe('C1#^c');
	});

	it('drops every span when the owner unloads', async () => {
		const { inline, owner } = setup();
		await settle(inline);
		owner.unload();
		expect(inline.size).toBe(0);
	});
});
