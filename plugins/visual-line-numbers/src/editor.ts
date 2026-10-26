// CodeMirror 6 part of Visual Line Numbers. The app provides @codemirror/* at run time (esbuild marks them external).
// One gutter marker for each line block draws one number for each display row of the block. A ViewPlugin measures the rows
// of the drawn blocks (EditorView.moveToLineBoundary) in the measure phase; the gutter reads the result.
import { EditorSelection, StateEffect, type EditorState, type Extension } from '@codemirror/state';
import { BlockType, EditorView, GutterMarker, ViewPlugin, gutter, type BlockInfo, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { estimateRows, gutterDigits, labelUnits, motionHint, offscreenCursorRow, parseNoteFlag, rowIndexAt, rowStarts, totalWeight, unitStarts, type RowLabel, type Unit } from './numbering';
import type { EffectiveSettings } from './settings';

/** Dispatched to ask every gutter to redraw: settings, Pro state or a note property changed. */
export const refreshEffect = StateEffect.define<null>();

export interface EditorHooks {
	/** Current settings with Pro choices already applied. */
	settings(): EffectiveSettings;
	/** The value of the note property visual-line-numbers for the note of this editor. undefined when the note has none. */
	noteProperty(view: EditorView): unknown;
}

/** One drawn block, as measured: its text range, geometry, and where each display row starts. */
interface Measured {
	from: number;
	to: number;
	top: number;
	height: number;
	line: number;
	hidden: number;
	starts: number[];
}

interface RowView {
	text: string;
	hint: string;
	cls: string;
}

/** Draws one number for each display row of a line block. */
class RowsMarker extends GutterMarker {
	constructor(readonly rows: readonly RowView[]) {
		super();
	}

	eq(other: GutterMarker): boolean {
		if (!(other instanceof RowsMarker) || other.rows.length !== this.rows.length) return false;
		return this.rows.every((r, i) => r.text === other.rows[i]!.text && r.cls === other.rows[i]!.cls && r.hint === other.rows[i]!.hint);
	}

	toDOM(): HTMLElement {
		const box = createDiv({ cls: 'vln-rows' });
		for (const r of this.rows) {
			const row = box.createDiv({ cls: r.cls });
			if (r.cls.split(' ').includes('vln-dual')) {
				const [absolute, relative] = r.text.split(' | ');
				row.createSpan({ cls: 'vln-dual-absolute', text: absolute });
				row.createSpan({ cls: 'vln-dual-separator', text: ' | ' });
				row.createSpan({ cls: 'vln-dual-relative', text: relative });
			} else {
				row.setText(r.text);
			}
			if (r.hint) row.setAttr('data-hint', r.hint);
		}
		return box;
	}
}

/** Measured units of the blocks in the viewport. Blocks the editor has not measured get an estimate from their height. */
function unitsOf(view: EditorView, measured: Map<number, Measured>): { units: Unit[]; blocks: readonly BlockInfo[]; rows: number[][] } {
	const doc = view.state.doc;
	const blocks = view.viewportLineBlocks;
	const units: Unit[] = [];
	const rows: number[][] = [];
	for (const b of blocks) {
		const m = measured.get(b.from);
		if (m && m.to === b.to) {
			units.push({ line: m.line, rows: m.starts.length, hidden: m.hidden });
			rows.push(m.starts);
			continue;
		}
		const first = doc.lineAt(b.from);
		const last = doc.lineAt(Math.min(b.to, doc.length));
		units.push({ line: first.number, rows: estimateRows(b.height, view.defaultLineHeight), hidden: last.number - first.number });
		rows.push([b.from]);
	}
	return { units, blocks, rows };
}

/** Reads the rows of each drawn block. Runs in the measure phase, where layout reads are allowed. */
function measureViewport(view: EditorView): Measured[] {
	const doc = view.state.doc;
	const out: Measured[] = [];
	for (const b of view.viewportLineBlocks) {
		const first = doc.lineAt(b.from);
		const last = doc.lineAt(Math.min(b.to, doc.length));
		const text = b.type === BlockType.Text;
		const starts = text ? rowStarts(b.from, first.to, (p) => view.moveToLineBoundary(EditorSelection.cursor(p, 1), true, true).head) : [b.from];
		out.push({ from: b.from, to: b.to, top: b.top, height: b.height, line: first.number, hidden: last.number - first.number, starts });
	}
	return out;
}

export function sameMeasure(a: Map<number, Measured>, b: Measured[]): boolean {
	if (a.size !== b.length) return false;
	return b.every((m) => {
		const o = a.get(m.from);
		return o !== undefined && o.to === m.to && o.line === m.line && o.starts.length === m.starts.length && o.hidden === m.hidden && o.starts.every((start, i) => start === m.starts[i]);
	});
}

/** Every live gutter plugin, so the app code can ask them to redraw. */
const live = new Set<GutterState>();

export function refreshAll(): void {
	for (const g of live) g.view.dispatch({ effects: refreshEffect.of(null) });
}

class GutterState {
	measured = new Map<number, Measured>();
	/** Counts each new measurement, so the markers are built again. */
	private version = 0;
	private seen: { state: EditorState; blocks: readonly BlockInfo[]; version: number } | null = null;
	private memoKey = '';
	private memo = new Map<number, RowsMarker | null>();

	constructor(
		readonly view: EditorView,
		private readonly hooks: EditorHooks,
	) {
		live.add(this);
		this.schedule();
	}

	update(u: ViewUpdate): void {
		if (u.docChanged || u.viewportChanged || u.geometryChanged || u.heightChanged) this.schedule();
	}

	destroy(): void {
		live.delete(this);
	}

	private schedule(): void {
		this.view.requestMeasure({
			key: this,
			read: (v) => measureViewport(v),
			write: (m, v) => {
				if (sameMeasure(this.measured, m)) return;
				this.measured = new Map(m.map((x) => [x.from, x]));
				this.version++;
				// A dispatch is not allowed inside the measure phase, so ask for the redraw right after it.
				queueMicrotask(() => {
					if (live.has(this)) v.dispatch({ effects: refreshEffect.of(null) });
				});
			},
		});
	}

	/** The gutter is off in this note when Pro is on, the property option is on and the note says false. */
	private noteOff(): boolean {
		const s = this.hooks.settings();
		if (!s.noteProperty) return false;
		const flag = this.hooks.noteProperty(this.view);
		return parseNoteFlag(flag) === false;
	}

	/** Position of the cursor row from the start of the first unit. Exact when the cursor line is drawn, else an estimate from heights. */
	private cursorRow(units: Unit[], blocks: readonly BlockInfo[], rows: number[][], head: number, countFolded: boolean): number {
		const idx = blocks.findIndex((b) => head >= b.from && head <= b.to);
		if (idx >= 0) return unitStarts(units, countFolded)[idx]! + rowIndexAt(rows[idx]!, head, this.view.state.selection.main.assoc);
		const first = blocks[0];
		const last = blocks[blocks.length - 1];
		if (!first || !last) return 0;
		const cb = this.view.lineBlockAt(head);
		const rowHeight = this.view.defaultLineHeight;
		if (cb.top < first.top) return offscreenCursorRow(cb.top - first.top, rowHeight);
		return totalWeight(units, countFolded) + offscreenCursorRow(cb.top - (last.top + last.height), rowHeight);
	}

	private build(): void {
		const state = this.view.state;
		// The gutter asks for one marker for each block. The same state, blocks and measurement give the same markers.
		const seen = this.seen;
		if (seen && seen.state === state && seen.blocks === this.view.viewportLineBlocks && seen.version === this.version) return;
		this.seen = { state, blocks: this.view.viewportLineBlocks, version: this.version };
		const s = this.hooks.settings();
		const head = state.selection.main.head;
		const { units, blocks, rows } = unitsOf(this.view, this.measured);
		const off = this.noteOff();
		const key = `${this.version}|${off}|${s.mode}|${s.countFolded}|${s.highlightCurrent}|${s.motionHint}|${head}|${state.selection.main.assoc}|${state.doc.length}|${blocks.map((b) => b.from + ':' + b.to).join(',')}|${units.map((u) => u.rows).join('')}`;
		if (key === this.memoKey) return;
		this.memoKey = key;
		this.memo = new Map();
		if (off) return;
		const cursorRow = this.cursorRow(units, blocks, rows, head, s.countFolded);
		const labels = labelUnits(units, { mode: s.mode, countFolded: s.countFolded, cursorRow, cursorLine: state.doc.lineAt(head).number });
		blocks.forEach((b, i) => this.memo.set(b.from, new RowsMarker(labels[i]!.map((r) => rowView(r, s)))));
	}

	markerFor(block: BlockInfo): GutterMarker | null {
		this.build();
		return this.memo.get(block.from) ?? null;
	}
}

function rowView(r: RowLabel, s: EffectiveSettings): RowView {
	const current = r.distance === 0;
	const mode = s.mode === 'absolute' ? 'vln-abs' : s.mode === 'hybrid' && current ? 'vln-hyb' : 'vln-rel';
	const cls = ['vln-row', mode, s.mode === 'dual' ? 'vln-dual' : '', current ? 'vln-cur' : '', current && s.highlightCurrent ? 'vln-current' : ''].filter(Boolean).join(' ');
	return { text: r.text, hint: s.motionHint && s.mode !== 'absolute' ? motionHint(r.distance) : '', cls };
}

/** The editor extension: the measuring plugin and the gutter. Register it with Plugin.registerEditorExtension. */
export function gutterExtension(hooks: EditorHooks): Extension {
	const plugin = ViewPlugin.define((view) => new GutterState(view, hooks));
	const spacer = (view: EditorView): RowsMarker => {
		const digits = '9'.repeat(gutterDigits(view.state.doc.lines));
		const dual = hooks.settings().mode === 'dual';
		return new RowsMarker([{ text: dual ? `${digits} | ${digits}` : digits, hint: '', cls: dual ? 'vln-row vln-dual' : 'vln-row vln-rel' }]);
	};
	return [
		plugin,
		gutter({
			class: 'vln-gutter',
			lineMarker: (view, block) => view.plugin(plugin)?.markerFor(block) ?? null,
			lineMarkerChange: (u) => u.docChanged || u.viewportChanged || u.selectionSet || u.geometryChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshEffect))),
			initialSpacer: spacer,
			updateSpacer: (_, update) => spacer(update.view),
		}),
	];
}

/** The note that this editor shows, or null. main.ts uses its path to read the note property. */
export function fileOf(view: EditorView): { path: string } | null {
	return view.state.field(editorInfoField, false)?.file ?? null;
}
