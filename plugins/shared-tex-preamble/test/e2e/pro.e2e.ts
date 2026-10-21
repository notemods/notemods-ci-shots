import { browser, expect } from '@wdio/globals';
import { engineError, write } from './helpers';

/** Turns Pro on with a fake GitHub answer. No request goes to GitHub. */
async function fakePro(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { pro: { opts: { http: unknown }; refreshNow(): Promise<void> } }> } }).plugins.plugins['shared-tex-preamble']!;
		plugin.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		(app as unknown as { secretStorage: { setSecret(k: string, v: string): void } }).secretStorage.setSecret('shared-tex-preamble-github-token', 'gho_' + '0'.repeat(36));
		await plugin.pro.refreshNow();
	});
}

describe('shared-tex-preamble Pro', function () {
	it('without Pro, a library is not selected and the preview does not open', async function () {
		const r = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { selectLibrary(n: string): Promise<unknown>; preview(c: unknown): Promise<unknown> }> } }).plugins.plugins['shared-tex-preamble']!;
			return [await plugin.selectLibrary(''), await plugin.preview({ name: '', label: 'Macro file', path: 'x.tex' })];
		});
		expect(r).toEqual([null, null]);
	});

	it('preview lists definitions, samples and errors, and defines nothing', async function () {
		await write('Lib.tex', '\\newcommand{\\Vprev}[1]{#1^2}\n\\newcommand{\\Vbad}{\\frac{a}}\nnot a definition\n');
		await fakePro();
		const out = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { preview(c: unknown): Promise<{ contentEl: HTMLElement; close(): void } | null> }> } }).plugins.plugins['shared-tex-preamble']!;
			const modal = await plugin.preview({ name: '', label: 'Macro file', path: 'Lib.tex' });
			if (!modal) return null;
			for (let i = 0; i < 100 && modal.contentEl.dataset.state !== 'done'; i++) await new Promise((r) => setTimeout(r, 50));
			const rows = modal.contentEl.querySelectorAll('tbody tr').length;
			const summary = modal.contentEl.querySelector('.stp-summary')?.textContent ?? '';
			const errors = [...modal.contentEl.querySelectorAll('.stp-errors li')].map((li) => li.textContent);
			const state = modal.contentEl.dataset.state;
			modal.close();
			return { rows, summary, errors, state };
		});
		expect(out).not.toBeNull();
		expect(out!.state).toBe('done');
		expect(out!.rows).toBe(2);
		expect(out!.summary).toBe('2 definitions, 2 errors.');
		expect(out!.errors[0]).toContain('line 3');
		expect(out!.errors[1]).toContain('line 2: \\Vbad');
		expect(await engineError('\\Vprev{3}')).not.toBe('');
	});

	it('selects a named library and loads it', async function () {
		await write('Physics.tex', '\\newcommand{\\Vket}[1]{|#1\\rangle}\n');
		await fakePro();
		const r = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { libraries: unknown[] }; saveSettings(): Promise<void>; selectLibrary(n: string): Promise<{ status: string; loaded: string[]; path: string } | null>; pro: { signOut(): void } }> } }).plugins.plugins['shared-tex-preamble']!;
			plugin.settings.libraries = [{ name: 'Physics', path: 'Physics.tex' }];
			await plugin.saveSettings();
			const res = await plugin.selectLibrary('Physics');
			plugin.pro.signOut();
			return res;
		});
		expect(r).toMatchObject({ status: 'ok', loaded: ['Vket'], path: 'Physics.tex' });
		expect(await engineError('\\Vket{0}')).toBe('');
	});
});
