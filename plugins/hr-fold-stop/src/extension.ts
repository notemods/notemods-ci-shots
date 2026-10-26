import { EditorState, Prec, StateField, type ChangeSet, type Extension, type Text } from '@codemirror/state';
import type { ChangedRange } from '@lezer/common';
import { foldService, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { foldStopLine, parseTopLevel, type TopLevelParse } from './boundaries';
import { effectiveRuleForPath, type EffectiveRule } from './rules';

export interface FoldStopConfig {
	enabled: boolean;
	/** Stop folds at `%% fold-stop %%` end markers. */
	endMarkers: boolean;
	rule: EffectiveRule;
	noteOverride?: boolean;
}

export function notePathOf(state: EditorState): string {
	return state.field(editorInfoField, false)?.file?.path ?? '';
}

/** Reparse after an edit. Lezer reuses the unchanged parts of the last parse. */
function reparse(prev: TopLevelParse, doc: Text, changes: ChangeSet): TopLevelParse {
	const ranges: ChangedRange[] = [];
	changes.iterChangedRanges((fromA, toA, fromB, toB) => { ranges.push({ fromA, toA, fromB, toB }); });
	return parseTopLevel(doc.toString(), prev, ranges, pos => changes.mapPos(pos, -1));
}

const scanField = StateField.define<TopLevelParse>({
	create: state => parseTopLevel(state.doc.toString()),
	update: (value, tr) => tr.docChanged ? reparse(value, tr.newDoc, tr.changes) : value,
});

/** Public CodeMirror effects expand old ranges when a rule changes. */
export function expandFolds(view: EditorView): void {
	const effects = [];
	for (let cursor = foldedRanges(view.state).iter(); cursor.value; cursor.next()) {
		effects.push(unfoldEffect.of({ from: cursor.from, to: cursor.to }));
	}
	if (effects.length) view.dispatch({ effects });
}

export function foldStopExtension(getConfig: (path: string) => FoldStopConfig, views?: Set<EditorView>): Extension {
	const service = foldService.of((state, lineStart, lineEnd) => {
		const path = notePathOf(state);
		const config = getConfig(path);
		if (!config.enabled || !effectiveRuleForPath(config.rule, path, config.noteOverride).active) return null;
		const scan = state.field(scanField).scan;
		const headingIndex = state.doc.lineAt(lineStart).number - 1;
		const heading = scan[headingIndex]!;
		if (heading.kind !== 'heading') return null;
		const stop = foldStopLine(scan, headingIndex, heading.level, config.endMarkers);
		if (stop === null) return null;
		// Start on the heading line, so native controls find and unfold the range.
		// Keep the newline before the boundary outside the range.
		const to = state.doc.line(stop + 1).from - 1;
		return to > lineEnd ? { from: lineEnd, to } : null;
	});
	const tracker = ViewPlugin.define(view => {
		views?.add(view);
		return { destroy: () => { views?.delete(view); } };
	});
	// Stock folding can propose a range when the rule or end marker is directly under the heading.
	// Clip such effects through the public API; keep the note changes and selection.
	const clamp = EditorState.transactionFilter.of(tr => {
		// Most transactions are typing or selection. Return them before any rule or parse work.
		if (!tr.effects.some(effect => effect.is(foldEffect))) return tr;
		const config = getConfig(notePathOf(tr.startState));
		if (!config.enabled || !effectiveRuleForPath(config.rule, notePathOf(tr.startState), config.noteOverride).active) return tr;
		const start = tr.startState.field(scanField);
		const scan = tr.docChanged ? reparse(start, tr.newDoc, tr.changes).scan : start.scan;
		let changed = false;
		const effects = tr.effects.flatMap(effect => {
			if (!effect.is(foldEffect)) return [effect];
			const line = tr.newDoc.lineAt(effect.value.from);
			const heading = scan[line.number - 1]!;
			if (heading.kind !== 'heading') return [effect];
			const stop = foldStopLine(scan, heading.i, heading.level, config.endMarkers);
			if (stop === null) return [effect];
			const to = tr.newDoc.line(stop + 1).from - 1;
			if (effect.value.to <= to) return [effect];
			changed = true;
			return to > line.to ? [foldEffect.of({ from: line.to, to })] : [];
		});
		return changed ? { ...tr, effects } : tr;
	});
	return [scanField, Prec.highest(service), tracker, clamp];
}
