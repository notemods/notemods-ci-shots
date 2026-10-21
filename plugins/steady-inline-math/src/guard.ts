import { EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { invertedEffects } from '@codemirror/commands';
import { equations } from './math';

export interface OwnedChar { pos: number; char: string }
export const ownedEffect = StateEffect.define<readonly OwnedChar[]>({
	map: (value, changes) => value.flatMap((c) => { const pos = changes.mapPos(c.pos, 1); return changes.mapPos(c.pos + 1, -1) === pos + 1 ? [{ ...c, pos }] : []; }),
});
interface RestoreChar { anchor: number; offset: number; char: string }
export const restoreOwnedEffect = StateEffect.define<readonly RestoreChar[]>({
	// History maps effects in the current document, before the inverse changes run.
	map: (value, changes) => value.map((c) => ({ ...c, anchor: changes.mapPos(c.anchor, 1) })),
});
export const ownershipHistory = invertedEffects.of((tr) => {
	const lost: RestoreChar[] = [];
	tr.changes.iterChanges((from, to, newFrom) => {
		for (const c of tr.startState.field(ownedField)) if (c.pos >= from && c.pos < to) lost.push({ anchor: newFrom, offset: c.pos - from, char: c.char });
	});
	return lost.length ? [restoreOwnedEffect.of(lost)] : [];
});
export const refreshEffect = StateEffect.define<null>();
export const ownedField = StateField.define<readonly OwnedChar[]>({
	create: () => [],
	update(owned, tr) {
		let next = owned.flatMap((c) => {
			const pos = tr.changes.mapPos(c.pos, 1);
			const end = tr.changes.mapPos(c.pos + 1, -1);
			return end === pos + 1 && tr.newDoc.sliceString(pos, end) === c.char ? [{ pos, char: c.char }] : [];
		});
		for (const effect of tr.effects) {
			if (effect.is(ownedEffect)) next = effect.value.filter((c) => tr.newDoc.sliceString(c.pos, c.pos + 1) === c.char);
			if (effect.is(restoreOwnedEffect)) {
				const restored = effect.value.map((c) => ({ pos: tr.changes.mapPos(c.anchor, -1) + c.offset, char: c.char }));
				next.push(...restored.filter((c) => c.pos >= 0 && c.pos < tr.newDoc.length && tr.newDoc.sliceString(c.pos, c.pos + 1) === c.char && !next.some((n) => n.pos === c.pos)));
			}
		}
		next.sort((a, b) => a.pos - b.pos);
		return next;
	},
	provide: (field) => [
		EditorView.decorations.from(field, (owned) => Decoration.set(owned.map((c) => Decoration.replace({}).range(c.pos, c.pos + 1)), true)),
		EditorView.atomicRanges.of((view) => Decoration.set(view.state.field(field).map((c) => Decoration.replace({}).range(c.pos, c.pos + 1)), true)),
	],
});

/** Deletes only live, mapped characters owned by this instance. */
export function cleanupSpec(state: EditorState): TransactionSpec | null {
	const owned = state.field(ownedField, false) ?? [];
	if (!owned.length) return null;
	return {
		changes: owned.map((c) => ({ from: c.pos, to: c.pos + 1 })),
		effects: ownedEffect.of([]),
		annotations: Transaction.addToHistory.of(false),
		filter: false,
	};
}

/** Guard maintenance is not a user edit and does not add an Undo event. */
export function guardPlan(state: EditorState, eligible = true, blocked = false): TransactionSpec | null {
	if (blocked || state.selection.ranges.length !== 1) return null;
	const caret = state.selection.main;
	const owned = state.field(ownedField);
	const active = eligible && caret.empty ? equations(state.doc.toString()).find((e) => caret.head > e.from && caret.head < e.to) : undefined;
	if (owned.length) {
		if (active && owned.every((c) => c.pos > active.from && c.pos < active.to - 1)) return null;
		return cleanupSpec(state);
	}
	if (!active) return null;
	const a = active.from + 1;
	const b = active.to - 1;
	const changes = state.changes([{ from: a, insert: '{}' }, { from: b, insert: '{}' }]);
	const positions = [a, b + 2];
	const added = positions.flatMap((pos) => [{ pos, char: '{' }, { pos: pos + 1, char: '}' }]);
	return {
		changes,
		selection: EditorSelection.cursor(changes.mapPos(caret.head, caret.head === b ? -1 : 1)),
		effects: ownedEffect.of(added),
		annotations: Transaction.addToHistory.of(false),
		filter: false,
	};
}

export interface GuardOptions {
	eligible(state: EditorState): boolean;
	focusOnly?: boolean;
	/** Called when an editor drops its guards. A save that started earlier can still write the guarded source. */
	onLost?(state: EditorState, clean: string): void;
}

export class GuardController {
	readonly views = new Set<EditorView>();
	private composing = new Set<EditorView>();
	private stopped = false;
	readonly extension: Extension;

	constructor(private options: GuardOptions) {
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- The nested view class needs its controller.
		const owner = this;
		this.extension = [ownedField,
			ownershipHistory,
			EditorState.transactionFilter.of((tr) => {
				// User edits and history remain intact. Maintenance follows them in a separate transaction.
				if (tr.docChanged || owner.stopped || owner.isComposing(tr.startState)) return tr;
				const spec = guardPlan(tr.state, owner.allowed(tr.state, tr.startState));
				return spec ? [tr, { ...spec, sequential: true }] : tr;
			}),
			ViewPlugin.fromClass(class {
				private queued = false;
				private live = true;
				constructor(readonly view: EditorView) { owner.views.add(view); this.schedule(); }
				update(update: ViewUpdate): void {
					for (const tr of update.transactions) if (tr.docChanged && !owner.stopped && owned(tr.startState).length && !owned(tr.state).length) owner.options.onLost?.(tr.startState, cleanSource(tr.startState));
					this.schedule();
				}
				schedule(): void {
					if (this.queued) return;
					this.queued = true;
					queueMicrotask(() => {
						this.queued = false;
						if (!this.live || owner.stopped || owner.isComposing(this.view.state)) return;
						const spec = guardPlan(this.view.state, owner.allowed(this.view.state));
						if (spec) this.view.dispatch(spec);
					});
				}
				destroy(): void {
					this.live = false;
					// A closed editor cannot dispatch, and its host may already have saved the guarded source.
					if (!owner.stopped && owned(this.view.state).length) owner.options.onLost?.(this.view.state, cleanSource(this.view.state));
					owner.views.delete(this.view); owner.composing.delete(this.view);
				}
			}, { eventHandlers: {
				focus(_event, view) { queueMicrotask(() => { if (!owner.stopped && owner.views.has(view) && !owner.isComposing(view.state)) view.dispatch({ effects: refreshEffect.of(null) }); }); return false; },
				blur(_event, view) { queueMicrotask(() => { if (!owner.stopped && owner.views.has(view) && !owner.isComposing(view.state)) view.dispatch({ effects: refreshEffect.of(null) }); }); return false; },
				compositionstart(_event, view) { owner.composing.add(view); return false; },
				compositionend(_event, view) {
					owner.composing.delete(view);
					// CodeMirror finishes its composition transaction before the next task.
					window.setTimeout(() => { if (!owner.stopped && owner.views.has(view)) view.dispatch({ effects: refreshEffect.of(null) }); }, 0);
					return false;
				},
			} }),
		];
	}
	private allowed(state: EditorState, focusState = state): boolean {
		return this.options.eligible(state) && (!this.options.focusOnly || [...this.views].some((v) => v.state === focusState && v.hasFocus));
	}
	isComposing(state: EditorState): boolean {
		return [...this.views].some((v) => v.state === state && (v.composing || this.composing.has(v)));
	}
	refresh(): void {
		for (const view of this.views) if (!this.isComposing(view.state)) view.dispatch({ effects: refreshEffect.of(null) });
	}
	stop(): void {
		this.stopped = true;
		for (const view of this.views) { const spec = cleanupSpec(view.state); if (spec) view.dispatch(spec); }
	}
	/** Text without this instance's temporary characters. Used by the local panel. */
	cleanText(view: EditorView): string { return cleanSource(view.state); }
}
function owned(state: EditorState): readonly OwnedChar[] { return state.field(ownedField, false) ?? []; }
function cleanSource(state: EditorState): string {
	const positions = new Set(owned(state).map((c) => c.pos));
	return state.doc.toString().split('').filter((_c, i) => !positions.has(i)).join('');
}
