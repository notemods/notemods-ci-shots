import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { insertRewriteExtension, stats } from '../src/editor';
import type { HeadingLookup } from '../src/slug';

const HEADINGS: Record<string, string[]> = {
	'': ['Doc', 'This is an Internal Heading', 'Setup Steps', 'Setup Steps'],
	'Other note.md': ['Install Guide'],
};

function setup(doc: string, rewrite = true): { state: EditorState; calls: { n: number } } {
	const calls = { n: 0 };
	const index = {
		lookup: (): HeadingLookup => (path) => {
			calls.n++;
			return HEADINGS[path] ?? null;
		},
	};
	const ext = insertRewriteExtension(index, { useSlugs: () => true, rewriteInserted: () => rewrite }, () => 'Doc.md');
	return { state: EditorState.create({ doc, extensions: [ext] }), calls };
}

describe('insert rewrite (rule 9)', () => {
	it('5 writes the slug in a link that one change inserts, in the same transaction', () => {
		const { state } = setup('# Doc\n\nSee ');
		const link = '[This is an Internal Heading](#This%20is%20an%20Internal%20Heading)';
		const tr = state.update({ changes: { from: state.doc.length, insert: link } });
		expect(tr.newDoc.toString()).toBe('# Doc\n\nSee [This is an Internal Heading](#this-is-an-internal-heading)');
		// One transaction holds the insert and the rewrite, so one undo removes both.
		expect(tr.startState.doc.toString()).toBe('# Doc\n\nSee ');
	});

	it('5 writes the slug of a later duplicate and of another note', () => {
		const { state } = setup('x');
		const tr = state.update({ changes: { from: 1, insert: ' [a](Other%20note.md#Install%20Guide) [b](#Setup%20Steps)' } });
		expect(tr.newDoc.toString()).toBe('x [a](Other%20note.md#install-guide) [b](#setup-steps)');
	});

	it('5 one typed character does not read the headings', () => {
		const { state, calls } = setup('[a](#Setup%20Steps) and ');
		const before = stats.filterScans;
		const tr = state.update({ changes: { from: state.doc.length, insert: '#' } });
		expect(tr.newDoc.toString()).toBe('[a](#Setup%20Steps) and #');
		expect(calls.n).toBe(0);
		expect(stats.filterScans).toBe(before);
	});

	it('5 an old link on the line stays when a new one is inserted', () => {
		const { state } = setup('[old](#Setup%20Steps) ');
		const tr = state.update({ changes: { from: state.doc.length, insert: '[new](#Doc)' } });
		expect(tr.newDoc.toString()).toBe('[old](#Setup%20Steps) [new](#doc)');
	});

	it('5 the setting off leaves the link', () => {
		const { state } = setup('', false);
		const tr = state.update({ changes: { from: 0, insert: '[a](#Setup%20Steps)' } });
		expect(tr.newDoc.toString()).toBe('[a](#Setup%20Steps)');
	});

	it('5 a missing heading and a link in a code span stay', () => {
		const { state } = setup('');
		const tr = state.update({ changes: { from: 0, insert: '[a](#Nope) `[b](#Setup%20Steps)`' } });
		expect(tr.newDoc.toString()).toBe('[a](#Nope) `[b](#Setup%20Steps)`');
	});

	it('9 typing 500 characters in a 5,000-line note does no heading lookup', () => {
		const lines: string[] = [];
		for (let i = 0; i < 5000; i++) lines.push(i % 50 === 0 ? `## Heading ${i}` : `Line ${i} with a [link](#Heading%20${i - (i % 50)}) in it.`);
		const made = setup(lines.join('\n'));
		let state = made.state;
		const calls = made.calls;
		const t0 = performance.now();
		for (let i = 0; i < 500; i++) state = state.update({ changes: { from: 2500 * 30, insert: 'a' } }).state;
		const ms = performance.now() - t0;
		expect(calls.n).toBe(0);
		expect(ms).toBeLessThan(2000);
	});
});
