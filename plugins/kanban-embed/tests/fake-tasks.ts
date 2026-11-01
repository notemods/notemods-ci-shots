// A stand-in for the Tasks plugin (apiV1.executeToggleTaskDoneCommand) for the golden vectors. It follows what Tasks
// writes with its default settings: the done date as "✅ YYYY-MM-DD" before a block link, the recurrence "🔁 every day"
// with the due date "📅" moved one day, and the new copy above the finished task (below it with recurrenceOnNextLine).
import type { TasksBridge } from '../src/done';

/** The JSON form of the fake, the third argument of a done vector. null stands for no Tasks plugin. */
export interface FakeTasksSpec {
	done?: string;
	preDone?: string;
	today: string;
	setDoneDate?: boolean;
	recurrenceOnNextLine?: boolean;
	/** The API answers with nothing, as for a line it does not know. */
	refuse?: boolean;
}

const LINE_RE = /^- \[(.)\] (.*)$/;
const BLOCK_RE = /^(.*?)( \^[A-Za-z0-9-]+)?$/;

function nextDay(iso: string): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

export function fakeTasks(spec: FakeTasksSpec | null): TasksBridge | null {
	if (spec === null) return null;
	const doneChar = spec.done ?? 'x';
	return {
		doneChar,
		preDoneChar: spec.preDone ?? ' ',
		recurrenceOnNextLine: spec.recurrenceOnNextLine === true,
		toggle(line) {
			if (spec.refuse) return null;
			const m = LINE_RE.exec(line);
			if (!m) return null;
			const [, char = ' ', rest = ''] = m;
			const [, body = '', block = ''] = BLOCK_RE.exec(rest) ?? [];
			if (char === doneChar) return `- [ ] ${body.replace(/ ✅ \d{4}-\d{2}-\d{2}$/, '')}${block}`;
			const date = spec.setDoneDate === false ? '' : ` ✅ ${spec.today}`;
			const finished = `- [${doneChar}] ${body}${date}${block}`;
			const due = /^(.*🔁 every day) 📅 (\d{4}-\d{2}-\d{2})$/.exec(body);
			if (!due) return finished;
			const fresh = `- [ ] ${due[1]} 📅 ${nextDay(due[2] ?? '')}${block}`;
			return spec.recurrenceOnNextLine ? `${finished}\n${fresh}` : `${fresh}\n${finished}`;
		},
	};
}
