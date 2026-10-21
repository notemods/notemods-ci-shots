import { browser, expect } from '@wdio/globals';
import type PocketNoteQuizPlugin from '../../src/main';
const source = 'What is ATP?\n**Energy carrier**\n\nWhat is DNA?❌\nGenetic code\n\nEmpty?\n\n```\nCode?\n```\n';
const path = 'Quiz test.md';
async function click(action: string): Promise<void> {
	const el = browser.$(`.pocket-note-quiz [data-action="${action}"]`);
	// A phone notice can cover the top of the modal.
	await browser.execute(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
	await el.waitForDisplayed(); await el.waitForEnabled();
	// The phone modal slides in. Click only after the button stops moving.
	let last = '';
	await browser.waitUntil(async () => { const at = JSON.stringify(await el.getLocation()); const still = at === last; last = at; return still; }, { interval: 150 });
	await el.click();
}
async function start(filter = 'all'): Promise<void> { await browser.executeObsidianCommand('pocket-note-quiz:start-quiz'); await click(filter); }
async function result(mark: string): Promise<void> { await click('show'); await click(mark); }
async function read(): Promise<string> { return browser.executeObsidian(async ({ app }, p) => app.vault.read(app.vault.getFileByPath(p)!), path); }
async function pro(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!;
		const m = p.pro as unknown as { opts: { http: () => Promise<unknown> }; refreshNow: () => Promise<void> };
		m.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret('pocket-note-quiz-github-token', 'gho_' + '0'.repeat(36)); await m.refreshNow();
	});
}
describe('quiz in a real vault', function () {
	beforeEach(async function () {
		await browser.executeObsidian(async ({ app }, text, path) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!;
			p.quiz?.close(); p.pro!.signOut(); p.settings = { marker: '?', presets: [] }; await p.saveSettings();
			let f = app.vault.getFileByPath(path); if (f) await app.vault.process(f, () => text); else f = await app.vault.create(path, text);
			await app.workspace.getLeaf(false).openFile(f);
			document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light');
		}, source, path);
	});
	afterEach(async function () {
		await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!; p.quiz?.close(); p.pro!.signOut();
		});
	});
	it('reveals Markdown and applies the original-format marks', async function () {
		await start(); await click('show'); expect(await browser.$('.pnq-answer strong').getText()).toBe('Energy carrier'); await click('correct');
		await result('mark-wrong'); await click('show'); expect(await browser.$('.pnq-answer').getText()).toBe('(no answer)'); await click('correct');
		expect(await browser.$('.pnq-score').getText()).toBe('2 / 3 correct'); expect(await read()).toBe(source);
		await click('apply'); await browser.$('.pnq-applied').waitForDisplayed();
		expect(await read()).toBe(source.replace('What is ATP?', 'What is ATP?✅').replace('Empty?', 'Empty?✅'));
	});
	it('wrong and unmarked filters use source marks', async function () {
		await start('wrong'); expect(await browser.$('.pnq-question').getText()).toBe('What is DNA?');
		await browser.executeObsidian(({ app }) => (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!.quiz!.close());
		await start('unmarked'); expect(await browser.$('.pnq-progress').getText()).toBe('Question 1 of 2');
	});
	it('clear removes source question marks', async function () {
		await browser.executeObsidianCommand('pocket-note-quiz:start-quiz'); await click('clear');
		await browser.waitUntil(async () => (await read()) === source.replace('❌', ''), { timeout: 10000 });
	});
	it('a changed source skips one card and shows the count', async function () {
		await start(); await result('correct'); await result('mark-wrong'); await result('correct');
		await browser.executeObsidian(async ({ app }, path) => { await app.vault.process(app.vault.getFileByPath(path)!, (s) => s.replace('What is DNA?', 'What is RNA?')); }, path);
		await click('apply'); await browser.$('.pnq-applied').waitForDisplayed();
		expect(await browser.$('.pnq-applied').getText()).toBe('Applied 2 marks; 1 skipped card.');
		expect(await read()).toBe(source.replace('What is ATP?', 'What is ATP?✅').replace('What is DNA?', 'What is RNA?').replace('Empty?', 'Empty?✅'));
		await browser.waitUntil(async () => (await browser.$$('.notice').map((e) => e.getText())).some((s) => s.includes('1 skipped card')), { timeout: 10000 });
	});
	it('new results replace an old mark', async function () {
		await start('wrong'); await result('correct'); await click('apply'); await browser.$('.pnq-applied').waitForDisplayed(); expect(await read()).toBe(source.replace('DNA?❌', 'DNA?✅'));
	});
	it('a custom marker selects Q lines', async function () {
		await browser.executeObsidian(async ({ app }, path) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!;
			p.settings.marker = 'Q:'; await p.saveSettings(); await app.vault.process(app.vault.getFileByPath(path)!, () => 'Plain?\nNo\n\nQ: A cell\nBasic unit');
		}, path);
		await start(); expect(await browser.$('.pnq-question').getText()).toBe('Q: A cell'); expect(await browser.$('.pnq-progress').getText()).toBe('Question 1 of 1');
	});
	it('signed-out Pro actions do not create reports or presets', async function () {
		const r = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!;
			const before = p.quiz; await p.startFolder(''); return { modal: p.quiz === before, report: await p.saveReport([]), preset: await p.addPreset('Test', 'Q:'), presets: p.settings.presets.length };
		}); expect(r).toEqual({ modal: true, report: null, preset: false, presets: 0 });
	});
	it('Pro loads a folder and saves a dated report', async function () {
		await pro(); const r = await browser.executeObsidian(async ({ app }) => {
			for (const path of ['Study', 'Study/sub', 'Study-other']) if (!app.vault.getFolderByPath(path)) await app.vault.createFolder(path);
			for (const [path, text] of [['Study/a.md', 'A?\na'], ['Study/sub/b.md', 'B?\nb'], ['Study-other/c.md', 'C?\nc']]) {
				const f = app.vault.getFileByPath(path!); if (f) await app.vault.process(f, () => text!); else await app.vault.create(path!, text!);
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!;
			await p.startFolder('Study'); await p.quiz!.begin('all'); const paths = p.quiz!.cards.map((c) => c.path);
			await p.quiz!.showAnswer(); await p.quiz!.respond('correct'); await p.quiz!.showAnswer(); await p.quiz!.respond('wrong');
			const report = await p.saveReport(p.quiz!.responses); return { paths, text: await app.vault.read(app.vault.getFileByPath(report!)!), report };
		}); expect(r.paths).toEqual(['Study/a.md', 'Study/sub/b.md']); expect(r.text).toContain('Correct: 1\nWrong: 1\nTotal: 2'); expect(r.report).toMatch(/^Pocket Note Quiz \d{4}-/);
	});
	it('Pro saves and uses a named marker preset', async function () {
		await pro(); const r = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!;
			await p.addPreset('Lesson', 'Q:'); await p.usePreset('Lesson'); return { marker: p.settings.marker, presets: p.settings.presets };
		}); expect(r).toEqual({ marker: 'Q:', presets: [{ name: 'Lesson', marker: 'Q:' }] });
	});
	it('closing a quiz leaves source text unchanged', async function () {
		await start(); await result('correct'); await browser.executeObsidian(({ app }) => (app as unknown as { plugins: { plugins: Record<string, PocketNoteQuizPlugin> } }).plugins.plugins['pocket-note-quiz']!.quiz!.close()); expect(await read()).toBe(source);
	});
});
