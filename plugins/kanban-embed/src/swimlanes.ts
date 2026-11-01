// Pure logic of swimlanes: rows across the lanes of an embed. A row is a value of a card, a tag or a field.
// The lanes stay columns. A card is in exactly one row, so the counts of the rows add up to the card count.
// No Obsidian imports, so the golden vectors run in plain Node.
import type { ViewCard, ViewColumn } from './embed';

/** What the "swimlane:" line asks for. */
export type SwimlaneSpec =
	/** `swimlane: tag`. One row per tag; a card goes to the row of its first tag. */
	| { kind: 'tag' }
	/** `swimlane: #project/`. One row per tag below the prefix; the row title is the part after the prefix. */
	| { kind: 'prefix'; prefix: string }
	/** `swimlane: #now, #next, #later`. These rows in this order, also when empty. */
	| { kind: 'tags'; tags: string[] }
	/** `swimlane: @{owner}`. One row per value of the card field; `@{date}` and `@{time}` use the Kanban date and time. */
	| { kind: 'field'; name: string };

/** Row of the cards that have no value. */
export const UNASSIGNED_KEY = '\u0000none';
export const UNASSIGNED_TITLE = 'Unassigned';

export interface SwimRow {
	/** Stable key of the row, lower case; the key of the collapse state. */
	key: string;
	title: string;
	/** Number of cards in the row, after the done and text filters. */
	count: number;
	/** One list of cards for each column of the view, in column order. */
	cells: ViewCard[][];
}

const TAG_ITEM_RE = /^#[^\s#,]+$/;
const FIELD_RE = /^@\{([A-Za-z0-9_-]+)\}$/;

/** Reads the value of a "swimlane:" line. Returns the spec, or a message for the warning line under the embed. */
export function parseSwimlane(value: string): SwimlaneSpec | string {
	const v = value.trim();
	if (/^tags?$/i.test(v)) return { kind: 'tag' };
	const f = FIELD_RE.exec(v);
	if (f) return { kind: 'field', name: (f[1] ?? '').toLowerCase() };
	const items = v.split(/[\s,]+/).filter((x) => x !== '');
	const bad = `swimlane must be tag, #tag1, #tag2, #prefix/ or @{field}: ${v}`;
	if (items.length === 0 || !items.every((x) => TAG_ITEM_RE.test(x))) return bad;
	const [first] = items;
	if (items.length === 1 && first !== undefined && first.endsWith('/')) return first.length > 2 ? { kind: 'prefix', prefix: first } : bad;
	if (items.some((x) => x.endsWith('/'))) return `A prefix such as #project/ must be the only item of the swimlane line: ${v}`;
	return { kind: 'tags', tags: items };
}

