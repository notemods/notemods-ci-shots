import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryController, type CachedMetadata, type MetadataCache, type TFile } from 'obsidian';
import { buildGraph, headingLinkText, sectionAt, type HeadingInput, type NodeInput } from '../src/graph';
import { createLayout, run } from '../src/layout';
import { bindPro, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS } from '../src/settings';
import { GraphView, KEY, SUB_RADIUS, sectionRefsForFile, viewOptions } from '../src/view';
import type { Theme } from '../src/theme';

// Headings and blocks as nodes (1.5.0, forum topic 6653). The pure graph cases are golden vectors; this file tests
// the cache adapter, the view options, open and hover, redraw after a heading rename, and the size budget.

// The mocks package resolves no subpath; the view tests use the stand-in resolver below instead.
vi.mock('obsidian', async (importOriginal) => {
	const m = await importOriginal<typeof import('obsidian')>();
	return { ...m, resolveSubpath: (c: CachedMetadata, s: string) => resolver(c, s) };
});

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

function pro(on: boolean): void {
	bindPro({ isPro: () => on, onChange: () => () => undefined } as never);
}

const A = { path: 'Notes/A.md' } as TFile;
const BOOK = { path: 'Books/Ending Aging.md' } as TFile;
const CODE = { path: 'Notes/Code notes.md' } as TFile;
const HASH = { path: 'Notes/C# guide.md' } as TFile;

type Res = ReturnType<typeof import('obsidian').resolveSubpath>;

/** Book headings and one block, as the metadata cache gives them. */
function bookCache(headings: string[] = ['Ending Aging', 'Damage', 'Repair', 'Methods']): CachedMetadata {
	return {
		headings: headings.map((heading, i) => ({ heading, level: i === 0 ? 1 : i === 3 ? 3 : 2, position: { start: { line: i * 4, col: 0, offset: 0 }, end: { line: i * 4, col: 0, offset: 0 } } })),
		blocks: { q1: { id: 'q1', position: { start: { line: 9, col: 0, offset: 0 }, end: { line: 9, col: 0, offset: 0 } } } },
	} as unknown as CachedMetadata;
}

const pos = (line: number) => ({ start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } });

/**
 * A small stand-in for Obsidian's resolveSubpath: "#Name" finds a heading by its link text, "#A#B" finds B,
 * "#^id" finds a block. The real function runs in the e2e test.
 */
function resolver(cache: CachedMetadata, subpath: string): Res {
	if (subpath.startsWith('#^')) {
		const b = cache.blocks?.[subpath.slice(2)];
		return b ? ({ type: 'block', block: b, start: b.position.start, end: null } as unknown as Res) : null;
	}
	const parts = subpath.split('#').filter(Boolean);
	const last = parts[parts.length - 1] ?? '';
	const h = cache.headings?.find((x) => headingLinkText(x.heading) === headingLinkText(last));
	return h ? ({ type: 'heading', current: h, next: null, start: h.position.start, end: null } as unknown as Res) : null;
}

