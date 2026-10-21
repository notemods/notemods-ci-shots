import { parse, isEvent, type Eventy } from '@markwhen/parser';
import type { TimelineFilter } from './settings';

export interface TimelineEvent {
	text: string; from: string; to: string; date: string; tags: string[]; groups: string[]; path: string;
}
export interface TimelineDocument { title: string; events: TimelineEvent[]; error: string }
export interface TimelineSource { source: string; path: string }
export function previousDay(day: string): string {
	const d = new Date(`${day}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}
export function parseTimeline(source: string, path = ''): TimelineDocument {
	try {
		const parsed = parse(source);
		const events: TimelineEvent[] = [];
		const visit = (node: Eventy, groups: string[], inheritedTags: string[]): void => {
			const tags = [...new Set([...inheritedTags, ...node.tags])];
			if (!isEvent(node)) {
				const next = node.title ? [...groups, node.title] : groups;
				for (const child of node.children) visit(child, next, tags);
				return;
			}
			const start = node.dateRangeIso.fromDateTimeIso;
			const end = node.dateRangeIso.toDateTimeIso;
			if (!/^\d{4}-\d{2}-\d{2}T/.test(start) || !/^\d{4}-\d{2}-\d{2}T/.test(end)) return;
			const wholeDays = /T00:00:00\.000/.test(start) && /T00:00:00\.000/.test(end) && !/\d:\d/.test(node.firstLine.datePart ?? '');
			const from = start.slice(0, 10);
			const to = wholeDays && end > start ? previousDay(end.slice(0, 10)) : end.slice(0, 10);
			const a = wholeDays ? from : start.slice(0, 16).replace('T', ' ');
			const b = wholeDays ? to : end.slice(0, 16).replace('T', ' ');
			events.push({ text: node.firstLine.restTrimmed, from, to, date: a === b ? a : `${a} to ${b}`, tags, groups, path });
		};
		visit(parsed.events, [], []);
		const header: unknown = parsed.header;
		const title = header && typeof header === 'object' && 'title' in header && typeof header.title === 'string' ? header.title : '';
		return { title, events, error: '' };
	} catch {
		return { title: '', events: [], error: 'Could not read this timeline. Open Source to check the text.' };
	}
}
export function filterEvents(events: TimelineEvent[], filter: Partial<TimelineFilter>): TimelineEvent[] {
	const tag = (filter.tag ?? '').trim().replace(/^#/, '').toLowerCase();
	return events.filter((e) => (!filter.from || e.to >= filter.from) && (!filter.to || e.from <= filter.to) && (!tag || e.tags.some((t) => t.toLowerCase() === tag)));
}
export function todayIndex(events: TimelineEvent[], today: string): number {
	let index = -1;
	events.forEach((e, i) => { if (e.from >= today && (index < 0 || e.from < events[index]!.from)) index = i; });
	return index;
}
export function localDay(d = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function markdownList(events: TimelineEvent[]): string {
	const safe = (s: string) => s.replace(/\r?\n/g, ' ').replace(/([\\`*_[\]<>])/g, '\\$1');
	return events.map((e) => `- ${e.date}: ${safe(e.text)}${e.tags.map((t) => ` #${safe(t)}`).join('')}${e.path ? ` (${safe(e.path)})` : ''}`).join('\n') + (events.length ? '\n' : '');
}
/** Golden-vector entry: a local model with an optional filter and fixed today. */
export function timelineCase(source: string, filter: Partial<TimelineFilter> = {}, today = ''): unknown {
	const doc = parseTimeline(source);
	const events = filterEvents(doc.events, filter);
	return { ...doc, events, todayIndex: today ? todayIndex(events, today) : -1 };
}
