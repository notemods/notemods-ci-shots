// CodeMirror 6 part: a keymap at Prec.high for Enter and Shift+Enter. It reads the Markdown context from the
// syntax tree and from the note text (enter.ts), never from the rendered DOM. When a check fails, the handler
// returns false and the Obsidian default runs (list continuation, code indent, suggestion popups).
import { Prec, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { enterAction, type EnterKey, type EnterResult, type LineBreakStyle } from './enter';

export interface EnterHost {
	enabled(): boolean;
	lineBreakStyle(): LineBreakStyle;
}

/**
 * Token names of the Obsidian Markdown parser that mark a block where Enter keeps its default.
 * A node name joins its tokens with "_" (for example "formatting_formatting-list_list-1").
 */
const BLOCK_TOKEN = /^(hmd-codeblock|formatting-code-block|hmd-frontmatter|math-block|formatting-math-begin|hmd-table-sep|hmd-html-begin|hmd-callout|hmd-footnote|formatting-list|formatting-task|formatting-quote|formatting-header|(quote|header|list)(-\d+)?)$/;
const CURSOR_TOKEN = /^(comment|hmd-codeblock|math-block|hmd-frontmatter)$/;

function tokens(name: string): string[] { return name.split(/[_ ]/); }

function hasToken(state: EditorState, pos: number, side: -1 | 1, test: RegExp, tree = syntaxTree(state)): boolean {
	for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); node; node = node.parent) {
		if (tokens(node.type.name).some((t) => test.test(t))) return true;
	}
	return false;
}

/**
 * False when the syntax tree marks the cursor line as a list, quote, heading, table, code, math, front matter,
 * callout or comment. When the parser has not reached the line yet, the text check in enter.ts decides alone.
 */
export function treeAllowsParagraph(state: EditorState, pos: number): boolean {
	const line = state.doc.lineAt(pos);
	const tree = ensureSyntaxTree(state, line.to, 50) ?? syntaxTree(state);
	if (tree.length < line.to) return true;
	if (hasToken(state, line.from, 1, BLOCK_TOKEN, tree)) return false;
	if (pos > line.from && hasToken(state, pos, -1, CURSOR_TOKEN, tree)) return false;
	if (pos < line.to && hasToken(state, pos, 1, CURSOR_TOKEN, tree)) return false;
	return true;
}

/** Vim adds cm-vimMode to the scroller in normal, visual and replace mode, and removes it in insert mode. */
export function vimBlocks(view: EditorView): boolean {
	return view.scrollDOM.classList.contains('cm-vimMode') || view.dom.classList.contains('cm-vimMode');
}

/** An open editor suggestion (links, tags, slash commands, other plugins) owns Enter. */
export function suggestionOpen(view: EditorView): boolean {
	const doc = view.dom.ownerDocument;
	return Array.from(doc.querySelectorAll('.suggestion-container')).some((el) => el.isConnected && el.getClientRects().length > 0);
}

/** The edit for one key press, or "default". Exported for tests. */
export function planKey(state: EditorState, key: EnterKey, host: EnterHost): EnterResult {
	if (!host.enabled()) return 'default';
	const ranges = state.selection.ranges;
	if (ranges.length !== 1 || !ranges[0]!.empty) return 'default';
	const pos = ranges[0]!.head;
	if (!treeAllowsParagraph(state, pos)) return 'default';
	return enterAction(state.doc.toString(), pos, { enabled: true, lineBreakStyle: host.lineBreakStyle(), key });
}

/** The transaction of a plan. One Enter is one undo step: it never merges with the typing before or after it. */
export function planSpec(plan: Exclude<EnterResult, 'default'>): TransactionSpec {
	return {
		changes: plan.changes,
		selection: { anchor: plan.cursor },
		scrollIntoView: true,
		userEvent: plan.changes.length ? 'input' : 'select',
		annotations: plan.changes.length ? isolateHistory.of('full') : [],
	};
}

/** Applies a plan. Returns false for "default", so the next keymap (the Obsidian default) runs. */
export function applyPlan(view: EditorView, plan: EnterResult): boolean {
	if (plan === 'default') return false;
	view.dispatch(planSpec(plan));
	return true;
}

export function paragraphEnterExtension(host: EnterHost): Extension {
	let composingKey = false;
	const run = (key: EnterKey) => (view: EditorView): boolean => {
		if (composingKey || view.composing || view.compositionStarted) return false;
		if (vimBlocks(view) || suggestionOpen(view)) return false;
		return applyPlan(view, planKey(view.state, key, host));
	};
	return [
		// Runs before every keymap. It records whether this key event belongs to an IME composition.
		Prec.highest(EditorView.domEventHandlers({
			keydown(event) { composingKey = event.isComposing || event.key === 'Process'; return false; },
		})),
		Prec.high(keymap.of([
			{ key: 'Enter', run: run('Enter') },
			{ key: 'Shift-Enter', run: run('Shift-Enter') },
		])),
	];
}
