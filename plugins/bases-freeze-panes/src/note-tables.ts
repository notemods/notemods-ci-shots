/** Freeze rendered note tables without a change to the note or its cells. */
export interface NoteTableScope {
	root: HTMLElement;
	header: boolean;
	column: boolean;
	height: number;
}

const TABLES = '.markdown-rendered table, .cm-table-widget table, .block-language-dataview table, .block-language-dataviewjs table';

class NoteTableRoot {
	private observer: MutationObserver;
	/** True for a box we made; false for an existing Obsidian table wrapper. */
	private boxes = new Map<HTMLElement, boolean>();
	private queued = false;
	private active = true;

	constructor(private scope: NoteTableScope) {
		// Use the window of this tab, including a tab in a separate window.
		const Observer = scope.root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		this.observer = new Observer((records) => {
			// Cell edits and Bases row updates need no new boxes.
			const changedTable = records.some((record) => [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some((node) => {
				if (node.nodeType !== 1) return false;
				const el = node as Element;
				return el.tagName === 'TABLE' || el.querySelector('table') !== null;
			}));
			if (!changedTable) return;
			if (this.queued) return;
			this.queued = true;
			queueMicrotask(() => {
				this.queued = false;
				if (this.active) this.apply();
			});
		});
		this.apply();
	}

	update(scope: NoteTableScope): void {
		this.scope = scope;
		this.apply();
	}

	private apply(): void {
		this.observer.disconnect();
		const { root, header, column, height } = this.scope;
		for (const [box, owned] of this.boxes) {
			if (!root.contains(box) || !box.querySelector('table')) {
				this.release(box, owned);
				this.boxes.delete(box);
			}
		}
		for (const table of Array.from(root.querySelectorAll<HTMLTableElement>(TABLES))) {
			// Do not change nested tables or HTML tables inside a Bases cell.
			if (table.parentElement?.closest('table, .bases-view')) continue;
			let box = table.parentElement;
			if (!box || !this.boxes.has(box)) {
				// Keep the direct table child used by the live preview editor and its CSS.
				if (box?.hasClass('table-wrapper') && Array.from(box.children).filter((el) => el.tagName === 'TABLE').length === 1) {
					box.addClass('bfp-note-table');
					this.boxes.set(box, false);
				} else {
					box = root.createDiv('bfp-note-table');
					table.before(box);
					box.appendChild(table);
					this.boxes.set(box, true);
				}
			}
			box.toggleClass('bfp-note-header', header);
			box.toggleClass('bfp-note-column', column);
			box.setCssProps({ '--bfp-note-height': `${height}px` });
		}
		this.observer.observe(root, { childList: true, subtree: true });
	}

	private release(box: HTMLElement, owned: boolean): void {
		if (owned) {
			// Move the original nodes back. Links, input values and cell listeners stay intact.
			box.replaceWith(...Array.from(box.childNodes));
		} else {
			box.removeClass('bfp-note-table', 'bfp-note-header', 'bfp-note-column');
			box.style.removeProperty('--bfp-note-height');
		}
	}

	clear(): void {
		this.active = false;
		this.observer.disconnect();
		for (const [box, owned] of this.boxes) this.release(box, owned);
		this.boxes.clear();
	}
}

export class NoteTables {
	private roots = new Map<HTMLElement, NoteTableRoot>();

	sync(scopes: NoteTableScope[]): void {
		const current = new Set(scopes.map((scope) => scope.root));
		for (const [root, tables] of this.roots) {
			if (!current.has(root)) {
				tables.clear();
				this.roots.delete(root);
			}
		}
		for (const scope of scopes) {
			const tables = this.roots.get(scope.root);
			if (tables) tables.update(scope);
			else this.roots.set(scope.root, new NoteTableRoot(scope));
		}
	}

	clear(): void {
		for (const tables of this.roots.values()) tables.clear();
		this.roots.clear();
	}
}