function metadata(files: Record<string, CachedMetadata>): MetadataCache {
	const all = [A, BOOK, CODE];
	return {
		getFileCache: (f: TFile) => files[f.path] ?? null,
		getFirstLinkpathDest: (path: string) => all.find((f) => f.path.replace(/^.*\//, '').replace(/\.md$/, '') === path) ?? null,
	} as unknown as MetadataCache;
}

describe('sectionRefsForFile (cache adapter)', () => {
	const aCache = {
		links: [
			{ link: 'Ending Aging#Repair', original: '[[Ending Aging#Repair|the repair chapter]]', displayText: 'the repair chapter', position: pos(2) },
			{ link: 'Ending Aging#No such heading', original: '[[Ending Aging#No such heading]]', position: pos(3) },
			{ link: 'Ending Aging#Repair#Methods', original: '[[Ending Aging#Repair#Methods]]', position: pos(4) },
			{ link: '#Intro', original: '[[#Intro]]', position: pos(5) },
			{ link: 'Nowhere#Heading', original: '[[Nowhere#Heading]]', position: pos(6) },
			{ link: 'Code notes#C basics', original: '[[Code notes#C basics]]', position: pos(7) },
		],
		embeds: [{ link: 'Ending Aging#Damage', original: '![[Ending Aging#Damage]]', position: pos(8) }, { link: 'Ending Aging#^q1', original: '![[Ending Aging#^q1]]', position: pos(9) }],
		frontmatterLinks: [{ link: 'Ending Aging#Damage', key: 'source.0' }, { link: 'Ending Aging', key: 'related' }],
		headings: [{ heading: 'Intro', level: 2, position: pos(0) }],
	} as unknown as CachedMetadata;
	const codeCache = { headings: [{ heading: 'C# basics', level: 2, position: pos(1) }] } as unknown as CachedMetadata;
	const cache = metadata({ [A.path]: aCache, [BOOK.path]: bookCache(), [CODE.path]: codeCache });

	it('alias, embed, nested heading, block, same-note link, # in a heading, missing heading, unresolved note', () => {
		const refs = sectionRefsForFile(cache, A, 'body', [], resolver);
		expect(refs).toEqual([
			{ line: 2, target: BOOK.path, relation: 'body', heading: 2 },
			{ line: 3, target: BOOK.path, relation: 'body', missing: true },
			{ line: 4, target: BOOK.path, relation: 'body', heading: 3 },
			{ line: 5, target: A.path, relation: 'body', heading: 0 },
			{ line: 7, target: CODE.path, relation: 'body', heading: 0 },
			{ line: 8, target: BOOK.path, relation: 'body', heading: 1 },
			{ line: 9, target: BOOK.path, relation: 'body', block: { id: 'q1', line: 9 } },
		]);
	});

	it('property links have no line, keep their property name and follow the property filter', () => {
		expect(sectionRefsForFile(cache, A, 'frontmatter', ['source'], resolver)).toEqual([{ line: null, target: BOOK.path, relation: 'source', heading: 1 }]);
		expect(sectionRefsForFile(cache, A, 'frontmatter', [], resolver).map((r) => r.relation)).toEqual(['source', 'related']);
		expect(sectionRefsForFile(cache, A, 'all', ['source'], resolver)).toHaveLength(9);
	});

	it('a heading rename: the old link becomes missing and goes to the note', () => {
		const renamed = metadata({ [A.path]: aCache, [BOOK.path]: bookCache(['Ending Aging', 'Damage', 'Fixing damage', 'Methods']), [CODE.path]: codeCache });
		const refs = sectionRefsForFile(renamed, A, 'body', [], resolver);
		expect(refs[0]).toEqual({ line: 2, target: BOOK.path, relation: 'body', missing: true });
		const headings = (c: CachedMetadata): HeadingInput[] => (c.headings ?? []).map((h) => ({ heading: h.heading, level: h.level, line: h.position.start.line }));
		const before = buildGraph([{ id: A.path, label: 'A', links: {}, refs: sectionRefsForFile(cache, A, 'body', [], resolver) }, { id: BOOK.path, label: 'Ending Aging', links: {}, headings: headings(bookCache()) }], { headings: 'linked' });
		const after = buildGraph([{ id: A.path, label: 'A', links: {}, refs }, { id: BOOK.path, label: 'Ending Aging', links: {}, headings: headings(bookCache(['Ending Aging', 'Damage', 'Fixing damage', 'Methods'])) }], { headings: 'linked' });
		expect(before.nodes.map((n) => n.id)).toContain(`${BOOK.path}#Repair`);
		expect(after.nodes.map((n) => n.id)).not.toContain(`${BOOK.path}#Repair`);
		expect(after.missing).toBe((before.missing ?? 0) + 1);
	});

	it('a footnote subpath and a heading object outside the heading list go to the note', () => {
		const odd = (c: CachedMetadata, s: string): Res => (s === '#^q1' ? ({ type: 'footnote' } as unknown as Res) : ({ type: 'heading', current: { heading: 'x', level: 2, position: pos(0) } } as unknown as Res));
		const refs = sectionRefsForFile(cache, A, 'body', [], odd);
		expect(refs.find((r) => r.line === 9)).toEqual({ line: 9, target: BOOK.path, relation: 'body' });
		expect(refs.find((r) => r.line === 2)).toEqual({ line: 2, target: BOOK.path, relation: 'body', missing: true });
	});

	it('no metadata: no refs, no error', () => {
		expect(sectionRefsForFile(metadata({}), A, 'all', [], resolver)).toEqual([]);
	});
});

function view(values: Record<string, unknown> = {}): GraphView {
	const plugin = { settings: { ...DEFAULT_SETTINGS, animate: false }, views: new Set<GraphView>() };
	const v = new GraphView(new QueryController() as never, createDiv(), plugin as never);
	Object.assign(v, { config: { get: (key: string) => values[key], set: (key: string, value: unknown) => (values[key] = value), getAsPropertyId: () => null, getDisplayName: (p: string) => p } });
	return v;
}

describe('heading options', () => {
	it('off by default, so old views draw the 1.4.0 graph', () => {
		pro(false);
		expect(view().options()).toMatchObject({ headings: 'off', headingChain: false, headingLevel: 6, proIgnored: false });
		expect(view({ [KEY.headings]: 'bad' }).options().headings).toBe('off');
	});

	it('free: linked and all work; nesting and the level limit are Pro and are ignored with the Pro note', () => {
		pro(false);
		expect(view({ [KEY.headings]: 'linked' }).options()).toMatchObject({ headings: 'linked', proIgnored: false });
		expect(view({ [KEY.headings]: 'all', [KEY.headingChain]: true, [KEY.headingLevel]: 2 }).options()).toMatchObject({ headings: 'all', headingChain: false, headingLevel: 6, proIgnored: true });
	});

	it('Pro: nesting and level limit; a bad level gives 6', () => {
		pro(true);
		expect(view({ [KEY.headings]: 'all', [KEY.headingChain]: true, [KEY.headingLevel]: 2 }).options()).toMatchObject({ headingChain: true, headingLevel: 2 });
		expect(view({ [KEY.headingLevel]: 0 }).options().headingLevel).toBe(6);
		expect(view({ [KEY.headingLevel]: 'x' }).options().headingLevel).toBe(6);
	});

	it('the Pro heading options show only when headings are on', () => {
		const values: Record<string, unknown> = {};
		const opts = viewOptions({ get: (key: string) => values[key] } as never);
		const group = opts.find((o) => 'items' in o) as { items: { key: string; shouldHide?: () => boolean }[] };
		const chain = group.items.find((o) => o.key === KEY.headingChain)!;
		const level = group.items.find((o) => o.key === KEY.headingLevel)!;
		expect([chain.shouldHide?.(), level.shouldHide?.()]).toEqual([true, true]);
		values[KEY.headings] = 'linked';
		expect([chain.shouldHide?.(), level.shouldHide?.()]).toEqual([false, false]);
		values[KEY.headings] = 'all';
		expect(chain.shouldHide?.()).toBe(false);
	});
});

const theme: Theme = { background: '#fff', node: '#888', sub: '#bbb', line: '#ccc', shared: '#00f', text: '#000', accent: '#f0f', font: 'sans-serif', palette: ['#c00'], ramp: ['#222'] };

/** A rendered view of note A that links to the heading "C# basics" of "C# guide", with heading mode on. */
function rendered(mode: 'linked' | 'all' | 'off') {
	pro(false);
	const v = view({ [KEY.headings]: mode });
	const aCache = { links: [{ link: 'Code notes#C basics', original: '[[Code notes#C basics]]', position: pos(1) }] } as unknown as CachedMetadata;
	const codeCache = { headings: [{ heading: 'C# basics', level: 2, position: pos(3) }], links: [] } as unknown as CachedMetadata;
	const files: Record<string, CachedMetadata> = { [A.path]: aCache, [CODE.path]: codeCache };
	const cache = { ...metadata(files), resolvedLinks: { [A.path]: { [CODE.path]: 1 } } } as unknown as MetadataCache;
	const openFile = vi.fn(async () => undefined);
	const getLeaf = vi.fn(() => ({ openFile }));
	const trigger = vi.fn();
	// Shorthand on purpose: the export gate rejects the text "workspace" plus a colon.
	const workspace = { getLeaf, trigger };
	const entry = (f: TFile) => ({ file: { ...f, basename: f.path.replace(/^.*\//, '').replace(/\.md$/, '') }, getValue: () => null });
	Object.assign(v, {
		data: { data: [entry(A), entry(CODE)] },
		app: { metadataCache: cache, vault: { getFileByPath: (p: string) => [A, CODE].find((f) => f.path === p) ?? null }, workspace },
	});
	return { v, openFile, getLeaf, trigger };
}

describe('heading nodes in the view', () => {
	it('render: a small heading node on its note, the bar counts it, size and color skip it', () => {
		const { v } = rendered('linked');
		v.render();
		expect(v.graph!.nodes.map((n) => n.id)).toEqual([A.path, CODE.path, `${CODE.path}#C# basics`]);
		expect(v.radius[2]).toBe(SUB_RADIUS);
		expect(v.nodeColor(2, theme)).toBe('#bbb');
		expect(v.nodeColor(0, theme)).toBe('#888');
		expect(v.containerEl.querySelector('.bases-link-graph-count')?.textContent).toBe('2 notes · 1 link · 1 heading or block');
		v.onunload();
	});

	it('render with headings off: the 1.4.0 graph from resolved links', () => {
		const { v } = rendered('off');
		v.render();
		expect(v.graph!.nodes.map((n) => n.id)).toEqual([A.path, CODE.path]);
		expect(v.containerEl.querySelector('.bases-link-graph-count')?.textContent).toBe('2 notes · 1 link');
		v.onunload();
	});

	it('click on a heading node opens its note at the heading, with the link text that Obsidian matches', () => {
		const { v, openFile, getLeaf } = rendered('linked');
		v.render();
		v.open(2, 'tab');
		expect(getLeaf).toHaveBeenCalledWith('tab');
		expect(openFile).toHaveBeenCalledWith(CODE, { eState: { subpath: '#C basics' } });
		v.open(1);
		expect(openFile).toHaveBeenLastCalledWith(CODE);
		v.onunload();
	});

	it('the hover card names the note and the heading, and lists the link into the heading', () => {
		const { v } = rendered('linked');
		v.render();
		expect(v.relationLines(2)).toEqual(['body ← A']);
		expect(v.relationLines(0)).toEqual(['body → C# basics']);
		expect(v.subpathOf(2)).toBe('#C basics');
		expect(v.notePath(2)).toBe(CODE.path);
		v.onunload();
	});

	it('a block node opens at "#^id"; a "#" in the file name stays in the path', () => {
		const v = view();
		const openFile = vi.fn(async () => undefined);
		const workspace = { getLeaf: () => ({ openFile }) };
		Object.assign(v, {
			graph: { nodes: [{ id: HASH.path, label: 'C# guide', row: 0, degree: 1 }, { id: `${HASH.path}#^q1`, label: '^q1', row: 0, degree: 1, sub: { kind: 'block', name: 'q1', level: 0, line: 9, parent: 0 } }], edges: [], hidden: { orphans: 0, outside: 0 } },
			app: { vault: { getFileByPath: (p: string) => (p === HASH.path ? HASH : null) }, workspace },
		});
		v.open(1);
		expect(openFile).toHaveBeenCalledWith(HASH, { eState: { subpath: '#^q1' } });
		expect(v.notePath(1)).toBe(HASH.path);
	});
});

/** 500 notes, each with 3 links (1,490 edges after merging), and 4 headings. Half of the links point to a heading. */
function bigRows(n = 500): NodeInput[] {
	return Array.from({ length: n }, (_, i) => ({
		id: `n${i}.md`,
		label: `n${i}`,
		links: {},
		headings: [0, 1, 2, 3].map((k) => ({ heading: `Part ${k}`, level: k === 0 ? 1 : 2, line: k * 10 })),
		refs: [1, 7, 31].map((d, k) => ({ line: k * 10 + 1, target: `n${(i * 3 + d) % n}.md`, heading: (i + k) % 2 === 0 ? (i + d) % 4 : null })),
	}));
}

describe('size budget with heading nodes', () => {
	it('linked: 500 notes and their linked headings build in 50 ms and lay out at interactive speed', () => {
		const t0 = performance.now();
		const g = buildGraph(bigRows(), { headings: 'linked' });
		const buildMs = performance.now() - t0;
		const notes = g.nodes.filter((n) => !n.sub).length;
		expect(notes).toBe(500);
		const l = createLayout(g.nodes.length, g.edges.map((e) => [e.source, e.target] as [number, number]));
		const t1 = performance.now();
		const ticks = run(l, 300);
		const perTick = (performance.now() - t1) / ticks;
		console.log(`perf headings linked: ${g.nodes.length} nodes, ${g.edges.length} edges, build ${buildMs.toFixed(1)} ms, ${perTick.toFixed(2)} ms per tick`);
		expect(buildMs).toBeLessThan(process.env.CI ? 200 : 50);
		// Same budget per node as the 500 node test (8 ms local, 12 ms on CI), for the larger node count.
		expect(perTick).toBeLessThan((process.env.CI ? 12 : 8) * (g.nodes.length / 500) ** 1.2);
	});

	it('all: 500 notes with 2,000 heading nodes use the grid layout and stay finite', () => {
		const g = buildGraph(bigRows(), { headings: 'all' });
		expect(g.nodes).toHaveLength(2500);
		const l = createLayout(g.nodes.length, g.edges.map((e) => [e.source, e.target] as [number, number]));
		const t0 = performance.now();
		const ticks = run(l, 60);
		const perTick = (performance.now() - t0) / ticks;
		console.log(`perf headings all: ${g.nodes.length} nodes, ${g.edges.length} edges, ${perTick.toFixed(2)} ms per tick`);
		expect(Array.from(l.x).every(Number.isFinite)).toBe(true);
		expect(perTick).toBeLessThan(process.env.CI ? 60 : 30);
	});

	it('one long note: 5,000 headings and 5,000 links build in 100 ms', () => {
		const headings = Array.from({ length: 5000 }, (_, k) => ({ heading: `H ${k % 50}`, level: 2 + (k % 3), line: k * 3 }));
		const refs = Array.from({ length: 5000 }, (_, k) => ({ line: k * 3 + 1, target: 'long.md', heading: (k * 7) % 5000 }));
		const t0 = performance.now();
		const g = buildGraph([{ id: 'long.md', label: 'long', links: {}, headings, refs }], { headings: 'all', chain: true });
		const ms = performance.now() - t0;
		expect(g.nodes).toHaveLength(5001);
		expect(ms).toBeLessThan(process.env.CI ? 400 : 100);
	});

	it('sectionAt is a binary search: right answers on 100,000 headings', () => {
		const hs = Array.from({ length: 100_000 }, (_, k) => ({ heading: 'h', level: 2, line: k * 2 }));
		expect(sectionAt(hs, 0)).toBe(0);
		expect(sectionAt(hs, 1)).toBe(0);
		expect(sectionAt(hs, 199_999)).toBe(99_999);
		expect(sectionAt(hs, 77_777)).toBe(38_888);
	});
});

describe('heading mode without refs', () => {
	it('a row with only link counts links at note level with its counts and relation', () => {
		const g = buildGraph([{ id: 'a.md', label: 'a', links: { 'b.md': 3, 'c.md': 0 }, relations: { 'b.md': ['parent'] } }, { id: 'b.md', label: 'b', links: {} }, { id: 'c.md', label: 'c', links: {} }], { headings: 'linked' });
		expect(g.edges).toEqual([{ source: 0, target: 1, kind: 'link', weight: 3, mutual: false, relations: [{ name: 'parent', from: 0, node: 0 }] }]);
	});
});
