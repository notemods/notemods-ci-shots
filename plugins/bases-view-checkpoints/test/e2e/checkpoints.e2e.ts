import { browser, expect } from '@wdio/globals';
import type BasesViewCheckpointsPlugin from '../../src/main';
import { pluginId } from './load';

const BASE = 'Checkpoints.base';
const START = 'formulas:\n  total: "1 + 1"\nviews:\n  - type: table\n    name: Alpha\n    order: [file.name]\n    sort: [{property: file.name, direction: ASC}]\n  - type: table\n    name: Beta\n    filters: \'status == "todo"\'\n';
const EDIT = START.replace('direction: ASC', 'direction: DESC').replace('status == "todo"', 'status == "done"').replace('1 + 1', '2 + 2');

async function action(op: string, text = '') {
	return browser.executeObsidian(async ({ app }, id, path, operation, value) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesViewCheckpointsPlugin> } }).plugins.plugins[id]!;
		const file = app.vault.getFileByPath(path)!;
		if (operation === 'reset') {
			p.pro!.signOut(); p.data = { free: {}, named: {}, undo: null };
			await p.saveSettings(); await app.vault.modify(file, value);
		}
		if (operation === 'write') await app.vault.modify(file, value);
		if (operation === 'save') await p.save(file, 'Alpha');
		if (operation === 'restore') await p.restoreForFile(path, 'Alpha');
		if (operation === 'preview') await p.restore(Object.values(p.data.free)[0]!);
		if (operation === 'undo') return { message: await p.undoForFile(), text: await app.vault.read(file), count: Object.keys(p.data.free).length };
		if (operation === 'reload') await p.loadSettings();
		if (operation === 'pro') {
			p.pro!.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36)); await p.pro!.refreshNow();
		}
		if (operation === 'off') p.pro!.signOut();
		if (operation === 'named') await p.save(file, 'Alpha', value);
		if (operation === 'compare') await p.compare(Object.values(p.data.free)[0]!);
		if (operation === 'named-restore') await p.restore(Object.values(p.data.named)[0]!);
		if (operation === 'rename') {
			await app.vault.rename(file, 'Renamed.base');
			const moved = Object.values(p.data.free)[0]!;
			await p.restoreForFile('Renamed.base', 'Alpha'); await app.vault.rename(file, path);
			return { message: moved.path, text: await app.vault.read(file), count: Object.keys(p.data.free).length };
		}
		return { message: Object.values(p.data.named).map(cp => cp.label).join(', '), text: await app.vault.read(file), count: Object.keys(p.data.free).length };
	}, pluginId, BASE, op, text);
}

async function choose(text: string): Promise<void> {
	const input = await browser.$('.prompt-input'); await input.waitForDisplayed(); await input.setValue(text);
	await browser.waitUntil(async () => browser.execute((value) => [...document.querySelectorAll('.suggestion-item')].some(el => el.textContent?.includes(value)), text), { timeout: 10000 });
	await browser.keys('Enter');
}
async function confirm(): Promise<void> {
	const button = await browser.$('.modal button.mod-cta'); await button.waitForDisplayed(); await button.click();
}
async function noticeContains(text: string): Promise<void> {
	await browser.waitUntil(async () => browser.execute((value) => [...document.querySelectorAll('.notice')].some(el => el.textContent?.includes(value)), text), { timeout: 10000 });
}

