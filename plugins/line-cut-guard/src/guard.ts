// Pure rules of Line Cut Guard. No DOM and no Obsidian imports, so the golden vectors
// (packages/spec/vectors/line-cut-guard.json) test them directly.

export type Kind = 'cut' | 'copy';

/** What a cut or copy with nothing selected does. "allow" = Obsidian default (the whole line). */
export type Mode = 'block' | 'allow' | 'twice';

export const MODES: readonly Mode[] = ['block', 'allow', 'twice'];

/** A second press counts only in this window after the first one (milliseconds). */
export const SECOND_PRESS_MIN_MS = 250;
export const SECOND_PRESS_MAX_MS = 2000;

/** At most one notice of the plugin in this time (milliseconds). */
export const NOTICE_GAP_MS = 2000;

/** The first press that the plugin stopped in "twice" mode. token names the editor and its state at that time. */
export interface Pending {
	kind: Kind;
	token: string;
	time: number;
}

export interface StepInput {
	kind: Kind;
	/** The saved mode for this kind. */
	mode: Mode;
	pro: boolean;
	/** True when no range of the selection has text and nothing else is selected (cells, an image). */
	nothingSelected: boolean;
	/** Same token = same editor and same editor state (no edit and no cursor move since). */
	token: string;
	now: number;
	/** True when the key press that caused the event is a held key (keydown repeat). */
	repeat: boolean;
	pending: Pending | null;
}

export interface StepOutput {
	/** pass = let Obsidian cut or copy; stop = the note and the clipboard do not change. */
	action: 'pass' | 'stop';
	/** The pending first press after this event. */
	pending: Pending | null;
	/** The notice to show, before the rate limit: stopped, press-again or none. */
	message: 'stopped' | 'press-again' | null;
}

/** The mode in effect. "twice" needs Pro; without Pro it acts as "block", so a lapsed Pro never cuts a line by surprise. */
export function effectiveMode(mode: Mode, pro: boolean): Mode {
	if (mode === 'twice' && !pro) return 'block';
	return mode;
}

/**
 * True when Obsidian would cut or copy whole lines: every range is empty (from === to), and no other element is
 * selected (a table cell range or an image, which Obsidian cuts as a selection). No ranges counts as nothing selected.
 */
export function nothingSelected(ranges: ReadonlyArray<readonly [number, number]>, marked: boolean): boolean {
	if (marked) return false;
	return ranges.every(([from, to]) => from === to);
}

/** One cut or copy event. Decides pass or stop, the next pending state and the notice. */
export function step(i: StepInput): StepOutput {
	const mode = effectiveMode(i.mode, i.pro);
	// A selection or the Obsidian default: the plugin does nothing and forgets an old first press.
	if (!i.nothingSelected || mode === 'allow') return { action: 'pass', pending: null, message: null };
	if (mode === 'block') return { action: 'stop', pending: null, message: 'stopped' };
	// mode "twice". A held key repeats the first press: stop it, keep the first press and show nothing new.
	if (i.repeat) return { action: 'stop', pending: i.pending, message: null };
	const p = i.pending;
	if (p && p.kind === i.kind && p.token === i.token) {
		const gap = i.now - p.time;
		if (gap >= SECOND_PRESS_MIN_MS && gap <= SECOND_PRESS_MAX_MS) return { action: 'pass', pending: null, message: null };
	}
	return { action: 'stop', pending: { kind: i.kind, token: i.token, time: i.now }, message: 'press-again' };
}

/** True when a new notice may show: the last one is NOTICE_GAP_MS or more ago. A press-again notice always shows. */
export function mayNotify(lastShown: number | null, now: number, message: 'stopped' | 'press-again'): boolean {
	if (message === 'press-again') return true;
	return lastShown === null || now - lastShown >= NOTICE_GAP_MS;
}

/** The notice text. mod is "Ctrl" or "Cmd". */
export function noticeText(kind: Kind, message: 'stopped' | 'press-again', mod: string): string {
	const key = `${mod}+${kind === 'cut' ? 'X' : 'C'}`;
	if (message === 'press-again') return `Nothing is selected. Press ${key} again to ${kind} the line.`;
	return kind === 'cut' ? `Nothing is selected, so ${key} did not cut the line.` : `Nothing is selected, so ${key} did not copy the line. Your clipboard did not change.`;
}

/** The shortcut letter of a keydown, or null. Uses the physical key first, so other keyboard layouts work. */
export function shortcutKind(code: string, key: string, ctrl: boolean, meta: boolean, alt: boolean, shift: boolean, mac: boolean): Kind | null {
	const mod = mac ? meta && !ctrl : ctrl && !meta;
	if (!mod || alt || shift) return null;
	if (code === 'KeyX' || key.toLowerCase() === 'x') return 'cut';
	if (code === 'KeyC' || key.toLowerCase() === 'c') return 'copy';
	return null;
}

/**
 * The lines that the CodeMirror line cut or copy uses, the same rule as @codemirror/view (copiedRange): one entry for
 * each line that holds a cursor, in order, without duplicates. Each range ends after the line break, except on the
 * last line. text joins the lines with lineBreak. cursors are offsets in doc.
 */
export function lineRanges(doc: string, cursors: readonly number[], lineBreak = '\n'): { text: string; ranges: Array<[number, number]> } {
	const starts = [0];
	for (let i = 0; i < doc.length; i++) if (doc[i] === '\n') starts.push(i + 1);
	const lineOf = (pos: number): number => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid]! <= pos) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};
	const content: string[] = [];
	const ranges: Array<[number, number]> = [];
	let upto = -1;
	for (const c of [...cursors].sort((a, b) => a - b)) {
		const n = lineOf(Math.max(0, Math.min(doc.length, c)));
		if (n > upto) {
			const from = starts[n]!;
			const end = n + 1 < starts.length ? starts[n + 1]! - 1 : doc.length;
			content.push(doc.slice(from, end));
			ranges.push([from, Math.min(doc.length, end + 1)]);
		}
		upto = n;
	}
	return { text: content.join(lineBreak), ranges };
}
