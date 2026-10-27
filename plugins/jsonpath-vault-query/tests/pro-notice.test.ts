import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Modal, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import QueryPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { QueryView } from '../src/view';
import manifest from '../manifest.json';

// A free user who selects "Run saved query on files" or "Write report" gets the shared Pro notice with the
// "Sponsor on GitHub" button. No file is read or written, and the shown result stays.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const BATCH = 'A saved query on several files needs Pro.';
const REPORT = 'New report files need Pro.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'jsonpath-vault-query' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'a.json': '[1, 2]', 'b.json': '[3]' } });
	const plugin = new QueryPlugin(app as never, manifest as never);
	await plugin.saveQuery({ name: 'All', path: 'a.json', expression: '@' });
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const view = Object.create(QueryView.prototype) as QueryView;
	Object.assign(view, { owner: plugin, app, contentEl: createDiv(), path: 'a.json', expression: '@', savedName: 'All', batchPaths: 'a.json\nb.json', reportName: 'Query report', result: undefined, error: '', revision: 0 });
	view.draw();
	await view.run();
	return { plugin, view, shown };
}
const button = (view: QueryView, text: string) => [...view.contentEl.querySelectorAll('button')].find((b) => b.textContent === text)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Pro buttons of the query view', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Run saved query on files or Write report gets the Pro notice with a Sponsor button, and nothing is read or written', async () => {
		const { plugin, view, shown } = await setup(false);
		const files = vi.spyOn(plugin, 'queryFiles');
		const write = vi.spyOn(plugin, 'writeReport');
		const open = vi.spyOn(Modal.prototype, 'open');
		button(view, 'Run saved query on files').click(); await flush();
		button(view, 'Write report').click(); await flush();
		expect(shown).toEqual([
			{ text: `${BATCH} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${REPORT} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(files).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
		// The free result of the one-file query stays.
		expect(view.result).toEqual([1, 2]);
		expect(view.contentEl.querySelector('.local-json-error')).toBeNull();
	});

	it('a Pro user runs the saved query on files and opens the report window, with no Pro notice', async () => {
		const { plugin, view, shown } = await setup(true);
		const files = vi.spyOn(plugin, 'queryFiles');
		const open = vi.spyOn(Modal.prototype, 'open').mockImplementation(() => undefined);
		button(view, 'Run saved query on files').click();
		await vi.waitFor(() => { expect(view.result).toEqual([1, 2, 3]); });
		expect(files).toHaveBeenCalledWith(['a.json', 'b.json'], '@');
		button(view, 'Write report').click();
		expect(open).toHaveBeenCalledTimes(1);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
	});
});
