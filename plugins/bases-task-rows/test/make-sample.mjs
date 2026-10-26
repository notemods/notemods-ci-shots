// Writes the sample vault: 30 notes with 150 checklist tasks, plus four base files.
//   node test/make-sample.mjs            -> docs/sample-notes/ and test/e2e/vault/Bases Task Rows/
// Dates sit around 2026-10-10 so every date group (overdue, today, next 7 days, later) has rows.
// One note uses CRLF line ends and one has a task inside a code block (not a task; the cache skips it).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIR = 'Bases Task Rows';
const BASE_DAY = Date.UTC(2026, 9, 10);
const day = (n) => new Date(BASE_DAY + n * 86_400_000).toISOString().slice(0, 10);

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];

const PROJECTS = ['Website relaunch', 'Garden shed', 'Tax return 2026', 'Kitchen remodel', 'Book club', 'Spanish course', 'Photo archive', 'Team offsite', 'Podcast pilot', 'Bike tune up'];
const VERBS = ['Draft', 'Review', 'Send', 'Order', 'Call', 'Book', 'Fix', 'Write', 'Plan', 'Check', 'Update', 'Clean up', 'Print', 'Pay', 'Ask about'];
const THINGS = ['the budget', 'the outline', 'quotes from two shops', 'the invoice', 'the venue', 'paint samples', 'the backup drive', 'chapter notes', 'the new logo', 'the brake pads', 'the meeting notes', 'the guest list', 'receipts', 'the contract', 'the photo index'];
const TAGS = ['work', 'home', 'errand', 'money', 'people', 'waiting', 'work/design', 'home/garden'];
const PRIO = ['', '', '', '', ' ⏫', ' 🔼', ' 🔽', ' 🔺'];

/** One task line in Tasks emoji format or Dataview format, chosen by style. */
function task(style, i) {
	const done = rand() < 0.25;
	const text = `${pick(VERBS)} ${pick(THINGS)}`;
	const tag = rand() < 0.7 ? ` #${pick(TAGS)}` : '';
	const r = rand();
	const due = r < 0.15 ? null : day(Math.floor(rand() * 24) - 8);
	const sched = rand() < 0.3 ? day(Math.floor(rand() * 10) - 3) : null;
	if (style === 'dataview') {
		const p = rand() < 0.2 ? ` [priority:: ${pick(['high', 'low', 'medium'])}]` : '';
		const parts = [text + tag, due && `[due:: ${due}]`, sched && `[scheduled:: ${sched}]`].filter(Boolean).join(' ');
		return `- [${done ? 'x' : ' '}] ${parts}${p}${done ? ` [completion:: ${day(-1 - (i % 5))}]` : ''}`;
	}
	const prio = pick(PRIO);
	const parts = `${text}${tag}${prio}${sched ? ` ⏳ ${sched}` : ''}${due ? ` 📅 ${due}` : ''}`;
	return `- [${done ? 'x' : ' '}] ${parts}${done ? ` ✅ ${day(-1 - (i % 5))}` : ''}`;
}

function notes() {
	const out = [];
	let n = 0;
	PROJECTS.forEach((name, k) => {
		const style = k % 3 === 2 ? 'dataview' : 'emoji';
		const lines = [`---`, `type: project`, `status: ${pick(['active', 'active', 'paused'])}`, `---`, ``, `# ${name}`, ``, `Goal and notes for ${name.toLowerCase()}.`, ``, `## Next steps`, ``];
		for (let i = 0; i < 3; i++) lines.push(task(style, n++));
		lines.push('', '## Later', '');
		for (let i = 0; i < 2; i++) lines.push(task(style, n++));
		if (k === 0) lines.push('', 'A code sample, not a task:', '', '```md', '- [ ] this line is code', '```');
		out.push([`Projects/${name}.md`, lines.join(k === 4 ? '\r\n' : '\n') + (k === 4 ? '\r\n' : '\n')]);
	});
	for (let k = 0; k < 10; k++) {
		const date = day(-12 + k);
		const lines = [`---`, `type: meeting`, `date: ${date}`, `---`, ``, `# Meeting ${date}`, ``, `## Decisions`, ``, `- Keep the weekly slot.`, ``, `## Action items`, ``];
		for (let i = 0; i < 5; i++) lines.push(task(k % 2 ? 'dataview' : 'emoji', n++));
		out.push([`Meetings/Meeting ${date}.md`, lines.join('\n') + '\n']);
	}
	for (let k = 0; k < 10; k++) {
		const date = day(-9 + k);
		const lines = [`# ${date}`, ``, `## Today`, ``];
		for (let i = 0; i < 3; i++) lines.push(task('emoji', n++));
		lines.push('', '## Inbox', '', '- an idea without a checkbox');
		for (let i = 0; i < 2; i++) lines.push(task('emoji', n++));
		out.push([`Daily/${date}.md`, lines.join('\n') + '\n']);
	}
	return { out, count: n };
}

const BASES = {
	'All tasks.base': `filters:\n  and:\n    - file.inFolder("${DIR}")\nviews:\n  - type: task-rows\n    name: All tasks\n    status: all\n    rowSort: due\n`,
	'This week.base': `filters:\n  and:\n    - file.inFolder("${DIR}")\nviews:\n  - type: task-rows\n    name: By date\n    status: open\n    rowSort: due\n    group: date\n  - type: task-rows\n    name: By tag\n    status: open\n    rowSort: priority\n    group: tag\n`,
	'Project tasks.base': `filters:\n  and:\n    - file.inFolder("${DIR}/Projects")\nviews:\n  - type: task-rows\n    name: By project\n    status: open\n    rowSort: due\n    group: note\n  - type: table\n    name: Notes\n    order:\n      - file.name\n      - status\n`,
	'Project progress.base': `filters:\n  and:\n    - file.inFolder("${DIR}/Projects")\nviews:\n  - type: task-progress\n    name: Task progress\n    progressSort: progress\n  - type: task-rows\n    name: Tasks\n    status: all\n    rowSort: file\n  - type: task-progress\n    name: Waiting\n    progressSort: note\n    tag: waiting\n`,
};

const { out, count } = notes();
if (out.length !== 30 || count !== 150) throw new Error(`expected 30 notes and 150 tasks, got ${out.length} and ${count}`);
for (const target of [join(ROOT, 'docs', 'sample-notes'), join(ROOT, 'test', 'e2e', 'vault', DIR)]) {
	rmSync(target, { recursive: true, force: true });
	for (const [rel, text] of [...out, ...Object.entries(BASES)]) {
		mkdirSync(dirname(join(target, rel)), { recursive: true });
		writeFileSync(join(target, rel), text);
	}
}
console.log(`sample: ${out.length} notes, ${count} tasks, ${Object.keys(BASES).length} bases`);
