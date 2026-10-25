// DOM side of the guard (rules 2 to 6 of the spec). Listens in the capture phase on each app window.
import { nextTap, wordBounds, type Effective, type TapState } from './taps';

export const READING_SELECTOR = '.markdown-reading-view';
/** A tap on one of these is a single tap on a control. It never counts toward a double tap (rule 5). */
export const CONTROL_SELECTOR = [
	'a',
	'button',
	'input',
	'select',
	'textarea',
	'label',
	'summary',
	'[role="button"]',
	'[contenteditable="true"]',
	'.clickable-icon',
	'.internal-link',
	'.external-link',
	'.tag',
	'.task-list-item-checkbox',
	'.collapse-indicator',
	'.callout-fold',
	'.copy-code-button',
	'.markdown-embed-link',
].join(', ');

interface Press {
	down: number;
	x: number;
	y: number;
	moved: number;
	reading: HTMLElement;
	control: boolean;
}

/** Element at or above the event target, or null when the target is not an element. */
function elementOf(target: EventTarget | null): Element | null {
	const node = target as Node | null;
	if (!node || typeof node.nodeType !== 'number') return null;
	return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

export class TapGuard {
	private presses = new Map<number, Press>();
	private state: TapState | null = null;

	constructor(
		private readonly current: () => Effective,
		private readonly onDouble: (reading: HTMLElement, x: number, y: number, win: Window) => void,
	) {}

	/** Adds the capture listeners to one window. `add` registers them so that they detach on unload. */
	attach(win: Window, add: (win: Window, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', cb: (e: PointerEvent) => void, opts: AddEventListenerOptions) => void): void {
		add(win, 'pointerdown', (e) => this.down(e), { capture: true, passive: true });
		add(win, 'pointermove', (e) => this.move(e), { capture: true, passive: true });
		// Not passive: this listener calls preventDefault(). pointerup has no default action, so no scroll waits on it.
		add(win, 'pointerup', (e) => this.up(e, win), { capture: true });
		add(win, 'pointercancel', (e) => this.cancel(e), { capture: true, passive: true });
	}

	/** Drops all presses and the tap count (settings change, unload). */
	reset(): void {
		this.presses.clear();
		this.state = null;
	}

	private down(e: PointerEvent): void {
		if (e.pointerType !== 'touch') return;
		const el = elementOf(e.target);
		const reading = el?.closest<HTMLElement>(READING_SELECTOR) ?? null;
		if (!el || !reading) {
			this.presses.delete(e.pointerId);
			return;
		}
		this.presses.set(e.pointerId, { down: e.timeStamp, x: e.clientX, y: e.clientY, moved: 0, reading, control: el.closest(CONTROL_SELECTOR) !== null });
	}

	private move(e: PointerEvent): void {
		const p = e.pointerType === 'touch' ? this.presses.get(e.pointerId) : undefined;
		if (p) p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.x, e.clientY - p.y));
	}

	private cancel(e: PointerEvent): void {
		if (e.pointerType !== 'touch') return;
		// The browser took the touch for a scroll or a zoom: no tap, and the count starts again.
		this.presses.delete(e.pointerId);
		this.state = null;
	}

	private up(e: PointerEvent, win: Window): void {
		if (e.pointerType !== 'touch') return;
		const el = elementOf(e.target);
		const reading = el?.closest<HTMLElement>(READING_SELECTOR) ?? null;
		const press = this.presses.get(e.pointerId);
		this.presses.delete(e.pointerId);
		if (!reading) return;
		const eff = this.current();
		// Rule 2: core drops a tap whose pointerup has defaultPrevented, so it never sees a double tap.
		if (eff.blockCore) e.preventDefault();
		if (!eff.detect) {
			this.state = null;
			return;
		}
		const moved = press ? Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y)) : 0;
		const tap = { down: press?.down ?? e.timeStamp, up: e.timeStamp, x: e.clientX, y: e.clientY, moved, control: !press || press.control || press.reading !== reading };
		const step = nextTap(this.state, tap, eff.interval);
		this.state = step.state;
		if (step.double) this.onDouble(reading, e.clientX, e.clientY, win);
	}
}

/** Caret position at a point: the text node and the offset in it, or null. */
function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
	// caretPositionFromPoint: Chromium 128 and later, Firefox. caretRangeFromPoint: older Chromium and WebKit (iOS).
	const fns = doc as unknown as Record<string, unknown>;
	const byPosition = fns['caretPositionFromPoint'];
	if (typeof byPosition === 'function') {
		const pos = (byPosition as (x: number, y: number) => { offsetNode: Node; offset: number } | null).call(doc, x, y);
		if (pos) return { node: pos.offsetNode, offset: pos.offset };
	}
	const byRange = fns['caretRangeFromPoint'];
	if (typeof byRange === 'function') {
		const range = (byRange as (x: number, y: number) => Range | null).call(doc, x, y);
		if (range) return { node: range.startContainer, offset: range.startOffset };
	}
	return null;
}

/** Selects the word under the point inside reading. Returns the selected text, or "" when no word is there. */
export function selectWordAt(reading: HTMLElement, x: number, y: number): string {
	const doc = reading.ownerDocument;
	const caret = caretAt(doc, x, y);
	if (!caret || caret.node.nodeType !== 3 || !reading.contains(caret.node)) return '';
	const text = caret.node.nodeValue ?? '';
	const bounds = wordBounds(text, caret.offset);
	const sel = doc.getSelection();
	if (!bounds || !sel) return '';
	const range = doc.createRange();
	range.setStart(caret.node, bounds[0]);
	range.setEnd(caret.node, bounds[1]);
	sel.removeAllRanges();
	sel.addRange(range);
	return text.slice(bounds[0], bounds[1]);
}
