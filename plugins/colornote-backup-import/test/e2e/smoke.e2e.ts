import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { pluginId, reloadPlugin } from './load';
const demo = JSON.parse(readFileSync('tests/fixtures/demo.json', 'utf8')) as { before: string; after: string };

async function choose(base64: string, label = 'Backup', password = '1234'): Promise<void> {
	await browser.executeObsidian((_ctx, base64, label, password) => {
		const input = document.querySelector<HTMLInputElement>(`input[type=file][aria-label="${label}"]`)!;
		const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'sample.backup'));
		input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
		const pass = document.querySelector<HTMLInputElement>(`input[aria-label="${label} password"]`)!;
		pass.value = password; pass.dispatchEvent(new Event('input', { bubbles: true }));
	}, base64, label, password);
}
async function click(text: string): Promise<void> {
	await browser.executeObsidian((_ctx, text) => { const button = [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent === text); if (!button) throw new Error(`Missing button ${text}`); button.click(); }, text);
}
async function statusContains(text: string, selector = '.colornote-status'): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian((_ctx, text, selector) => document.querySelector(selector)?.textContent?.includes(text) ?? false, text, selector), { timeout: 15000, timeoutMsg: `Missing status ${text}` });
}
async function close(): Promise<void> { await browser.executeObsidian(({ app }) => { const p = (app as unknown as { plugins: { plugins: Record<string, { modals: Set<{ close(): void }> }> } }).plugins.plugins['colornote-backup-import']!; for (const modal of [...p.modals]) modal.close(); }); }

describe(`${pluginId} import`, function () {
	it('is enabled and reloads with no console errors', async function () { expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] }); });
	it('rejects a wrong password and writes no import folder', async function () {
		await browser.executeObsidianCommand(`${pluginId}:import-backup`);
		await choose(demo.before, 'Backup', 'wrong'); await click('Decode and review'); await statusContains('padding is invalid');
		const folder = await browser.executeObsidian(({ app }) => app.vault.getAbstractFileByPath('ColorNote imports') !== null); expect(folder).toBe(false); await close();
	});
	it('imports notes with checklist text, source metadata and an omission report offline', async function () {
		await browser.executeObsidianCommand(`${pluginId}:import-backup`);
		await choose(demo.before); await click('Decode and review'); await statusContains('Decoded records 8');
		await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { opts: { http: unknown } } }> } }).plugins.plugins['colornote-backup-import']!;
			p.pro.opts.http = async () => { (window as unknown as { __cnRequests: number }).__cnRequests++; throw new Error('Network is disabled for this test'); };
			const w = window as unknown as { fetch: typeof fetch; __cnFetch: typeof fetch; __cnRequests: number };
			w.__cnFetch = w.fetch; w.__cnRequests = 0; w.fetch = (() => { w.__cnRequests++; throw new Error('Network is disabled for this test'); }) as typeof fetch;
		});
		try {
			await click('Import notes'); await statusContains('Import complete');
			const result = await browser.executeObsidian(async ({ app }) => {
				const text = document.querySelector('.colornote-status')!.textContent!; const root = text.split('Notes and report: ')[1]!;
				const files = app.vault.getFiles().filter((f) => f.path.startsWith(root + '/'));
				const bodies = await Promise.all(files.map(async (f) => ({ path: f.path, body: await app.vault.read(f), ctime: f.stat.ctime, mtime: f.stat.mtime })));
				const password = document.querySelector<HTMLInputElement>('input[aria-label="Backup password"]')!.value;
				return { bodies, password, requests: (window as unknown as { __cnRequests: number }).__cnRequests };
			});
			expect(result.bodies).toHaveLength(4); expect(result.password).toBe(''); expect(result.requests).toBe(0);
			const shopping = result.bodies.find((f) => f.path.endsWith('/Shopping list demo-002.md'))!;
			expect(shopping.body).toContain('- [ ] Apples\n- [x] Bread'); expect(shopping.body).toContain('source_uuid: demo-002');
			expect(shopping.body).toContain('created:'); expect(shopping.body).toContain('color_index: 1');
			const plans = result.bodies.filter((f) => /Travel plan demo-00[13]\.md$/.test(f.path)); expect(plans).toHaveLength(2);
			const report = result.bodies.find((f) => f.path.endsWith('/Import report.md'))!.body;
			for (const kind of ['system', 'locked', 'archive', 'trash', 'unsupported']) expect(report).toContain(`${kind}: 1`);
			expect(report).not.toContain('1234'); expect(report).not.toContain('Sample omitted body.');
		} finally {
			await browser.executeObsidian(() => { const w = window as unknown as { fetch: typeof fetch; __cnFetch: typeof fetch }; w.fetch = w.__cnFetch; }); await close();
		}
	});
	it('clears password fields on close and refuses Pro comparison while signed out', async function () {
		await browser.executeObsidianCommand(`${pluginId}:import-backup`); await choose(demo.before);
		await browser.executeObsidian(() => { (window as unknown as { __cnPassword: HTMLInputElement }).__cnPassword = document.querySelector<HTMLInputElement>('input[aria-label="Backup password"]')!; });
		await close();
		expect(await browser.executeObsidian(() => (window as unknown as { __cnPassword: HTMLInputElement }).__cnPassword.value)).toBe('');
		await browser.executeObsidianCommand(`${pluginId}:compare-backups`);
		expect(await browser.executeObsidian(() => document.querySelector('.colornote-import') !== null)).toBe(false);
	});
	it('shows changed text with the same Sponsors adapter used by the settings', async function () {
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { opts: { http: unknown }; refreshNow(): Promise<unknown> } }> } }).plugins.plugins['colornote-backup-import']!;
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('colornote-backup-import-github-token', 'gho_' + '0'.repeat(36)); await p.pro.refreshNow();
		});
		await browser.executeObsidianCommand(`${pluginId}:compare-backups`); await choose(demo.before, 'Earlier backup'); await choose(demo.after, 'Later backup'); await click('Compare note text'); await statusContains('1 changed', '.colornote-diff');
		const text = await browser.executeObsidian(() => document.querySelector('.colornote-diff')!.textContent!);
		expect(text).toContain('demo-001'); expect(text).toContain('Train at 09:30'); expect(text).toContain('Train at 10:15'); await close();
		await browser.executeObsidian(({ app }) => { const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins['colornote-backup-import']!; p.pro.signOut(); });
	});
});
