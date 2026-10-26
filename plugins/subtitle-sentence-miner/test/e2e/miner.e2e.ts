import { browser, expect } from '@wdio/globals';
import type SubtitleSentenceMinerPlugin from '../../src/main';
import type { MinerModal } from '../../src/ui';
import { pluginId, reloadPlugin } from './load';

const select = (key: string) => `[data-ssm="${key}"]`;

async function openSource(path = 'French.srt'): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, path) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id];
		const file = app.vault.getFiles().find((f) => f.path === path);
		if (!file) throw new Error(`Missing fixture ${path}`);
		await p.openSource(file);
	}, pluginId, path);
	await browser.$('.ssm-miner').waitForDisplayed();
}

async function read(path: string): Promise<string | null> {
	return browser.executeObsidian(async ({ app }, path) => {
		const file = app.vault.getFileByPath(path);
		return file ? app.vault.read(file) : null;
	}, path);
}

async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, active) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id];
		if (!p.pro) throw new Error('Sponsors manager missing');
		if (!active) { p.pro.signOut(); return; }
		p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 500 }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
	}, pluginId, on);
}

async function setCloze(): Promise<void> {
	const buttons = await browser.$$(select('edit-cue'));
	await buttons[1].click();
	await browser.$('.ssm-answer').waitForDisplayed();
	await browser.execute(() => {
		const text = document.querySelector<HTMLTextAreaElement>('[data-ssm="span-text"]')!;
		text.focus(); text.setSelectionRange(6, 11);
	});
	await browser.$(select('save-cloze')).click();
	await browser.$('.ssm-answer').waitForExist({ reverse: true });
}

async function preview(): Promise<void> {
	await browser.$(select('preview')).click();
	await browser.$('.ssm-preview').waitForDisplayed();
}