describe(`${pluginId} checkpoints`, function () {
	beforeEach(async () => {
		await browser.keys('Escape');
		await browser.execute(() => document.querySelectorAll('.notice').forEach(el => el.remove()));
		await action('reset', START);
	});
	it('saves with the pickers and restores with the preview', async () => {
		await browser.executeObsidianCommand(`${pluginId}:save-checkpoint`); await choose(BASE);
		await browser.waitUntil(async () => (await browser.$('.prompt-input').getAttribute('placeholder')) === 'Select a view', { timeout: 10000 });
		await choose('Alpha');
		await browser.waitUntil(async () => (await action('state')).count === 1, { timeout: 10000 });
		await action('write', EDIT);
		await browser.executeObsidianCommand(`${pluginId}:restore-checkpoint`); await choose('Alpha');
		const list = await browser.$('.checkpoint-changes'); await list.waitForDisplayed();
		expect(await list.getText()).toContain('Alpha.sort'); expect(await list.getText()).toContain('formulas');
		expect(await browser.$('.modal-content').getText()).toContain('other views');
		await confirm(); await noticeContains('Restored view "Alpha".');
		const text = (await action('state')).text;
		expect(text).toContain('direction: ASC'); expect(text).toContain('status == "done"'); expect(text).toContain('1 + 1');
	});
	it('undo restores the exact text before restore', async () => {
		await action('save'); await action('write', EDIT); await action('restore');
		expect((await action('undo')).text).toBe(EDIT);
		expect((await action('undo')).message).toBe('There is no undo copy for this view.');
	});
	it('refuses undo after an edit', async () => {
		await action('save'); await action('write', EDIT); await action('restore');
		const changed = (await action('state')).text + '# Later edit\n'; await action('write', changed);
		const state = await action('undo'); expect(state.message).toContain('undo was refused'); expect(state.text).toBe(changed);
	});
	it('refuses a stale preview', async () => {
		await action('save'); await action('write', EDIT); await action('preview'); await browser.$('.checkpoint-changes').waitForDisplayed();
		const changed = EDIT + '# Edit after preview\n'; await action('write', changed); await confirm();
		await noticeContains('changed after the preview'); expect((await action('state')).text).toBe(changed);
	});
	it('cancels a preview without writing', async () => {
		await action('save'); await action('write', EDIT); await action('preview'); await browser.$('.checkpoint-changes').waitForDisplayed();
		await browser.keys('Escape'); expect((await action('state')).text).toBe(EDIT);
	});
	it('restores a deleted view and keeps Beta', async () => {
		await action('save'); await action('write', 'views: [{type: table, name: Beta}]\n'); await action('restore');
		const text = (await action('state')).text; expect(text).toContain('name: Beta'); expect(text).toContain('name: Alpha');
	});
	it('keeps groupOrder null entries and unknown keys', async () => {
		const source = 'customTop: keep\nviews:\n  - name: Alpha\n    type: table\n    groupOrder: [B, null, A]\n    customView: 7\n';
		await action('write', source); await action('save');
		await action('write', source.replace('customView: 7', 'customView: 9').replace('customTop: keep', 'customTop: edited')); await action('restore');
		const text = (await action('state')).text; expect(text).toContain('customTop: edited'); expect(text).toContain('customView: 7');
		expect(text).toMatch(/groupOrder:\s*\n\s*- B\s*\n\s*- null\s*\n\s*- A/);
	});
	it('removes a shared filter added after save and lists it in the preview', async () => {
		await action('save');
		await action('write', 'filters: \'status == "done"\'\n' + START);
		await action('preview');
		await browser.$('.checkpoint-changes').waitForDisplayed();
		expect(await browser.$('.checkpoint-changes').getText()).toContain('filters');
		await confirm(); await noticeContains('Restored view "Alpha".');
		expect((await action('state')).text).not.toMatch(/^filters:/m);
	});
	it('follows a vault rename', async () => { await action('save'); expect((await action('rename')).message).toBe('Renamed.base'); });
	it('keeps saved data after reload', async () => { await action('save'); await action('reload'); expect((await action('state')).count).toBe(1); });
	it('refuses invalid YAML and duplicate view names', async () => {
		for (const text of ['views: [oops\n', 'views: [{name: Alpha}, {name: Alpha}]\n']) {
			await browser.execute(() => document.querySelectorAll('.notice').forEach(el => el.remove()));
			await action('write', text); await browser.executeObsidianCommand(`${pluginId}:save-checkpoint`); await choose(BASE);
			await noticeContains('invalid YAML or two views'); expect((await action('state')).text).toBe(text); expect((await action('state')).count).toBe(0);
		}
	});
	it('saves named checkpoints and compares with Pro, then blocks named restore after sign out', async () => {
		await action('save'); await action('pro'); await action('named', 'Weekly'); await action('named', 'Monthly');
		expect((await action('state')).message).toBe('Weekly, Monthly');
		await action('write', EDIT); await action('compare'); await browser.$('.checkpoint-changes').waitForDisplayed();
		expect(await browser.$('.checkpoint-changes').getText()).toContain('formulas');
		await browser.keys('Escape'); await action('off'); await action('named-restore'); await noticeContains('Pro feature');
		expect((await action('state')).text).toBe(EDIT);
	});
});
