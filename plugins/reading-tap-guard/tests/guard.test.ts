import { afterEach, describe, expect, it } from 'vitest';
import { TapGuard, selectWordAt } from '../src/guard';
import { effective, type TapAction } from '../src/taps';

// DOM tests of rules 2 to 5 with synthetic touch PointerEvents (happy-dom).
function setup(action: TapAction, interval = 500, pro = false) {
	document.body.innerHTML = '<div class="workspace-leaf"><div class="markdown-reading-view"><p id="p">Hello quick world</p><a id="a" class="internal-link">Link</a></div></div><div id="out">Outside</div>';
	const doubles: number[] = [];
	const guard = new TapGuard(
		() => effective(action, interval, pro),
		(_r, x) => doubles.push(x),
	);
	const offs: (() => void)[] = [];
	guard.attach(window, (win, type, cb, opts) => {
		win.addEventListener(type, cb as EventListener, opts);
		offs.push(() => win.removeEventListener(type, cb as EventListener, opts));
	});
	// A second attach to the same window adds nothing (rule 11, popouts open at load).
	expect(guard.attach(window, () => undefined)).toBe(false);
	return { guard, doubles, off: () => offs.forEach((f) => f()) };
}

let cleanup: (() => void) | null = null;
afterEach(() => cleanup?.());

/** Sends one touch tap and gives the pointerup event. */
function tap(id: string, x = 10, type = 'touch', pointerId = 1): PointerEvent {
	const el = document.getElementById(id)!;
	const init = { pointerType: type, pointerId, button: 0, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: 10 };
	el.dispatchEvent(new PointerEvent('pointerdown', init));
	const up = new PointerEvent('pointerup', init);
	el.dispatchEvent(up);
	return up;
}

describe('TapGuard', () => {
	it('cancels each touch pointerup in Reading view by default (rule 2)', () => {
		const s = setup('nothing');
		cleanup = s.off;
		expect(tap('p').defaultPrevented).toBe(true);
		expect(tap('a').defaultPrevented).toBe(true);
		expect(s.doubles).toEqual([]);
	});
	it('leaves mouse and pen pointerup alone (rule 4)', () => {
		const s = setup('nothing');
		cleanup = s.off;
		expect(tap('p', 10, 'mouse').defaultPrevented).toBe(false);
		expect(tap('p', 10, 'pen').defaultPrevented).toBe(false);
	});
	it('leaves a touch outside Reading view alone', () => {
		const s = setup('nothing');
		cleanup = s.off;
		expect(tap('out').defaultPrevented).toBe(false);
	});
	it('does not cancel anything with Switch to editing (rule 7)', () => {
		const s = setup('edit');
		cleanup = s.off;
		expect(tap('p').defaultPrevented).toBe(false);
		tap('p');
		expect(s.doubles).toEqual([]);
	});
	it('finds a double tap for Select the word (rule 6)', () => {
		const s = setup('select-word');
		cleanup = s.off;
		tap('p', 10);
		expect(tap('p', 12).defaultPrevented).toBe(true);
		expect(s.doubles).toEqual([12]);
	});
	it('does not count a tap on a link (rule 5)', () => {
		const s = setup('select-word');
		cleanup = s.off;
		tap('a');
		tap('a');
		expect(s.doubles).toEqual([]);
	});
	it('a pointercancel clears the count', () => {
		const s = setup('select-word');
		cleanup = s.off;
		tap('p');
		document.getElementById('p')!.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch', pointerId: 1, bubbles: true }));
		tap('p');
		expect(s.doubles).toEqual([]);
	});
	it('with Pro interval, Switch to editing cancels core and detects (rule 8)', () => {
		const s = setup('edit', 250, true);
		cleanup = s.off;
		tap('p');
		expect(tap('p').defaultPrevented).toBe(true);
		expect(s.doubles.length).toBe(1);
	});
	it('stops after the listeners are removed (rule 11)', () => {
		const s = setup('nothing');
		s.off();
		expect(tap('p').defaultPrevented).toBe(false);
	});
});

/** A tap that the browser cancels for a scroll: pointerdown, pointercancel, then touchend. Gives the focusout count. */
function cancelledTap(): number {
	const el = document.getElementById('p')!;
	const reading = document.querySelector('.markdown-reading-view')!;
	let focusouts = 0;
	const onOut = (e: Event): void => {
		focusouts++;
		expect(e.bubbles).toBe(false);
	};
	reading.addEventListener('focusout', onOut);
	const init = { pointerType: 'touch', pointerId: 9, button: 0, bubbles: true, cancelable: true, clientX: 10, clientY: 10 };
	el.dispatchEvent(new PointerEvent('pointerdown', init));
	el.dispatchEvent(new PointerEvent('pointercancel', init));
	el.dispatchEvent(new Event('touchend', { bubbles: true }));
	el.dispatchEvent(new Event('touchend', { bubbles: true }));
	reading.removeEventListener('focusout', onOut);
	return focusouts;
}

describe('scroll-cancelled tap (rule 12)', () => {
	it('sends one focusout to the Reading view after the touchend', () => {
		const s = setup('nothing');
		cleanup = s.off;
		expect(cancelledTap()).toBe(1);
	});
	it('sends nothing with Switch to editing', () => {
		const s = setup('edit');
		cleanup = s.off;
		expect(cancelledTap()).toBe(0);
	});
	it('sends nothing for a normal tap', () => {
		const s = setup('nothing');
		cleanup = s.off;
		let n = 0;
		const reading = document.querySelector('.markdown-reading-view')!;
		reading.addEventListener('focusout', () => n++);
		tap('p');
		document.getElementById('p')!.dispatchEvent(new Event('touchend', { bubbles: true }));
		expect(n).toBe(0);
	});
});

describe('selectWordAt', () => {
	it('returns "" when no caret is found', () => {
		document.body.innerHTML = '<div class="markdown-reading-view"><p>Hi</p></div>';
		expect(selectWordAt(document.querySelector('.markdown-reading-view')!, 1, 1)).toBe('');
	});
});
