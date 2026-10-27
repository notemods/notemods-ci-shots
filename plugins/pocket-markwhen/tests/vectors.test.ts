import { describe, expect, it } from 'vitest';
import vectors from './vectors/pocket-markwhen.json';
import { timelineCase, markdownList, parseTimeline, previousDay } from '../src/timeline';
import type { TimelineFilter } from '../src/settings';

describe('golden vectors', () => {
	it('has at least 20 acceptance vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		const [source, filter, today] = c.args as [string, Partial<TimelineFilter>, string];
		expect(timelineCase(source, filter, today)).toEqual(c.expected);
	});
	it('subtracts a day across a leap-year boundary', () => expect(previousDay('2028-03-01')).toBe('2028-02-29'));
	it('exports escaped Markdown with date, tags and source path', () => {
		const events = parseTimeline('2026-03-01: <b>A</b> #work', 'trip.mw').events;
		expect(markdownList(events)).toBe('- 2026-03-01: \\<b\\>A\\</b\\> #work (trip.mw)\n');
	});
});
