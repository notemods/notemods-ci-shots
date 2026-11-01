import { browser, expect } from '@wdio/globals';
import { WEB, cardMenu, open, readFile, setPro, waitFor, writeFile } from './helpers';
import { lastNotice, pluginId } from './load';

// The done date, checked against the real Tasks plugin the way the Kanban plugin uses it: a card that is checked
// or moved into the Complete lane gets the Tasks done date; without Tasks it gets a plain [x].
const TASKS = 'obsidian-tasks-plugin';

interface Plugins {
	enabledPlugins: Set<string>;
	plugins: Record<string, { apiV1?: unknown }>;
	enablePluginAndSave(id: string): Promise<void>;
	disablePluginAndSave(id: string): Promise<void>;
}

/** Turns the Tasks plugin on and waits until its API and its editor suggest (the settings Kanban reads) are there. */
async function tasksOn(): Promise<string> {
	return browser.executeObsidian(async ({ app }, id) => {
		const plugins = (app as unknown as { plugins: Plugins }).plugins;
		// Kanban asks enabledPlugins, which only the AndSave calls fill, like the switch in the settings.
		await plugins.enablePluginAndSave(id);
		for (let i = 0; i < 100; i++) {
			const ws = app.workspace as unknown as { editorSuggest?: { suggests?: { settings?: { taskFormat?: unknown } }[] } };
			if (plugins.plugins[id]?.apiV1 && ws.editorSuggest?.suggests?.some((x) => x.settings?.taskFormat)) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		return (window as unknown as { moment: () => { format(f: string): string } }).moment().format('YYYY-MM-DD');
	}, TASKS);
}

async function tasksOff(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => (app as unknown as { plugins: Plugins }).plugins.disablePluginAndSave(id), TASKS);
}

/** Waits until the embed on screen shows the card in the lane, checked or not, so the next action uses the redrawn card. */
async function waitCard(text: string, lane: string, checked: boolean): Promise<void> {
	await browser.waitUntil(
		() =>
			browser.execute(
				(t: string, l: string, c: boolean) => {
					const laneEl = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-lane')).filter((x) => x.offsetParent !== null).find((x) => x.dataset.lane === l);
					const card = Array.from(laneEl?.querySelectorAll<HTMLElement>('.kanban-embed-card') ?? []).find((x) => x.textContent?.includes(t));
					return card !== undefined && card.classList.contains('is-checked') === c;
				},
				text,
				lane,
				checked,
			),
		{ timeout: 8000, interval: 200, timeoutMsg: `${text} is not shown in ${lane} as ${checked ? 'checked' : 'open'}` },
	);
}

describe(`${pluginId} done date with the Tasks plugin`, function () {
	let web = '';

	before(async function () {
		await browser.executeObsidian(({ app }) => (app.vault as unknown as { setConfig(k: string, v: unknown): void }).setConfig('nativeMenus', false));
		await setPro(false);
		web = await readFile(WEB);
	});

	afterEach(async function () {
		await tasksOff();
		await setPro(false);
		await writeFile(WEB, web);
	});

	it('free: checking a card writes the Tasks done date, and unchecking it removes the date', async function () {
		const today = await tasksOn();
		expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		await open('Website project.md');
		await waitFor((x) => x.cards === 10, 'website board not drawn');
		const toggle = () =>
			browser.execute(() => {
				const cards = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-card')).filter((x) => x.offsetParent !== null);
				cards.find((c) => c.textContent?.includes('Compress hero images'))?.querySelector<HTMLInputElement>('input.kanban-embed-check')?.click();
			});
		await toggle();
		await browser.waitUntil(async () => (await readFile(WEB)).includes(`- [x] Compress hero images #perf ✅ ${today}\n`), { timeout: 8000, timeoutMsg: `no done date in the file; notice: ${await lastNotice()}` });
		expect((await readFile(WEB)).replace(` ✅ ${today}`, '').replace('- [x] Compress', '- [ ] Compress')).toBe(web);
		await waitCard('Compress hero images', 'Backlog', true);
		await toggle();
		await browser.waitUntil(async () => (await readFile(WEB)) === web, { timeout: 8000, timeoutMsg: 'unchecking did not restore the line' });
	});

	it('pro: a move into the Complete lane writes the done date and a move out removes it', async function () {
		const today = await tasksOn();
		await setPro(true);
		await open('Website project.md');
		await waitFor((x) => x.cards === 10, 'website board not drawn');
		await cardMenu('Footer links audit', 'Move to Done');
		await browser.waitUntil(async () => (await readFile(WEB)).includes(`- [x] Set up staging site #dev\n- [x] Footer links audit #content ✅ ${today}\n`), {
			timeout: 8000,
			timeoutMsg: `no done date after the move; notice: ${await lastNotice()}`,
		});
		await waitCard('Footer links audit', 'Done', true);
		await cardMenu('Footer links audit', 'Move to Backlog');
		await browser.waitUntil(async () => (await readFile(WEB)).includes('- [ ] Footer links audit #content\n'), { timeout: 8000, timeoutMsg: 'done date not removed after the move out' });
		expect(await readFile(WEB)).not.toContain('✅');
	});

	it('pro: a card added to the Complete lane gets the done date', async function () {
		const today = await tasksOn();
		await setPro(true);
		await open('Website project.md');
		await waitFor((x) => x.cards === 10, 'website board not drawn');
		await browser.execute(() => {
			const lane = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-lane')).filter((x) => x.offsetParent !== null).find((l) => l.dataset.lane === 'Done')!;
			lane.querySelector<HTMLElement>('.kanban-embed-add')!.click();
		});
		const input = await browser.$('.workspace-leaf.mod-active .markdown-reading-view .kanban-embed-add-input');
		await input.waitForDisplayed({ timeout: 5000 });
		await input.setValue('Ship the launch page');
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await readFile(WEB)).includes(`- [x] Ship the launch page ✅ ${today}\n`), { timeout: 8000, timeoutMsg: 'no done date on the added card' });
	});

	it('without the Tasks plugin the check mark is plain, as in Kanban', async function () {
		await tasksOff();
		await open('Website project.md');
		await waitFor((x) => x.cards === 10, 'website board not drawn');
		await browser.execute(() => {
			const cards = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-card')).filter((x) => x.offsetParent !== null);
			cards.find((c) => c.textContent?.includes('Compress hero images'))?.querySelector<HTMLInputElement>('input.kanban-embed-check')?.click();
		});
		await browser.waitUntil(async () => (await readFile(WEB)).includes('- [x] Compress hero images #perf\n'), { timeout: 8000, timeoutMsg: 'card not checked' });
		expect(await readFile(WEB)).not.toContain('✅');
	});
});
