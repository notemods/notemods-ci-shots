import { describe, expect, it } from 'vitest';
import { applyMarks, clearMarks, parseQuestions, type Response } from '../src/quiz';

function answer(text: string, result: Response['result']): Response[] {
	return parseQuestions(text).map((c) => ({ ...c, result }));
}

describe('review fixes', () => {
	it('a mark goes before a block id, so block links keep working', () => {
		const text = 'What is ATP? ^atp\nEnergy carrier';
		expect(applyMarks(text, answer(text, 'correct')).text).toBe('What is ATP?✅ ^atp\nEnergy carrier');
		const marked = 'What is ATP?❌ ^atp\nEnergy carrier';
		expect(parseQuestions(marked)[0]).toMatchObject({ question: 'What is ATP? ^atp', mark: 'wrong' });
		expect(applyMarks(marked, answer(marked, 'correct')).text).toBe('What is ATP?✅ ^atp\nEnergy carrier');
		expect(clearMarks(marked)).toBe('What is ATP? ^atp\nEnergy carrier');
	});
	it('a mark written after a block id moves before it', () => {
		const text = 'What is ATP? ^atp✅\nEnergy carrier';
		expect(parseQuestions(text)[0]).toMatchObject({ question: 'What is ATP? ^atp', mark: 'correct' });
		expect(applyMarks(text, answer(text, 'wrong')).text).toBe('What is ATP?❌ ^atp\nEnergy carrier');
	});
	it('a mark followed by trailing spaces is found and replaced', () => {
		const text = 'A?✅ \na';
		expect(parseQuestions(text)[0]!.mark).toBe('correct');
		expect(applyMarks(text, answer(text, 'wrong')).text).toBe('A?❌\na');
		expect(clearMarks(text)).toBe('A?\na');
	});
	it('an answer edit does not prevent a mark when the question line matches', () => {
		const r = answer('A?\nold answer', 'wrong');
		expect(applyMarks('A?\nnew answer\nmore', r)).toEqual({ text: 'A?❌\nnew answer\nmore', applied: 1, skipped: 0 });
	});
	it('a leading rule without a closing line is not frontmatter', () => {
		expect(parseQuestions('---\n\nA?\na').map((c) => c.question)).toEqual(['A?']);
	});
});
