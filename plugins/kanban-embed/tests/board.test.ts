import { describe, expect, it } from 'vitest';
import { cardMeta, insertLine, parseBoard, parseLaneTitle, priorityOf, splitLines, toggleCard } from '../src/board';

const BOARD = [
	'---',
	'',
	'kanban-plugin: board',
	'',
	'---',
	'',
	'## Todo',
	'',
	'- [ ] Write brief #docs #docs/web',
	'- [ ] Call Ana @{2026-10-12} @@{09:30}',
	'',
	'## Doing (2)',
	'',
	'- [ ] Draft homepage',
	'\tSecond line',
	'    third line ^abc12',
	'- [x] Old <br>style',
	'',
	'## Done',
	'',
	'**Complete**',
	'- [x] Set up repo',
	'',
	'***',
	'',
	'## Archive',
	'',
	'- [x] Archived',
	'',
	'%% kanban:settings',
	'```',
	'{"kanban-plugin":"board"}',
	'```',
	'%%',
	'',
].join('\n');

describe('parseBoard', () => {
	const b = parseBoard(BOARD);

	it('reads the frontmatter key, lanes, limits and the Complete marker', () => {
		expect(b.isBoard).toBe(true);
		expect(b.lanes.map((l) => [l.title, l.maxItems, l.complete, l.cards.length])).toEqual([
			['Todo', 0, false, 2],
			['Doing', 2, false, 2],
			['Done', 0, true, 1],
		]);
		expect(b.lanes[2]!.markerLine).toBe(20);
	});

	it('keeps archived cards apart', () => {
		expect(b.archive.map((c) => c.text)).toEqual(['Archived']);
	});

	it('reads multi-line cards, drops the block id and turns <br> into a new line', () => {
		const [draft, old] = b.lanes[1]!.cards;
		expect(draft!.text).toBe('Draft homepage\nSecond line\nthird line');
		expect([draft!.line, draft!.end]).toEqual([13, 16]);
		expect(old!.text).toBe('Old \nstyle');
		expect(old!.checked).toBe(true);
	});

	it('reads tags, date and time', () => {
		const [brief, call] = b.lanes[0]!.cards;
		expect(brief!.tags).toEqual(['#docs', '#docs/web']);
		expect(call!.date).toBe('2026-10-12');
		expect(call!.time).toBe('09:30');
		expect(call!.title).toBe('Call Ana');
	});

	it('treats a note without the frontmatter key as a plain list of lanes', () => {
		const p = parseBoard('# Plan\n\n- [ ] a\n- b\n');
		expect(p.isBoard).toBe(false);
		expect(p.lanes[0]!.cards.map((c) => [c.text, c.checkChar])).toEqual([
			['a', ' '],
			['b', null],
		]);
	});

	it('ignores list items before the first heading', () => {
		expect(parseBoard('- [ ] loose\n## A\n- [ ] in').lanes[0]!.cards.map((c) => c.text)).toEqual(['in']);
	});

	it('counts a custom check character as done and keeps it', () => {
		const c = parseBoard('## A\n- [/] half').lanes[0]!.cards[0]!;
		expect([c.checkChar, c.checked]).toEqual(['/', true]);
	});
});

describe('helpers', () => {
	it('parseLaneTitle reads the limit only at the end', () => {
		expect(parseLaneTitle('Doing (3)')).toEqual({ title: 'Doing', maxItems: 3 });
		expect(parseLaneTitle('Q (3) plan')).toEqual({ title: 'Q (3) plan', maxItems: 0 });
	});

	it('cardMeta reads a date link and strips it from the title', () => {
		expect(cardMeta('Pay rent @[[2026-11-01]] #home')).toEqual({ title: 'Pay rent #home', tags: ['#home'], date: '2026-11-01', time: null });
	});

	it('splitLines keeps the line ending', () => {
		expect(splitLines('a\r\nb').eol).toBe('\r\n');
		expect(splitLines('a\nb').eol).toBe('\n');
	});

	it('insertLine puts a card after the Complete marker of an empty lane', () => {
		const md = '## Done\n**Complete**\n\n## Next\n';
		const lines = md.split('\n');
		const lane = parseBoard(md).lanes[0]!;
		expect(insertLine(lines, lane, 0)).toBe(2);
	});

	it('priorityOf reads the priority tags without case and returns null without a priority tag', () => {
		expect(priorityOf(['#URGENT'])).toBe('high');
		expect(priorityOf(['#docs', '#P1'])).toBe('high');
		expect(priorityOf(['#med'])).toBe('medium');
		expect(priorityOf(['#p3'])).toBe('low');
		expect(priorityOf(['#docs', '#low'])).toBe('low');
		expect(priorityOf(['#low', '#high'])).toBe('high');
		expect(priorityOf(['#p3', '#Med'])).toBe('medium');
		expect(priorityOf(['#high-ish', '#lower', '#p10'])).toBe(null);
		expect(priorityOf(['#docs'])).toBe(null);
		expect(priorityOf([])).toBe(null);
	});

	it('a card with a priority tag gets a priority and the class shows it', () => {
		const b = parseBoard('## A\n- [ ] Ship it #high\n- [ ] Chill #docs\n');
		const [hot, calm] = b.lanes[0]!.cards;
		expect(hot!.priority).toBe('high');
		expect(calm!.priority).toBe(null);
	});
});

describe('lane headings', () => {
	it('keeps a # that ends a word in the lane title and strips only a closing sequence after a space', () => {
		const titles = (md: string) => parseBoard(md).lanes.map((l) => l.title);
		expect(titles('## C#\n- [ ] a\n## F# (2)\n## Done ##\n## Issue #12\n')).toEqual(['C#', 'F#', 'Done', 'Issue #12']);
	});
});

describe('code fences in large boards', () => {
	it('keeps shorter and other fence markers inside a longer fence', () => {
		const md = '---\nkanban-plugin: board\n---\n## Real\n````markdown\n```\n## Fake\n- [ ] Not a card\n~~~\n````\n- [ ] Real card\n';
		const board = parseBoard(md);
		expect(board.lanes.map((l) => l.title)).toEqual(['Real']);
		expect(board.lanes[0]!.cards.map((c) => c.title)).toEqual(['Real card']);
	});
	it('does not close a fence with a marker followed by text', () => {
		const md = '## Lane\n~~~js\n~~~not a close\n- [ ] Code\n~~~\n- [ ] Task\n';
		expect(parseBoard(md).lanes[0]!.cards.map((c) => c.title)).toEqual(['Task']);
	});
	it('keeps 500 Unicode cards and changes only the chosen checkbox', () => {
		const cards = Array.from({ length: 500 }, (_, i) => `- [ ] ${i} 日本語 😀 مرحبا ${'x'.repeat(i === 499 ? 10000 : 2)}`);
		const md = `---\r\nkanban-plugin: board\r\n---\r\n## Lane\r\n${cards.join('\r\n')}\r\n`;
		expect(parseBoard(md).lanes[0]!.cards).toHaveLength(500);
		const result = toggleCard(md, { lane: 0, card: 499, expect: cards[499] }, true);
		expect(result).toEqual({ ok: true, md: md.replace(cards[499]!, cards[499]!.replace('[ ]', '[x]')) });
	});
});
