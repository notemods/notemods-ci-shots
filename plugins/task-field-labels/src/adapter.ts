import { MarkdownRenderChild } from 'obsidian';
import { FIELDS, fieldLabel, type Field } from './fields';
import type { Display } from './options';

interface Owned { original: string; written: string; outer: HTMLElement; compactAdded: boolean }
const SELECTOR = FIELDS.map((f) => 'span.task-' + f).join(',');

/** A scoped observer keeps the Tasks elements and their event handlers in place. */
export class FieldAdapter {
	private readonly owned = new Map<Text, Owned>();
	private readonly observer: MutationObserver;
	private running = false;
	private disposed = false;
	constructor(readonly root: HTMLElement, private readonly options: () => Display | null) {
		const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		this.observer = new Observer(() => this.scan());
	}
	get count(): number { return this.owned.size; }
	get observing(): boolean { return this.running; }
	refresh(): void {
		if (this.disposed) return;
		this.stop();
		this.restore();
		if (this.options()) {
			this.scan();
			this.observer.observe(this.root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
			this.running = true;
		}
	}
	private stop(): void { this.observer.disconnect(); this.running = false; }
	scan(): void {
		if (this.disposed) return;
		const opts = this.options();
		if (!opts) { this.stop(); this.restore(); return; }
		for (const [node, entry] of this.owned) {
			if (!this.root.contains(node) || node.data !== entry.written) {
				this.release(node, entry);
				this.owned.delete(node);
			}
		}
		for (const outer of Array.from(this.root.querySelectorAll<HTMLElement>(SELECTOR))) {
			const row = outer.closest('li.plugin-tasks-list-item');
			// The Tasks 8.5.0 renderer makes a direct inner span with one text node.
			// Description children, short mode, arbitrary HTML, and future structures are left alone.
			if (!row || outer.closest('.task-description, .tasks-layout-short-mode') || outer.children.length !== 1 || outer.childNodes.length !== 1) continue;
			const inner = outer.firstElementChild;
			if (inner?.tagName !== 'SPAN' || inner.childNodes.length !== 1 || inner.firstChild?.nodeType !== 3) continue;
			const node = inner.firstChild as Text;
			if (this.owned.has(node)) continue;
			const fields = FIELDS.filter((f) => outer.classList.contains('task-' + f));
			if (fields.length !== 1) continue;
			const next = fieldLabel(fields[0] as Field, node.data, opts.labels);
			if (next === null) continue;
			const entry: Owned = { original: node.data, written: next, outer, compactAdded: opts.compact && !outer.classList.contains('task-field-labels-compact') };
			this.owned.set(node, entry);
			node.data = next;
			if (entry.compactAdded) outer.classList.add('task-field-labels-compact');
		}
	}
	private release(node: Text, entry: Owned): void {
		if (node.data === entry.written) node.data = entry.original;
		if (entry.compactAdded) entry.outer.classList.remove('task-field-labels-compact');
	}
	private restore(): void { for (const [node, entry] of this.owned) this.release(node, entry); this.owned.clear(); }
	dispose(): void { this.stop(); this.restore(); this.disposed = true; }
}

export class LabelsRenderChild extends MarkdownRenderChild {
	readonly adapter: FieldAdapter;
	constructor(root: HTMLElement, options: () => Display | null, private readonly done: () => void) {
		super(root);
		this.adapter = new FieldAdapter(root, options);
	}
	onload(): void { this.adapter.refresh(); this.register(() => { this.adapter.dispose(); this.done(); }); }
}
