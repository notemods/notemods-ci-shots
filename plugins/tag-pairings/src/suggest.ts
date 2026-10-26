import { EditorSuggest, getAllTags, type App, type Editor, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo, type TFile } from 'obsidian';
import { inBlockContext, lineTags, triggerOnLine, type PairIndex, type Pairing } from './pairs';
import type { Effective } from './settings';

/** Internal list of a popover suggest. Core uses it for its own Shift+Enter keys; it is not in obsidian.d.ts. */
interface SuggestList {
	useSelectedItem(evt: KeyboardEvent): boolean;
}

/**
 * The suggestion box. It opens when the text before the cursor ends with "#tag" and one space, and lists the tags
 * that occur with that tag in the vault. A pick inserts "#other " and the box opens again for the new tag.
 */
export class PairSuggest extends EditorSuggest<Pairing> {
	private anchor = '';

	constructor(
		app: App,
		private readonly index: () => PairIndex | null,
		private readonly options: () => Effective,
	) {
		super(app);
		this.setInstructions([
			{ command: '↑↓', purpose: 'to move' },
			{ command: '↵', purpose: 'to add the tag' },
			{ command: 'shift ↵', purpose: 'to add the tag' },
			{ command: 'esc', purpose: 'to dismiss' },
		]);
		// Post 1 of topic 580 asks for Shift+Enter. The base class handles Enter only.
		this.scope.register(['Shift'], 'Enter', (evt) => {
			if (evt.isComposing) return;
			const list = (this as unknown as { suggestions?: SuggestList }).suggestions;
			if (list && typeof list.useSelectedItem === 'function') {
				list.useSelectedItem(evt);
				return false;
			}
			return;
		});
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file) return null;
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const t = triggerOnLine(before);
		if (!t) return null;
		if (inBlockContext((i) => editor.getLine(i), cursor.line)) return null;
		const index = this.index();
		if (!index || index.size === 0) return null;
		this.anchor = t.anchor;
		return { start: cursor, end: cursor, query: t.anchor };
	}

	getSuggestions(context: EditorSuggestContext): Pairing[] {
		const index = this.index();
		if (!index) return [];
		const opts = this.options();
		const exclude = new Set<string>(lineTags(context.editor.getLine(context.start.line)));
		const cache = this.app.metadataCache.getFileCache(context.file);
		for (const t of (cache ? getAllTags(cache) : null) ?? []) exclude.add(t);
		const linked = Object.keys(this.app.metadataCache.resolvedLinks[context.file.path] ?? {});
		const folder = context.file.parent?.path ?? '';
		const scope = opts.folderScope && folder !== '' && folder !== '/' ? (p: string) => p.startsWith(folder + '/') : null;
		return index.rank(context.query, { exclude, linked, limit: opts.limit, scope });
	}

	renderSuggestion(value: Pairing, el: HTMLElement): void {
		el.addClass('tag-pairings-item');
		el.createSpan({ cls: 'tag-pairings-tag', text: '#' + value.display });
		if (this.options().showCounts) el.createSpan({ cls: 'tag-pairings-count', text: String(value.count) });
	}

	selectSuggestion(value: Pairing, _evt: MouseEvent | KeyboardEvent): void {
		const ctx = this.context;
		if (!ctx) return;
		const { editor, start } = ctx;
		this.close();
		const text = '#' + value.display + ' ';
		const at = { line: start.line, ch: start.ch };
		editor.transaction({ changes: [{ from: at, to: at, text }], selection: { from: { line: at.line, ch: at.ch + text.length } } });
	}

	/** The anchor of the last trigger, for tests. */
	get lastAnchor(): string {
		return this.anchor;
	}
}
