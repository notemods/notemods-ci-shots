// Pure logic of the kanban-embed code block: read its options, and build the columns to draw from one or more
// parsed boards. No Obsidian imports, so the golden vectors run in plain Node.
import { parseBoard, type Card } from './board';
import { parseSwimlane, type SwimlaneSpec } from './swimlanes';

export interface EmbedConfig {
	/** Link texts of the boards, in order ("Projects/Website" from "[[Projects/Website]]"). */
	boards: string[];
	/** Lane titles to show, in this order. Empty shows every lane in board order. */
	lanes: string[];
	/** Hide checked cards. Null means: use the plugin setting. */
	hideDone: boolean | null;
	/** Words a card must contain; "#tag" words must be tags of the card. Pro. */
	filter: string[];
	/** Text shown above the board instead of the board name. */
	title: string;
	/** Rows across the lanes, from the "swimlane:" line. Pro. Not set when the block has no such line. */
	swimlane?: SwimlaneSpec;
	/** Lines that were not understood, for the error line under the embed. */
	errors: string[];
}

const KEYS = new Set(['board', 'boards', 'lanes', 'lane', 'hide-done', 'filter', 'title', 'swimlane', 'rows']);

/** Link texts in a value: [[a]], [[b|alias]] or plain comma separated paths. */
export function parseLinks(value: string): string[] {
	const out: string[] = [];
	const wiki = [...value.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => (m[1] ?? '').trim());
	if (wiki.length > 0) return wiki.filter((x) => x !== '');
	for (const part of value.split(',')) {
		const p = part.trim().replace(/^"(.*)"$/, '$1');
		if (p !== '') out.push(p);
	}
	return out;
}

/** Reads the code block text. Unknown keys and bad values are reported, never thrown. */
export function parseConfig(source: string): EmbedConfig {
	const cfg: EmbedConfig = { boards: [], lanes: [], hideDone: null, filter: [], title: '', errors: [] };
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;
		const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
		const key = m?.[1]?.toLowerCase() ?? '';
		const value = m?.[2]?.trim() ?? '';
		if (!m || !KEYS.has(key)) {
			cfg.errors.push(`Unknown line: ${line}`);
			continue;
		}
		if (key === 'board' || key === 'boards') cfg.boards.push(...parseLinks(value));
		else if (key === 'lanes' || key === 'lane') cfg.lanes.push(...value.split(',').map((x) => x.trim()).filter((x) => x !== ''));
		else if (key === 'hide-done') {
			if (/^(true|yes|on)$/i.test(value)) cfg.hideDone = true;
			else if (/^(false|no|off)$/i.test(value)) cfg.hideDone = false;
			else cfg.errors.push(`hide-done must be true or false: ${value}`);
		} else if (key === 'filter') cfg.filter.push(...value.split(/\s+/).filter((x) => x !== ''));
		else if (key === 'swimlane' || key === 'rows') {
			const spec = parseSwimlane(value);
			if (typeof spec === 'string') cfg.errors.push(spec);
			else cfg.swimlane = spec;
		} else cfg.title = value;
	}
	if (cfg.boards.length === 0) cfg.errors.push('Add a line like: board: [[My board]]');
	return cfg;
}

export interface SourceBoard {
	/** Vault path of the board file. */
	path: string;
	/** Display name (the file name without .md). */
	name: string;
	markdown: string;
}

export interface ViewCard extends Card {
	/** Index of the board in the embed's board list. */
	board: number;
	/** Lane index inside its own board file. */
	lane: number;
	/** Card index inside its lane in the board file. */
	index: number;
	/** First line of the card in the file, to detect a change made elsewhere before an edit. */
	raw: string;
}

export interface ViewColumn {
	title: string;
	maxItems: number;
	complete: boolean;
	/** Where a new card or a dropped card goes: [board index, lane index] of each board that has this lane. */
	targets: { board: number; lane: number; size: number }[];
	cards: ViewCard[];
	/** Number of cards in the lane before the done filter and the text filter. */
	total: number;
}

export interface EmbedView {
	columns: ViewColumn[];
	/** Lane names asked for in "lanes:" that no board has. */
	missingLanes: string[];
	/** Boards whose file does not have the kanban-plugin frontmatter key. */
	notBoards: string[];
	cards: number;
	hidden: number;
}

/** True when a card passes every filter word. "#tag" words match the tags of the card, other words its text. */
export function matchesFilter(card: Pick<Card, 'text' | 'tags'>, words: string[]): boolean {
	const text = card.text.toLowerCase();
	const tags = card.tags.map((t) => t.toLowerCase());
	return words.every((w) => {
		const x = w.toLowerCase();
		return x.startsWith('#') ? tags.some((t) => t === x || t.startsWith(`${x}/`)) : text.includes(x);
	});
}

/** Key for merging lanes of several boards: titles that differ only in case or spaces are one column. */
function laneKey(title: string): string {
	return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Builds the columns of an embed. Lanes with the same title in several boards become one column, in the order
 * of first appearance (or the order of "lanes:"). Cards keep their board, lane and card index for edits.
 */
export function buildView(boards: SourceBoard[], opts: { lanes?: string[]; hideDone?: boolean; filter?: string[] } = {}): EmbedView {
	const cols = new Map<string, ViewColumn>();
	const notBoards: string[] = [];
	boards.forEach((b, bi) => {
		const parsed = parseBoard(b.markdown);
		if (!parsed.isBoard) notBoards.push(b.path);
		const lines = b.markdown.split(/\r?\n/);
		parsed.lanes.forEach((lane, li) => {
			const key = laneKey(lane.title);
			let col = cols.get(key);
			if (!col) {
				col = { title: lane.title, maxItems: lane.maxItems, complete: lane.complete, targets: [], cards: [], total: 0 };
				cols.set(key, col);
			}
			col.targets.push({ board: bi, lane: li, size: lane.cards.length });
			lane.cards.forEach((c, ci) => col.cards.push({ ...c, board: bi, lane: li, index: ci, raw: lines[c.line] ?? '' }));
		});
	});
	const wanted = (opts.lanes ?? []).map(laneKey);
	const picked = wanted.length > 0 ? wanted.map((k) => cols.get(k)).filter((c): c is ViewColumn => c !== undefined) : [...cols.values()];
	const missingLanes = (opts.lanes ?? []).filter((l) => !cols.has(laneKey(l)));
	let cards = 0;
	let hidden = 0;
	for (const col of picked) {
		col.total = col.cards.length;
		col.cards = col.cards.filter((c) => !(opts.hideDone && c.checked) && matchesFilter(c, opts.filter ?? []));
		cards += col.cards.length;
		hidden += col.total - col.cards.length;
	}
	return { columns: picked, missingLanes, notBoards, cards, hidden };
}
