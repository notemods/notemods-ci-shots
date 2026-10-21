import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId } from './load';

// Real-app checks of the solve modal. Each wait is on a state (an element, a value), not on a fixed time.
const NOTE = 'Solve test.md';
const TEXT = 'Force: F=m*a here\nSecond line.\n';

/** Opens the test note with TEXT and selects the characters [from, to) of line 0. */
async function openWithSelection(from: number, to: number): Promise<void> {
	await obsidianPage.write(NOTE, TEXT);
	await obsidianPage.openFile(NOTE);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() === 'Force: F=m*a here\nSecond line.\n'), { timeout: 15000, timeoutMsg: 'note did not open' });
	await browser.executeObsidian(({ app }, a, b) => app.workspace.activeEditor?.editor?.setSelection({ line: 0, ch: a }, { line: 0, ch: b }), from, to);
}

async function noteText(): Promise<string> {
	return browser.executeObsidian(async ({ app }, path) => {
		const f = app.vault.getFileByPath(path);
		return f ? app.vault.read(f) : '';
	}, NOTE);
}

async function openModal(): Promise<void> {
	await browser.executeObsidianCommand(`${pluginId}:solve`);
	await browser.$('.pss-modal .pss-equation').waitForExist({ timeout: 10000 });
}

async function typeInto(selector: string, value: string): Promise<void> {
	const el = browser.$(selector);
	await el.clearValue();
	await el.setValue(value);
	await browser.waitUntil(async () => (await el.getValue()) === value, { timeout: 5000, timeoutMsg: `${selector} did not take ${value}` });
}

/** Taps Solve and waits until the modal marks the result as done (preview, note and buttons are final). */
async function solve(): Promise<void> {
	await browser.$('.pss-modal .pss-result[data-state="done"]').waitForExist({ reverse: true, timeout: 5000 });
	await browser.$('.pss-modal .pss-solve').click();
	await browser.$('.pss-modal .pss-result[data-state="done"]').waitForExist({ timeout: 30000, timeoutMsg: 'no solve result' });
}

async function closeModal(): Promise<void> {
	if (await browser.$('.pss-modal .pss-cancel').isExisting()) await browser.$('.pss-modal .pss-cancel').click();
	await browser.$('.pss-modal').waitForExist({ reverse: true, timeout: 5000 });
}

async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

