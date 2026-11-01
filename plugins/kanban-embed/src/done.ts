// Pure logic for completing a card, the way the Kanban plugin (2.0.51) does it. No Obsidian imports.
// Kanban does not write a done date itself. When the Tasks plugin is on, it hands the card line to
// Tasks (apiV1.executeToggleTaskDoneCommand), so the line gets the done date, the status symbols and the
// recurrence of the user's Tasks settings. Without Tasks it writes a plain [x] or [ ]. This file does the same
// and leaves the Tasks call itself to src/tasks.ts, so the golden vectors can use a fake Tasks.

/** What Kanban reads from the Tasks plugin. `toggle` is apiV1.executeToggleTaskDoneCommand with the file path bound. */
export interface TasksBridge {
	/** Symbol of the DONE status, "x" by default. */
	doneChar: string;
	/** Symbol of the status whose next status is DONE, " " by default. A card in this status is toggled to done. */
	preDoneChar: string;
	/** Tasks setting: the new copy of a recurring task goes below the finished one. */
	recurrenceOnNextLine: boolean;
	/** Returns the line or lines (joined by a line break) that Tasks writes for a toggle, or null when it is no task. */
	toggle(line: string): string | null;
}

/** The blocks of lines that replace one card. `main` is the finished card. The others are new copies of a recurring task. */
export interface Marked {
	/** Blocks in the order Tasks gave them. */
	all: string[][];
	/** Index in `all` of the card that was checked or unchecked. */
	main: number;
	/** True when something changed. */
	changed: boolean;
}

const FIRST_RE = /^([-*+] )\[(.)\]( ?)(.*)$/;
const TASK_RE = /^- \[([^\]]+)\]/;
const TASK_STRIP_RE = /^- \[[^\]]+\] */;

/** The symbol of a finished card without Tasks. */
export const PLAIN_DONE = 'x';

/** Line with the check symbol changed. Other lines stay as they are. */
export function withChar(line: string, char: string): string {
	return line.replace(/^([-*+] )\[.\]/, (_m, head: string) => `${head}[${char}]`);
}

/**
 * Hands the first line of a card to Tasks as "- [char] text", like Kanban does, and rebuilds one block per
 * line Tasks returns. Continuation lines of the card go with every block. Returns null when Tasks does not know
 * the line, so the caller writes a plain check mark.
 */
function viaTasks(block: string[], char: string, bridge: TasksBridge): { all: string[][]; main: number } | null {
	const m = FIRST_RE.exec(block[0] ?? '');
	if (!m) return null;
	const out = bridge.toggle(`- [${char}] ${m[4] ?? ''}`);
	if (!out) return null;
	const rest = block.slice(1);
	const tail = bridge.recurrenceOnNextLine;
	let main = 0;
	const all: string[][] = [];
	for (const [g, h] of out.split(/\n/g).entries()) {
		const c = TASK_RE.exec(h)?.[1];
		if (c === undefined) return null;
		// Kanban: the finished card is the first line when the new copy goes below it, else the last line.
		if ((tail && g === 0) || (!tail && g > 0)) main = g;
		all.push([`${m[1] ?? '- '}[${c}] ${h.replace(TASK_STRIP_RE, '')}`, ...rest]);
	}
	return { all, main };
}

/**
 * Checks or unchecks a card block. With a bridge to Tasks the card gets the done date and the recurrence of
 * the Tasks settings, as in Kanban. A card that is already in the wanted state is left alone.
 */
export function markDone(block: string[], wantDone: boolean, bridge: TasksBridge | null): Marked {
	const same: Marked = { all: [block], main: 0, changed: false };
	const m = FIRST_RE.exec(block[0] ?? '');
	if (!m) return same;
	const cur = m[2] ?? ' ';
	const doneChar = bridge?.doneChar ?? PLAIN_DONE;
	if (wantDone ? cur === doneChar : cur === ' ') return same;
	if (bridge && (wantDone || cur === doneChar)) {
		// To done: start from the status before DONE, so Tasks finishes it. Away from done: Tasks toggles it back.
		const r = viaTasks(block, wantDone ? bridge.preDoneChar : cur, bridge);
		if (r) return { ...r, changed: true };
	}
	return { all: [[withChar(block[0] ?? '', wantDone ? doneChar : ' '), ...block.slice(1)]], main: 0, changed: true };
}
