// Follows the reader's place in the open note: a throttled scroll listener and a reader of the visible top.
// The choice of the row is pure logic in src/outline.ts (placeChain, visibleRow).
import type { MarkdownView } from 'obsidian';
import { PLACE_SLACK_PX, type PlacedHeading, type ViewPlace } from './outline';

/** Shortest time between two updates during a scroll. */
export const FOLLOW_MS = 100;

/** Events that show the reader moves in the note: a wheel, a touch, a key or a pointer press. */
const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Calls `update` at most once each `ms` while an element, or anything inside it, scrolls.
 * Calls `onUser` when the reader uses the wheel, touch, keys or the pointer in the element.
 */
export class ScrollFollower {
	private el: HTMLElement | null = null;
	private timer: number | null = null;
	private readonly onScroll = (): void => {
		if (this.timer !== null) return;
		this.timer = window.setTimeout(() => {
			this.timer = null;
			if (this.el) this.update();
		}, this.ms);
	};

	private readonly onUserEvent = (): void => this.onUser();

	constructor(
		private readonly update: () => void,
		private readonly ms = FOLLOW_MS,
		private readonly onUser: () => void = () => undefined,
	) {}

	/** Listens to scrolls in this element only. Null stops the listener. */
	watch(el: HTMLElement | null): void {
		if (el === this.el) return;
		this.stop();
		if (!el) return;
		this.el = el;
		// Scroll events do not bubble: the capture phase also gets the scrolls of the editor and the reading view.
		el.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
		for (const type of USER_EVENTS) el.addEventListener(type, this.onUserEvent, { capture: true, passive: true });
	}

	stop(): void {
		this.el?.removeEventListener('scroll', this.onScroll, { capture: true });
		for (const type of USER_EVENTS) this.el?.removeEventListener(type, this.onUserEvent, { capture: true });
		this.el = null;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}

	/** True while a scroll listener is registered. */
	get listening(): boolean {
		return this.el !== null;
	}
}

/** The element that scrolls in the current mode of a note view: the reading view or the editor. */
function scroller(view: MarkdownView): HTMLElement {
	const preview = view.getMode() === 'preview';
	const root = preview ? view.previewMode.containerEl : view.contentEl.querySelector<HTMLElement>('.markdown-source-view');
	const sel = preview ? '.markdown-preview-view' : '.cm-scroller';
	if (!root) return view.contentEl;
	return root.matches(sel) ? root : (root.querySelector<HTMLElement>(sel) ?? root);
}

/** Reads where the top of the visible area of a note view is: a line of the note, or a place inside a top-level embed. */
export function readPlace(view: MarkdownView): ViewPlace {
	const line = Math.max(0, Math.floor(view.currentMode.getScroll() || 0));
	const box = scroller(view);
	const top = box.getBoundingClientRect().top + PLACE_SLACK_PX;
	for (const el of Array.from(box.querySelectorAll<HTMLElement>('.markdown-embed'))) {
		if (el.parentElement?.closest('.markdown-embed')) continue;
		const r = el.getBoundingClientRect();
		if (r.height === 0 || r.top > top || r.bottom <= top) continue;
		const headings: PlacedHeading[] = Array.from(el.querySelectorAll<HTMLElement>('[data-heading]')).map((h) => ({
			text: h.getAttribute('data-heading') ?? '',
			top: h.getBoundingClientRect().top - (top - PLACE_SLACK_PX),
		}));
		const link = el.getAttribute('src');
		return link === null ? { kind: 'embed', line, headings } : { kind: 'embed', line, link, headings };
	}
	return { kind: 'line', line };
}