describe('solve modal', function () {
	afterEach(async function () {
		await closeModal();
	});

	it('prefills the selection, previews F/m with MathJax and inserts it only after Insert (acceptance 3 and 9)', async function () {
		await openWithSelection(7, 12);
		await openModal();
		expect(await browser.$('.pss-modal .pss-equation').getValue()).toBe('F=m*a');
		await typeInto('.pss-modal .pss-symbol', 'a');
		await solve();
		expect(await noteText()).toBe(TEXT);
		expect(await browser.$$('.pss-modal .pss-solution').length).toBe(1);
		await browser.$('.pss-modal .pss-solution mjx-container').waitForExist({ timeout: 10000 });
		expect(await browser.$('.pss-modal .pss-solution .pss-text').getText()).toBe('a = F*m^-1');
		await browser.waitUntil(async () => browser.$('.pss-modal .pss-insert').isEnabled(), { timeout: 5000 });
		await browser.$('.pss-modal .pss-insert').click();
		await browser.$('.pss-modal').waitForExist({ reverse: true, timeout: 5000 });
		await browser.waitUntil(async () => (await noteText()) === 'Force: $$a = \\frac{F}{m}$$ here\nSecond line.\n', { timeout: 10000, timeoutMsg: `note is ${await noteText()}` });
	});

	it('Cancel keeps the note byte-identical (acceptance 10)', async function () {
		await openWithSelection(7, 12);
		await openModal();
		await typeInto('.pss-modal .pss-symbol', 'a');
		await solve();
		await browser.$('.pss-modal .pss-cancel').click();
		await browser.$('.pss-modal').waitForExist({ reverse: true, timeout: 5000 });
		const text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');
		expect(text).toBe(TEXT);
		expect(await noteText()).toBe(TEXT);
	});

	it('shows clear errors, keeps Insert off and leaves the note unchanged (acceptance 7 and 8)', async function () {
		await openWithSelection(0, 0);
		await openModal();
		await typeInto('.pss-modal .pss-equation', '2*y=4');
		await typeInto('.pss-modal .pss-symbol', 'x');
		await solve();
		expect(await browser.$('.pss-modal .pss-error').getText()).toBe('x is not in the equation');
		expect(await browser.$('.pss-modal .pss-insert').isEnabled()).toBe(false);
		await typeInto('.pss-modal .pss-equation', '((x');
		await solve();
		expect(await browser.$('.pss-modal .pss-error').getText()).toBe('Cannot parse the equation');
		expect(await browser.$('.pss-modal .pss-insert').isEnabled()).toBe(false);
		await closeModal();
		expect(await noteText()).toBe(TEXT);
	});

	it('lists both roots of a quadratic and marks complex roots (acceptance 2 and 5)', async function () {
		await openWithSelection(0, 0);
		await openModal();
		await typeInto('.pss-modal .pss-equation', 'x^2-5*x+6=0');
		await typeInto('.pss-modal .pss-symbol', 'x');
		await solve();
		const roots = await browser.$$('.pss-modal .pss-solution .pss-text').map((e) => e.getText());
		expect(roots).toEqual(['x = 2', 'x = 3']);
		await typeInto('.pss-modal .pss-equation', 'x^2+1=0');
		await solve();
		expect(await browser.$$('.pss-modal .pss-solution .pss-text').map((e) => e.getText())).toEqual(['x = i', 'x = -i']);
		expect(await browser.$('.pss-modal .pss-note').getText()).toContain('complex');
	});

	it('stops a solve that does not end (x^x^x=5) at a 1 second limit, then solves again with a new worker', async function () {
		await openWithSelection(0, 0);
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, { runner: { timeoutMs: number } }> } }).plugins.plugins[id]!.runner.timeoutMs = 1000;
		}, pluginId);
		try {
			await openModal();
			await typeInto('.pss-modal .pss-equation', 'x^x^x=5');
			await typeInto('.pss-modal .pss-symbol', 'x');
			await solve();
			expect(await browser.$('.pss-modal .pss-error').getText()).toBe('The solve took longer than 1 second and was stopped');
		} finally {
			await browser.executeObsidian(({ app }, id) => {
				(app as unknown as { plugins: { plugins: Record<string, { runner: { timeoutMs: number } }> } }).plugins.plugins[id]!.runner.timeoutMs = 30000;
			}, pluginId);
		}
		await typeInto('.pss-modal .pss-equation', 'v=u+a*t');
		await typeInto('.pss-modal .pss-symbol', 't');
		await solve();
		expect(await browser.$('.pss-modal .pss-solution .pss-text').getText()).toBe('t = -a^-1*(u-v)');
		expect(await noteText()).toBe(TEXT);
	});

	it('history search is Pro; with Pro the table inserts a Markdown table and the search finds the solve', async function () {
		await openWithSelection(7, 12);
		await setPro(false);
		await browser.executeObsidianCommand(`${pluginId}:search-history`);
		await browser.waitUntil(async () => (await lastNotice()).includes('is a pro feature'), { timeout: 5000 });
		await setPro(true);
		try {
			await openModal();
			await typeInto('.pss-modal .pss-symbol', 'a');
			await solve();
			await typeInto('.pss-modal .pss-table', 'F, m\n10, 2');
			await browser.waitUntil(async () => browser.$('.pss-modal .pss-insert-table').isEnabled(), { timeout: 5000 });
			await browser.$('.pss-modal .pss-insert-table').click();
			await browser.$('.pss-modal').waitForExist({ reverse: true, timeout: 10000 });
			await browser.waitUntil(async () => (await noteText()).includes('| 10 | 2 | 5 |'), { timeout: 10000, timeoutMsg: `note is ${await noteText()}` });
			expect(await noteText()).toBe('Force: F=m*a here\n\n| F | m | a |\n| --- | --- | --- |\n| 10 | 2 | 5 |\n\nSecond line.\n');
			await browser.executeObsidianCommand(`${pluginId}:search-history`);
			await browser.$('.prompt-input').waitForExist({ timeout: 5000 });
			await browser.$('.prompt-input').setValue('F=m*a');
			await browser.waitUntil(async () => (await browser.$$('.pss-history-item').length) > 0, { timeout: 5000, timeoutMsg: 'no history item' });
			expect(await browser.$('.pss-history-item').getText()).toContain('F=m*a');
			await browser.keys('Escape');
			await browser.$('.prompt-input').waitForExist({ reverse: true, timeout: 5000 });
		} finally {
			await setPro(false);
		}
	});
});
