// Pure tap logic. No DOM, no Obsidian. Golden vectors: packages/spec/vectors/reading-tap-guard.json.

/** What a double tap in Reading view does. */
export type TapAction = 'nothing' | 'select-word' | 'edit';

/** Obsidian core values (KILLGATE.md part b): 2 taps within 500 ms and 30 px; a press of 500 ms or more is not a tap. */
export const CORE_INTERVAL_MS = 500;
export const MAX_DISTANCE_PX = 30;
export const MAX_PRESS_MS = 500;
/** The lowest interval that the Pro setting accepts. */
export const MIN_INTERVAL_MS = 150;

/** One finished touch press: times in ms, position of the release in px, distance moved while down, and whether it was on a control. */
export interface Tap {
	down: number;
	up: number;
	x: number;
	y: number;
	moved: number;
	control: boolean;
}

/** The last counted tap, or null when no tap waits for a second one. */
export interface TapState {
	up: number;
	x: number;
	y: number;
}

export interface TapStep {
	state: TapState | null;
	double: boolean;
}

/** Adds one tap (rule 5 of the spec). A double tap clears the state, so a third tap starts a new pair. */
export function nextTap(state: TapState | null, tap: Tap, interval: number): TapStep {
	if (tap.control) return { state: null, double: false };
	if (tap.up - tap.down > MAX_PRESS_MS || tap.moved >= MAX_DISTANCE_PX) return { state: null, double: false };
	if (state && tap.up - state.up < interval && Math.hypot(tap.x - state.x, tap.y - state.y) < MAX_DISTANCE_PX) {
		return { state: null, double: true };
	}
	return { state: { up: tap.up, x: tap.x, y: tap.y }, double: false };
}

/** Feeds the taps in order and gives the index of each tap that completes a double tap. */
export function doubleTaps(taps: Tap[], interval: number): number[] {
	const out: number[] = [];
	let state: TapState | null = null;
	for (let i = 0; i < taps.length; i++) {
		const step = nextTap(state, taps[i]!, interval);
		state = step.state;
		if (step.double) out.push(i);
	}
	return out;
}

/** Keeps a saved interval in the allowed range. A bad value gives the core value. */
export function clampInterval(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return CORE_INTERVAL_MS;
	return Math.min(CORE_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value)));
}

export interface Effective {
	action: TapAction;
	/** The interval that the plugin's own detector uses. */
	interval: number;
	/** True: cancel each touch pointerup in Reading view, so that core counts no tap. */
	blockCore: boolean;
	/** True: the plugin runs its own detector and acts on a double tap. */
	detect: boolean;
}

/** The behavior in effect (rules 1, 2, 7 and 8). Without Pro the interval is the core value. */
export function effective(action: TapAction, interval: number, pro: boolean): Effective {
	const ms = pro ? clampInterval(interval) : CORE_INTERVAL_MS;
	const custom = ms < CORE_INTERVAL_MS;
	const blockCore = action !== 'edit' || custom;
	return { action, interval: ms, blockCore, detect: action === 'select-word' || (action === 'edit' && custom) };
}

/** Letters, digits, marks, underscore, and an apostrophe inside a word. */
const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

/**
 * Start and end offsets of the word at offset in text, or null when offset is not in or next to a word.
 * The character at offset wins; if it is not a word character, the character before it is used.
 * An apostrophe between two word characters is part of the word ("don't").
 */
export function wordBounds(text: string, offset: number): [number, number] | null {
	const chars = Array.from(text);
	// Map the UTF-16 offset to a code point index.
	let cp = 0;
	for (let u = 0; cp < chars.length && u + chars[cp]!.length <= offset; cp++) u += chars[cp]!.length;
	const isWord = (i: number): boolean => {
		const c = chars[i];
		if (c === undefined) return false;
		if (WORD_CHAR.test(c)) return true;
		return (c === "'" || c === '’') && WORD_CHAR.test(chars[i - 1] ?? '') && WORD_CHAR.test(chars[i + 1] ?? '');
	};
	const at = isWord(cp) ? cp : isWord(cp - 1) ? cp - 1 : -1;
	if (at < 0) return null;
	let s = at;
	let e = at + 1;
	while (s > 0 && isWord(s - 1)) s--;
	while (e < chars.length && isWord(e)) e++;
	const toUnits = (i: number): number => chars.slice(0, i).join('').length;
	return [toUnits(s), toUnits(e)];
}
