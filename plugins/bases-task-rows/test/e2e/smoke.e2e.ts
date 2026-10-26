import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
import { DIR, clickInRow, openBase, readNote, today, viewState, waitRows } from './rows';

// Free features in a real Obsidian: rows from the sample vault (30 notes, 150 tasks), tick writes the file,
// stale lines are not written, live update, and the 200-row cap.
const SITE = `${DIR}/Projects/Website relaunch.md`;
const CLUB = `${DIR}/Projects/Book club.md`;

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('shows one row per task: 150 rows for 30 notes, none for the task inside a code block', async function () {
		const s = await openBase('All tasks.base', 150);
		expect(s.info).toBe('150 tasks');
		expect(s.ids).not.toContain(`${SITE}#23`);
		expect(new Set(s.ids.map((id) => id.split('#')[0])).size).toBe(30);
	});

	it('ticking a row writes x and a done date to that line and nothing else', async function () {
		const before = await readNote(SITE);
		const lines = before.split('\n');
		expect(lines[11]).toBe('- [ ] Plan the photo index #people ⏳ 2026-10-16 📅 2026-10-23');
		await clickInRow(`${SITE}#11`, 'input.task-list-item-checkbox');
		const want = [...lines];
		want[11] = `- [x] Plan the photo index #people ⏳ 2026-10-16 📅 2026-10-23 ✅ ${await today()}`;
		await browser.waitUntil(async () => (await readNote(SITE)) === want.join('\n'), { timeout: 5000, timeoutMsg: 'line not written' });
		await browser.waitUntil(async () => (await viewState())?.rows === 150, { timeout: 5000 });
	});

	it('unticking removes the done date again, so the note is byte-identical to the start', async function () {
		const s = await viewState();
		expect(s?.ids).toContain(`${SITE}#11`);
		await clickInRow(`${SITE}#11`, 'input.task-list-item-checkbox');
		await browser.waitUntil(async () => (await readNote(SITE)).split('\n')[11] === '- [ ] Plan the photo index #people ⏳ 2026-10-16 📅 2026-10-23', { timeout: 5000 });
	});

	it('keeps CRLF line ends when it writes to a CRLF note', async function () {
		const before = await readNote(CLUB);
		expect(before.includes('\r\n')).toBe(true);
		const idx = before.split('\n').findIndex((l) => l.startsWith('- [ ] '));
		await clickInRow(`${CLUB}#${idx}`, 'input.task-list-item-checkbox');
		await browser.waitUntil(async () => (await readNote(CLUB)) !== before, { timeout: 5000 });
		const after = (await readNote(CLUB)).split('\n');
		expect(after[idx]!.startsWith('- [x] ')).toBe(true);
		expect(after[idx]!.endsWith('\r')).toBe(true);
		expect(after.filter((l, i) => i !== idx)).toEqual(before.split('\n').filter((l, i) => i !== idx));
	});

	it('does not write a line that changed after the view read it, and says so', async function () {
		const out = await browser.executeObsidian(async ({ app }, id, path) => {
			interface Row {
				path: string;
				line: number;
				raw: string;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<{ rows: Row[] }>; editRows(r: Row[], e: unknown): Promise<unknown> }> } }).plugins.plugins[id]!;
			const view = [...p.views][0]!;
			const row = view.rows.find((r) => r.path === path && r.raw.startsWith('- [ ] '))!;
			const file = app.vault.getFileByPath(path)!;
			const lines = (await app.vault.read(file)).split('\n');
			lines[row.line] = `${lines[row.line]} edited elsewhere`;
			await app.vault.modify(file, lines.join('\n'));
			const result = await p.editRows([{ ...row }], { type: 'done', today: '2026-10-10' });
			const notices = Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? '');
			return { result, line: (await app.vault.read(file)).split('\n')[row.line], notices };
		}, pluginId, SITE);
		expect(out.result).toEqual({ written: 0, conflicts: 1 });
		expect(out.line?.startsWith('- [ ] ')).toBe(true);
		expect(out.line?.endsWith(' edited elsewhere')).toBe(true);
		expect(out.notices.some((t) => t.includes('changed in the note'))).toBe(true);
	});

	it('updates the rows when a note gains a task', async function () {
		await browser.executeObsidian(async ({ app }, path) => {
			const file = app.vault.getFileByPath(path)!;
			await app.vault.process(file, (t) => `${t}- [ ] Added from outside 📅 2026-10-11\n`);
		}, SITE);
		await waitRows(151);
	});

	it('after a plugin reload with the base open, the view runs the new plugin code and follows note edits', async function () {
		const before = await readNote(SITE);
		await openBase('All tasks.base', 151);
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		// viewState() only sees views of the loaded plugin, so a stale view of the old code times out here.
		await waitRows(151);
		await obsidianPage.write(SITE, `${before}\n- [ ] Added after the reload 📅 2026-10-12\n`);
		await waitRows(152);
		await obsidianPage.write(SITE, before);
		await waitRows(151);
	});

	it('without Pro shows the first 200 tasks and says how many it hides', async function () {
		const many = Array.from({ length: 230 }, (_, i) => `- [ ] Task ${i} 📅 2026-11-${String((i % 28) + 1).padStart(2, '0')}`).join('\n');
		await obsidianPage.write(`${DIR}/Cap/Many.md`, `# Many\n${many}\n`);
		await obsidianPage.write(`${DIR}/Cap.base`, `filters:\n  and:\n    - file.inFolder("${DIR}/Cap")\nviews:\n  - type: task-rows\n    name: Cap\n    status: all\n`);
		const s = await openBase('Cap.base', 200);
		expect(s.info).toBe('Showing 200 of 230 tasks. Pro shows every task.');
	});
});
