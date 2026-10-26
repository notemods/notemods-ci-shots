import { DOM } from './selectors';
import type { EditAttempt } from './policy';

/** Resolve the property from a DOM attribute, or the matching table header. Unknown means locked. */
export function propertyOf(target: Element, root: Element): string | undefined {
	const cell = target.closest(DOM.cell);
	if (!cell || !root.contains(cell)) return undefined;
	for (const attr of DOM.propertyAttrs) {
		const el = target.closest(`[${attr}]`);
		if (el && root.contains(el)) return el.getAttribute(attr) ?? undefined;
		const value = cell.getAttribute(attr);
		if (value) return value;
	}
	const row = cell.parentElement;
	if (!row?.matches(DOM.row)) return undefined;
	const index = Array.from(row.children).indexOf(cell);
	const header = root.querySelectorAll(DOM.header)[index];
	if (!header) return undefined;
	for (const attr of DOM.propertyAttrs) {
		const value = header.getAttribute(attr);
		if (value) return value;
	}
	return undefined;
}

export function attemptOf(event: Event, target: Element, root: Element): EditAttempt {
	const popup = target.closest(DOM.popup);
	if (popup) {
		const key = (event as KeyboardEvent).key;
		let zone: EditAttempt['zone'] = 'toolbar';
		const choice = target.closest(DOM.viewChoice);
		if (event.type === 'keydown' && ['Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) zone = 'switch';
		else if (target.closest(DOM.popupClose)) zone = 'switch';
		else if (choice && !target.closest(DOM.popupAction)) {
			zone = ['dragstart', 'drop', 'contextmenu'].includes(event.type) || (target.closest(DOM.popupGrip) && ['pointerdown', 'mousedown', 'touchstart'].includes(event.type)) || ['F2', 'Delete', 'Backspace'].includes(key) ? 'drag' : 'switch';
		} else if (target.closest(DOM.popupSearch)) {
			const selected = popup.querySelector(DOM.selected);
			zone = event.type === 'keydown' && key === 'Enter' && !selected?.matches(DOM.viewChoice) ? 'toolbar' : 'switch';
		}
		return { type: event.type, zone, key, ctrl: (event as KeyboardEvent).ctrlKey, meta: (event as KeyboardEvent).metaKey };
	}
	let zone: EditAttempt['zone'] = 'background';
	if (target.closest(DOM.switch) || target.closest(DOM.search)) zone = 'switch';
	else if (target.closest(DOM.link)) zone = 'link';
	else if (target.closest(DOM.toolbar)) zone = 'toolbar';
	else if (target.closest(DOM.column)) zone = 'drag';
	else if (target.closest(DOM.cell)) zone = 'cell';
	else if (target.closest(DOM.drag)) zone = 'drag';
	else if (target.closest(DOM.view)) zone = 'cell';
	const key = event as KeyboardEvent;
	return { type: event.type, zone, key: key.key, ctrl: key.ctrlKey, meta: key.metaKey, alt: key.altKey, button: (event as MouseEvent).button, property: propertyOf(target, root), stepper: target.matches(DOM.stepper) };
}
