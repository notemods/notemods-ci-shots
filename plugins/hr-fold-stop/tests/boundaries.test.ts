// Unit tests for the pure boundary logic. The acceptance cases from the spec become golden vectors
// in packages/spec/vectors/hr-fold-stop.json, and this suite mirrors them.
import { describe, expect, it } from 'vitest';
import { foldStopLine, scanTopLevel } from '../src/boundaries';

function stopFor(doc: string, headingLineNumber: number): number | null {
	const lines = scanTopLevel(doc);
	const index = lines.findIndex((l) => l.i === headingLineNumber - 1);
	if (index < 0) return null;
	const stop = foldStopLine(lines, index, lines[index]!.level);
	return stop === null ? null : stop + 1; // 1-based line number, like lineOf
}

function lineOf(doc: string, needle: string): number {
	const i = doc.split('\n').findIndex((l) => l.includes(needle));
	if (i < 0) throw new Error(`not found: ${needle}`);
	return i + 1;
}

describe('scanTopLevel', () => {
	it('finds the first top-level rule before the next heading', () => {
		const doc = '# A\nBody\n\n---\nTail.';
		const lines = scanTopLevel(doc);
		expect(lines.map((l) => l.kind)).toEqual(['heading', 'text', 'blank', 'rule', 'text']);
	});

	it('ignores rule-like text in YAML frontmatter', () => {
		const doc = '---\ntags: [test]\n---\n# A\nBody';
		const kinds = scanTopLevel(doc).map((l) => l.kind);
		expect(kinds).toEqual(['frontmatter', 'frontmatter', 'frontmatter', 'heading', 'text']);
	});

	it('ignores rules in fenced code', () => {
		const doc = '# A\n```text\n---\n```\nBody';
		const kinds = scanTopLevel(doc).map((l) => l.kind);
		expect(kinds).toEqual(['heading', 'fence', 'fence', 'fence', 'text']);
	});

	it('ignores rules in indented code', () => {
		const doc = '# A\n\n    ---\n\nBody';
		const kinds = scanTopLevel(doc).map((l) => l.kind);
		// The blank line inside the indented code block stays part of the block.
		expect(kinds).toEqual(['heading', 'blank', 'fence', 'blank', 'text']);
	});

	it('marks Setext underlines as text, so they do not end a fold', () => {
		const doc = '# A\nSetext child\n------------\nBody\n\n---\nTail.';
		const kinds = scanTopLevel(doc).map((l) => l.kind);
		expect(kinds).toEqual(['heading', 'heading', 'text', 'text', 'blank', 'rule', 'text']);
	});
});

describe('foldStopLine', () => {
	it('case 1: stops before the first top-level rule', () => {
		const doc = '# A\nBody\n\n---\nTail. Fold A.';
		expect(stopFor(doc, 1)).toBe(lineOf(doc, '---'));
	});

	it('case 2: child headings fold with the parent until the rule', () => {
		const doc = '# A\nBody\n## Child\nChild body\n\n***\nTail. Fold A.';
		expect(stopFor(doc, 1)).toBe(lineOf(doc, '***'));
	});

	it('case 3: an equal-level heading ends the fold before a later rule', () => {
		const doc = '# A\nBody\n# B\nOther\n\n---\nTail. Fold A.';
		expect(stopFor(doc, 1)).toBe(lineOf(doc, '# B'));
	});

	it('case 4: the rule inside the fence does not end the fold, the later ___ rule does', () => {
		const doc = '# A\n```text\n---\n```\nBody\n\n___\nTail. Fold A.';
		expect(stopFor(doc, 1)).toBe(lineOf(doc, '___'));
	});

	it('case 5: YAML delimiters are not boundaries, so A folds to B', () => {
		const doc = '---\ntags: [test]\n---\n# A\nBody\n# B\nTail. Fold A.';
		expect(stopFor(doc, 4)).toBe(lineOf(doc, '# B'));
	});

	it('case 6: the Setext underline stays inside A, the later rule ends the fold', () => {
		const doc = '# A\nSetext child\n------------\nBody\n\n---\nTail. Fold A.';
		expect(stopFor(doc, 1)).toBe(6); // the thematic rule on line 6, not the Setext underline
	});

	it('case 7: the indented rule does not end the fold, the unindented rule does', () => {
		const doc = '# A\n\n    ---\n\nBody\n\n---\nTail. Fold A.';
		expect(stopFor(doc, 1)).toBe(lineOf(doc, 'Tail. Fold A.') - 1);
	});

	it('case 8: no rule and no next heading means no custom fold', () => {
		const doc = '# A\nBody';
		expect(stopFor(doc, 1)).toBeNull();
	});
});