describe('local subtitle card workflow', function () {
	beforeEach(async function () {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id];
			for (const modal of [...p.miners]) modal.close();
			p.settings.outputPath = 'Cards.md';
		}, pluginId);
		await setPro(false);
	});

	it('the command lists in-vault subtitles and opens one', async function () {
		await browser.executeObsidianCommand(`${pluginId}:mine-subtitles`);
		const input = await browser.$('.prompt-input');
		await input.waitForDisplayed(); await input.setValue('French');
		await browser.$('.suggestion-item').waitForDisplayed();
		expect(await browser.$('.suggestion-item').getText()).toContain('French.srt');
		await input.addValue('\uE007');
		await browser.$('.ssm-miner').waitForDisplayed();
		expect(await browser.$$('.ssm-cue').length).toBe(6);
	});

	it('loads SRT numbers and both times through the real Vault API', async function () {
		await openSource();
		const cue = await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id];
			return [...p.miners][0].entries[0].cue;
		}, pluginId);
		expect(cue).toEqual({ number: 1, identifier: '1', start: 1, end: 3.5, text: 'Bonjour. Comment allez-vous ?' });
	});

	it('loads VTT two-line text without header or layout settings', async function () {
		await openSource('Travel.vtt');
		expect(await browser.$$('.ssm-cue').length).toBe(2);
		expect(await browser.$('.ssm-text').getText()).toBe('Where is the station?\nOù est la gare ?');
		expect(await browser.$('.ssm-source').getText()).toContain('00:00:25.000');
	});

	it('reports a bad cue and keeps the next valid cue', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.create('Malformed.srt', '1\nwrong --> time\nBad\n\n2\n00:00:04,000 --> 00:00:05,000\nGood');
		});
		await openSource('Malformed.srt');
		expect(await browser.$$('.ssm-cue').length).toBe(1);
		await browser.$('.ssm-warnings summary').click();
		expect(await browser.$('.ssm-warnings').getText()).toContain('Skipped malformed cue 1.');
		expect(await browser.$('.ssm-text').getText()).toBe('Good');
	});

	it('filters case insensitively and keeps a hidden selection', async function () {
		await openSource(); await setCloze();
		await browser.$(select('filter')).setValue('BONJOUR');
		expect(await browser.$$('.ssm-cue').length).toBe(1);
		expect(await browser.$('.ssm-text').getText()).toContain('Bonjour.');
		expect(await browser.$('.ssm-summary').getText()).toContain('1 selected');
	});

	it('previews an exact cloze span and cancels without a write', async function () {
		const before = await read('French.srt');
		await openSource(); await setCloze(); await preview();
		const text = await browser.$('.ssm-markdown').getText();
		for (const value of ['Hello {{c1::world}}.', 'Source path: French.srt', 'Cue number: 2', 'Start: 00:00:04.000', 'End: 00:00:06.250']) expect(text).toContain(value);
		await browser.$(select('cancel-export')).click();
		expect(await read('Cards.md')).toBeNull(); expect(await read('French.srt')).toBe(before);
	});

	it('previews question and answer as separate fields', async function () {
		await openSource(); await browser.$(select('edit-cue')).click();
		await browser.$('.ssm-answer').waitForDisplayed();
		await browser.$(select('question')).setValue('What greeting?');
		await browser.$(select('answer')).setValue('Bonjour');
		await browser.$(select('save-qa')).click(); await preview();
		const text = await browser.$('.ssm-markdown').getText();
		expect(text).toContain('Question: What greeting?'); expect(text).toContain('Answer: Bonjour'); expect(text).toContain('Source path: French.srt');
	});

	it('creates a numbered note without replacing an existing file or source', async function () {
		const before = await read('French.srt');
		await browser.executeObsidian(async ({ app }) => { await app.vault.create('Cards.md', 'Keep existing note.'); });
		await openSource(); await setCloze(); await preview();
		expect(await browser.$(select('output-path')).getValue()).toBe('Cards 2.md');
		await browser.$(select('create-note')).click();
		await browser.waitUntil(async () => (await read('Cards 2.md')) !== null, { timeout: 10000 });
		expect(await read('Cards.md')).toBe('Keep existing note.'); expect(await read('French.srt')).toBe(before);
		expect(await read('Cards 2.md')).toContain('Hello {{c1::world}}.');
	});

	it('requires a second confirmation for a path conflict after preview', async function () {
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id].settings.outputPath = 'Race.md';
		}, pluginId);
		await openSource(); await setCloze(); await preview();
		await browser.executeObsidian(async ({ app }) => { await app.vault.create('Race.md', 'Created while preview was open.'); });
		await browser.$(select('create-note')).click();
		expect(await browser.$(select('output-path')).getValue()).toBe('Race 2.md'); expect(await read('Race 2.md')).toBeNull();
		await browser.$(select('create-note')).click();
		await browser.waitUntil(async () => (await read('Race 2.md')) !== null, { timeout: 10000 });
		expect(await read('Race.md')).toBe('Created while preview was open.');
	});

	it('free mode refuses Pro actions and makes no Sponsors request', async function () {
		await openSource();
		const state = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id];
			let requests = 0;
			p.pro!.opts.http = async () => { requests++; throw new Error('Unexpected network request'); };
			await p.pro!.refresh();
			const modal = [...p.miners][0];
			await modal.addSource(app.vault.getFileByPath('Travel.vtt')!);
			let templateBlocked = false;
			try { await p.saveTemplate({ name: 'Blocked', body: '{{sentence}}' }); } catch { templateBlocked = true; }
			return { requests, count: modal.entries.length, templateBlocked };
		}, pluginId);
		expect(state).toEqual({ requests: 0, count: 6, templateBlocked: true });
	});

	it('saves and applies a Pro template through the user controls', async function () {
		await setPro(true); await openSource();
		await browser.$(select('save-template')).click();
		await browser.$(select('template-name')).waitForDisplayed();
		await browser.$(select('template-name')).setValue('Study');
		await browser.$(select('template-body')).setValue('Front: {{sentence}}\nBack: {{answer}}');
		await browser.$(select('template-save')).click();
		await browser.waitUntil(async () => await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id];
			return p.settings.templates.some((t) => t.name === 'Study') && p.miners.size === 0;
		}, pluginId), { timeout: 10000 });
		await openSource(); await setCloze();
		await browser.$(select('template')).selectByAttribute('value', 'Study'); await preview();
		const text = await browser.$('.ssm-markdown').getText();
		expect(text).toContain('Front: Hello {{c1::world}}.'); expect(text).toContain('Back: world'); expect(text).toContain('Source path: French.srt');
	});

	it('combines two sources with Pro and blocks creation after sign out', async function () {
		await setPro(true); await openSource(); await setCloze();
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SubtitleSentenceMinerPlugin> } }).plugins.plugins[id];
			const m: MinerModal = [...p.miners][0];
			await m.addSource(app.vault.getFileByPath('Travel.vtt')!);
			m.entries[6].selected = true; m.entries[6].answer = { kind: 'qa', question: 'Where?', answer: 'Où est la gare ?' }; m.drawList();
			p.settings.outputPath = 'Combined.md';
		}, pluginId);
		await preview(); const text = await browser.$('.ssm-markdown').getText();
		expect(text).toContain('Source path: French.srt'); expect(text).toContain('Source path: Travel.vtt');
		await setPro(false); await browser.$(select('create-note')).click();
		await browser.waitUntil(async () => (await browser.$('.ssm-export-status').getText()).includes('need Pro'), { timeout: 5000 });
		expect(await read('Combined.md')).toBeNull();
		await setPro(true); await browser.$(select('create-note')).click();
		await browser.waitUntil(async () => (await read('Combined.md')) !== null, { timeout: 10000 });
		expect(await read('Combined.md')).toContain('Source path: Travel.vtt');
	});

	it('reload closes the cue list and its answer editor', async function () {
		await openSource(); await browser.$(select('edit-cue')).click();
		await browser.$('.ssm-answer').waitForDisplayed();
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
		expect(await browser.$('.ssm-miner').isExisting()).toBe(false); expect(await browser.$('.ssm-answer').isExisting()).toBe(false);
	});
});
