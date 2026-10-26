import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesTaskRowsPlugin, { taskBaseText } from '../src/main';
import { isPro } from '../src/pro';
import { collectTasks } from '../src/rows';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

const NOTE = '# Plan\n- [ ] Pay rent 📅 2026-10-12 #home\n- [ ] Call Ana\n';

async function makePlugin(files: Record<string, string> = { 'Plan.md': NOTE }) {
	const app = App.createConfigured__({ files });
	const plugin = new BasesTaskRowsPlugin(app as never, manifest as never);
	await plugin.onload();
	return { app, plugin };
}

const rowsOf = (content: string) => collectTasks('Plan.md', 'Plan', content, [{ line: 1, task: ' ' }, { line: 2, task: ' ' }], []);

describe('BasesTaskRowsPlugin', () => {
	it('loads default settings and registers the Task rows and Task progress views', async () => {
		const { plugin } = await makePlugin();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		const regs = (plugin as unknown as { basesViewRegistrations__: Map<string, { name: string }> }).basesViewRegistrations__;
		expect([...regs.keys()]).toEqual(['task-rows', 'task-progress']);
		expect(regs.get('task-progress')!.name).toBe('Task progress');
		expect(plugin.basesReady).toBe(true);
		expect(plugin.isPro()).toBe(false);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ dateStyle: 5, doneDate: 'sometimes' })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ dateStyle: 'dataview', doneDate: 'never' })).toEqual({ dateStyle: 'dataview', doneDate: 'never' });
	});

	it('ticks a task in the file and adds the done date to a dated line', async () => {
		const { app, plugin } = await makePlugin();
		const out = await plugin.editRows(rowsOf(NOTE).slice(0, 1), { type: 'done', today: '2026-10-10' });
		expect(out).toEqual({ written: 1, conflicts: 0 });
		const file = app.vault.getFileByPath('Plan.md')!;
		expect(await app.vault.read(file)).toBe('# Plan\n- [x] Pay rent 📅 2026-10-12 #home ✅ 2026-10-10\n- [ ] Call Ana\n');
	});

	it('writes nothing when the line changed after the view read it', async () => {
		const { app, plugin } = await makePlugin();
		const stale = rowsOf(NOTE);
		const file = app.vault.getFileByPath('Plan.md')!;
		await app.vault.modify(file, NOTE.replace('Call Ana', 'Call Ana today'));
		const out = await plugin.editRows(stale, { type: 'done', today: '2026-10-10' });
		expect(out).toEqual({ written: 1, conflicts: 1 });
		expect(await app.vault.read(file)).toBe('# Plan\n- [x] Pay rent 📅 2026-10-12 #home ✅ 2026-10-10\n- [ ] Call Ana today\n');
	});

	it('uses the Dataview style for a new date when the setting says so', async () => {
		const { app, plugin } = await makePlugin();
		plugin.settings = { ...plugin.settings, dateStyle: 'dataview' };
		await plugin.editRows(rowsOf(NOTE).slice(1), { type: 'today', today: '2026-10-10' });
		expect(await app.vault.read(app.vault.getFileByPath('Plan.md')!)).toBe('# Plan\n- [ ] Pay rent 📅 2026-10-12 #home\n- [ ] Call Ana [due:: 2026-10-10]\n');
	});

	it('writes the next occurrence of a recurring task below the done line with Pro, also for a future date', async () => {
		const note = '# Plan\n- [ ] Water plants 🔁 every week 📅 2026-10-20\n- [ ] Call Ana 🔁 every day 📅 2026-10-09\n';
		const { app, plugin } = await makePlugin({ 'Plan.md': note });
		plugin.isPro = () => true;
		const out = await plugin.editRows(rowsOf(note), { type: 'done', today: '2026-10-10' });
		expect(out).toEqual({ written: 4, conflicts: 0 });
		expect(await app.vault.read(app.vault.getFileByPath('Plan.md')!)).toBe(
			'# Plan\n- [x] Water plants 🔁 every week 📅 2026-10-20 ✅ 2026-10-10\n- [ ] Water plants 🔁 every week 📅 2026-10-27\n- [x] Call Ana 🔁 every day 📅 2026-10-09 ✅ 2026-10-10\n- [ ] Call Ana 🔁 every day 📅 2026-10-10\n',
		);
	});

	it('keeps CRLF and drops the block id on the next occurrence', async () => {
		const note = '# Plan\r\n- [ ] Pay rent 🔁 every month 📅 2026-10-01 ^rent\r\n- [ ] Call Ana\r\n';
		const { app, plugin } = await makePlugin({ 'Plan.md': note });
		plugin.isPro = () => true;
		await plugin.editRows(rowsOf(note).slice(0, 1), { type: 'done', today: '2026-10-10' });
		expect(await app.vault.read(app.vault.getFileByPath('Plan.md')!)).toBe(
			'# Plan\r\n- [x] Pay rent 🔁 every month 📅 2026-10-01 ✅ 2026-10-10 ^rent\r\n- [ ] Pay rent 🔁 every month 📅 2026-11-01\r\n- [ ] Call Ana\r\n',
		);
	});

	it('does not write a next occurrence without Pro', async () => {
		const note = '# Plan\n- [ ] Water plants 🔁 every week 📅 2026-10-09\n- [ ] Call Ana\n';
		const { app, plugin } = await makePlugin({ 'Plan.md': note });
		await plugin.editRows(rowsOf(note).slice(0, 1), { type: 'done', today: '2026-10-10' });
		expect(await app.vault.read(app.vault.getFileByPath('Plan.md')!)).toBe('# Plan\n- [x] Water plants 🔁 every week 📅 2026-10-09 ✅ 2026-10-10\n- [ ] Call Ana\n');
	});

	it('writes a base file text with a folder filter, the task view and the Task progress view', () => {
		expect(taskBaseText('Projects')).toBe(
			'filters:\n  and:\n    - file.inFolder("Projects")\nviews:\n  - type: task-rows\n    name: Tasks\n    status: open\n    sort: due\n  - type: task-progress\n    name: Task progress\n    sort: progress\n',
		);
		expect(taskBaseText('/')).not.toContain('filters');
	});

	it('a done edit leaves closed tasks alone: no cancelled task turns done and no second next occurrence', async () => {
		const note = '# Plan\n- [-] Dropped 📅 2026-10-01\n- [x] Water plants 🔁 every week 📅 2026-10-01\n';
		const { app, plugin } = await makePlugin({ 'Plan.md': note });
		plugin.isPro = () => true;
		const out = await plugin.editRows(rowsOf(note), { type: 'done', today: '2026-10-10' });
		expect(out).toEqual({ written: 0, conflicts: 0 });
		expect(await app.vault.read(app.vault.getFileByPath('Plan.md')!)).toBe(note);
	});

	it('an open edit leaves open tasks alone', async () => {
		const note = '# Plan\n- [ ] Pay rent ✅ 2026-10-01\n- [ ] Call Ana\n';
		const { app, plugin } = await makePlugin({ 'Plan.md': note });
		const out = await plugin.editRows(rowsOf(note), { type: 'open' });
		expect(out).toEqual({ written: 0, conflicts: 0 });
		expect(await app.vault.read(app.vault.getFileByPath('Plan.md')!)).toBe(note);
	});
});
