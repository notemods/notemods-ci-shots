import { describe, expect, it } from 'vitest';
import { App, BasesEntry, BasesQueryResult, BasesViewConfig } from 'obsidian-test-mocks/obsidian';
import BasesTaskRowsPlugin from '../src/main';
import { TaskRowsView } from '../src/view';
import manifest from '../manifest.json';

const FILES = {
	'P/a.md': '# A\n- [ ] Pay rent 📅 2026-10-12 #home\n- [x] Ship v2 ✅ 2026-10-01\n',
	'P/b.md': '## Calls\n- [ ] Call Ana [due:: 2026-10-09] #people\n```\n- [ ] code\n```\n',
	'P/none.md': 'no tasks here\n',
};

async function setup(files: Record<string, string> = FILES, options: Record<string, unknown> = { status: 'all' }) {
	const app = App.createConfigured__({ files });
	const plugin = new BasesTaskRowsPlugin(app as never, manifest as never);
	await plugin.onload();
	const reg = (plugin as unknown as { basesViewRegistrations__: Map<string, { factory: (c: unknown, el: HTMLElement) => TaskRowsView }> }).basesViewRegistrations__.get('task-rows')!;
	const el = document.createElement('div');
	document.body.appendChild(el);
	const view = reg.factory({} as never, el);
	const v = view as unknown as { app: unknown; config: BasesViewConfig; data: BasesQueryResult };
	v.app = app;
	v.config = BasesViewConfig.create__('', 'task-rows', 'Tasks');
	for (const [k, val] of Object.entries(options)) v.config.set(k, val);
	const result = BasesQueryResult.create__(app, v.config, [], []);
	result.setData__(Object.keys(files).map((p) => BasesEntry.create__({}, app.vault.getFileByPath(p)!)));
	v.data = result;
	view.load();
	await view.reload();
	return { app, plugin, view, el };
}

const texts = (el: HTMLElement) => Array.from(el.querySelectorAll('tr.btr-row .btr-text')).map((x) => x.textContent);

describe('TaskRowsView in the mock app', () => {
	it('shows one row per task line from the cache, sorted by due date', async () => {
		const { el, view } = await setup();
		expect(texts(el)).toEqual(['Call Ana', 'Pay rent', 'Ship v2']);
		expect(view.shownIds()).toEqual(['P/b.md#1', 'P/a.md#1', 'P/a.md#2']);
		expect(el.querySelector('.btr-info')!.textContent).toBe('3 tasks');
		expect(Array.from(el.querySelectorAll('tr.btr-row td.btr-col-heading')).map((x) => x.textContent)).toEqual(['Calls', 'A', 'A']);
	});

	it('the open filter hides done tasks, and the search box filters by words', async () => {
		const { el, view } = await setup(FILES, { status: 'open' });
		expect(view.shownIds()).toEqual(['P/b.md#1', 'P/a.md#1']);
		const s = el.querySelector<HTMLInputElement>('.btr-search')!;
		s.value = '#home';
		s.dispatchEvent(new Event('input'));
		expect(view.shownIds()).toEqual(['P/a.md#1']);
	});

	it('ticking the box writes the line', async () => {
		const { app, el } = await setup();
		const box = el.querySelector<HTMLInputElement>('tr[data-id="P/a.md#1"] input.task-list-item-checkbox')!;
		box.checked = true;
		box.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 50));
		expect((await app.vault.read(app.vault.getFileByPath('P/a.md')!)).split('\n')[1]).toMatch(/^- \[x\] Pay rent 📅 2026-10-12 #home ✅ \d{4}-\d{2}-\d{2}$/);
	});

	it('without Pro caps the rows at 200 and ignores a saved group', async () => {
		const many = Array.from({ length: 260 }, (_, i) => `- [ ] t${i}`).join('\n');
		const { el, view } = await setup({ 'm.md': `${many}\n` }, { status: 'all', group: 'date' });
		expect(view.shownIds().length).toBe(200);
		expect(el.querySelectorAll('tr.btr-group').length).toBe(0);
		expect(el.querySelector('.btr-info')!.textContent).toContain('Showing 200 of 260 tasks.');
	});

	it('with Pro shows every row, groups by date and shows the select and today controls', async () => {
		const many = Array.from({ length: 260 }, (_, i) => `- [ ] t${i}`).join('\n');
		const { el, view, plugin } = await setup({ 'm.md': `${many}\n- [ ] late 📅 2020-01-01\n` }, { status: 'all', group: 'date' });
		(plugin.pro as unknown as { isPro: () => boolean }).isPro = () => true;
		view.render();
		expect(view.shownIds().length).toBe(261);
		expect(Array.from(el.querySelectorAll('tr.btr-group td')).map((x) => x.textContent)).toEqual(['Overdue (1)', 'No date (260)']);
		expect(el.querySelectorAll('button.btr-today').length).toBe(261);
		expect(el.querySelector('button.btr-bulk-done')).not.toBeNull();
	});

	it('renders 2,000 rows (happy-dom, a rough upper bound for the real app)', async () => {
		const files: Record<string, string> = {};
		for (let n = 0; n < 100; n++) files[`n${n}.md`] = Array.from({ length: 20 }, (_, i) => `- [ ] Task ${n}-${i} #t${i % 5} 📅 2026-10-${String((i % 28) + 1).padStart(2, '0')}`).join('\n') + '\n';
		const { view, plugin } = await setup(files, { status: 'all' });
		(plugin.pro as unknown as { isPro: () => boolean }).isPro = () => true;
		view.render();
		expect(view.timing.rows).toBe(2000);
	}, 30000);

	it('reads the rows again when the metadata cache catches up after a write', async () => {
		const note = '- [ ] A\n- [ ] B\n- [ ] C\n';
		const { app, view } = await setup({ 'm.md': note }, { status: 'all', sort: 'file' });
		const file = app.vault.getFileByPath('m.md')!;
		const cache = (app.metadataCache as unknown as { cache__: Map<string, unknown> }).cache__;
		const old = cache.get('m.md');
		// In the real app the cache parses a changed note later than the vault write.
		await app.vault.modify(file, `- [ ] New\n${note}`);
		const fresh = cache.get('m.md');
		cache.set('m.md', old);
		await view.reload();
		(app.metadataCache as unknown as { setCache__: (p: string, c: unknown) => void }).setCache__('m.md', fresh);
		await view.reload();
		expect(view.rows.map((r) => r.info.text)).toEqual(['New', 'A', 'B', 'C']);
	});

	it('drops a selection when lines above it move, so a bulk action never edits another task', async () => {
		const note = '- [ ] A\n- [ ] B\n- [ ] C\n';
		const { app, view, el, plugin } = await setup({ 'm.md': note }, { status: 'all', sort: 'file' });
		(plugin.pro as unknown as { isPro: () => boolean }).isPro = () => true;
		view.render();
		view.selected.add('m.md#2');
		const file = app.vault.getFileByPath('m.md')!;
		await app.vault.modify(file, `- [ ] New\n${note}`);
		await view.reload();
		el.querySelector<HTMLButtonElement>('button.btr-bulk-done')!.click();
		await new Promise((r) => setTimeout(r, 50));
		expect(await app.vault.read(file)).toBe(`- [ ] New\n${note}`);
	});
});