/** The line that shows a spec in the settings of the embed, the inverse of parseSwimlane. */
export function describeSwimlane(spec: SwimlaneSpec): string {
	if (spec.kind === 'tag') return 'tag';
	if (spec.kind === 'prefix') return spec.prefix;
	if (spec.kind === 'tags') return spec.tags.join(', ');
	return `@{${spec.name}}`;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Value of a card field. Fields are written like the Kanban plugin and Dataview write them: `[owner:: Ana]`,
 * `(owner:: Ana)`, or `owner:: Ana` up to the end of the line. The name is not case sensitive.
 * `date` and `time` are the Kanban date `@{2026-10-14}` and time `@@{14:30}`.
 */
export function fieldValue(card: Pick<ViewCard, 'text' | 'date' | 'time'>, name: string): string | null {
	if (name === 'date') return card.date;
	if (name === 'time') return card.time;
	const n = escapeRe(name);
	const forms = [new RegExp(`\\[\\s*${n}\\s*::\\s*([^\\]\\n]*)\\]`, 'i'), new RegExp(`\\(\\s*${n}\\s*::\\s*([^)\\n]*)\\)`, 'i'), new RegExp(`(?:^|\\s)${n}\\s*::[ \\t]*([^\\n]*)`, 'i')];
	for (const re of forms) {
		const v = re.exec(card.text)?.[1]?.trim();
		if (v) return v;
	}
	return null;
}

/** True when `tag` is `want` or a tag below it (#web matches #web/auth, not #webdev). */
function underTag(tag: string, want: string): boolean {
	const t = tag.toLowerCase();
	const w = want.toLowerCase();
	return t === w || t.startsWith(`${w}/`);
}

interface Assign {
	key: string;
	title: string;
}

/** The row of a card, or null when it has no value for the spec. */
export function rowOf(card: Pick<ViewCard, 'text' | 'tags' | 'date' | 'time'>, spec: SwimlaneSpec): Assign | null {
	if (spec.kind === 'tag') {
		const t = card.tags[0];
		return t === undefined ? null : { key: t.toLowerCase(), title: t };
	}
	if (spec.kind === 'prefix') {
		const p = spec.prefix.toLowerCase();
		const t = card.tags.find((x) => x.toLowerCase().startsWith(p) && x.length > p.length);
		return t === undefined ? null : { key: t.toLowerCase(), title: t.slice(p.length) };
	}
	if (spec.kind === 'tags') {
		const want = spec.tags.find((w) => card.tags.some((t) => underTag(t, w)));
		return want === undefined ? null : { key: want.toLowerCase(), title: want };
	}
	const v = fieldValue(card, spec.name);
	return v === null ? null : { key: v.toLowerCase(), title: v };
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Splits the cards of every column into rows. Rows of `tag`, `prefix` and `field` come from the cards, sorted by
 * title; `tags` rows come from the line, in its order, and stay when empty. Cards without a value go to the
 * Unassigned row, which is the last row and shows only when it has cards.
 */
export function groupSwimlanes(columns: ViewColumn[], spec: SwimlaneSpec): SwimRow[] {
	const rows = new Map<string, SwimRow>();
	const make = (key: string, title: string): SwimRow => ({ key, title, count: 0, cells: columns.map(() => []) });
	if (spec.kind === 'tags') for (const t of spec.tags) if (!rows.has(t.toLowerCase())) rows.set(t.toLowerCase(), make(t.toLowerCase(), t));
	const none = make(UNASSIGNED_KEY, UNASSIGNED_TITLE);
	columns.forEach((col, ci) => {
		for (const card of col.cards) {
			const a = rowOf(card, spec);
			let row = none;
			if (a) {
				row = rows.get(a.key) ?? make(a.key, a.title);
				rows.set(a.key, row);
			}
			row.cells[ci]!.push(card);
			row.count++;
		}
	});
	const list = [...rows.values()];
	if (spec.kind !== 'tags') list.sort((a, b) => collator.compare(a.title, b.title) || (a.key < b.key ? -1 : 1));
	return none.count > 0 ? [...list, none] : list;
}

/**
 * Text to put at the end of a new card so that it lands in the row where it was added: the tag, or the field.
 * Empty for the Unassigned row.
 */
export function rowSuffix(spec: SwimlaneSpec, row: Pick<SwimRow, 'key' | 'title'>): string {
	if (row.key === UNASSIGNED_KEY) return '';
	if (spec.kind === 'tag' || spec.kind === 'tags') return ` ${row.title}`;
	if (spec.kind === 'prefix') return ` ${spec.prefix}${row.title}`;
	if (spec.name === 'date') return ` @{${row.title}}`;
	if (spec.name === 'time') return ` @@{${row.title}}`;
	return ` [${spec.name}:: ${row.title}]`;
}

/**
 * Where a card dropped into a cell goes: the number of the card it goes in front of, counted in its lane of its
 * own board file. `cell` holds the cards of the cell; `above` is how many of them are above the pointer.
 * With no card above the pointer in front of it, the card goes behind the last card of the cell, or at the end of
 * the lane when the cell is empty.
 */
export function dropIndex(cell: Pick<ViewCard, 'board' | 'index'>[], above: number, board: number, laneSize: number): number {
	const same = cell.filter((c) => c.board === board);
	const next = cell.slice(above).find((c) => c.board === board);
	if (next) return next.index;
	const last = same[same.length - 1];
	return last ? last.index + 1 : laneSize;
}
