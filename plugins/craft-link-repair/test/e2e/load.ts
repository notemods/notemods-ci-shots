import { browser } from '@wdio/globals';
import { readFileSync } from 'node:fs';
export const pluginId = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { id: string }).id;
export interface Plan { folder: string; copies: { source: string; path: string; text: string }[]; blocked: string[]; issues: { source: string; url: string; reason: string }[]; changes: unknown[]; skipped: string[] }
export interface TestPlugin {
	settings: { folder: string; outputFolder: string; dateFolder: string; dateFormat: string; automatic: boolean };
	receipts: Record<string, string>;
	pro: { opts: { http: (request: unknown) => Promise<unknown> }; signOut(): void; refreshNow(): Promise<unknown>; isPro(): boolean };
	lastResult: { written: string[]; failures: string[]; report: string } | null;
	prepare(folder: string): Promise<Plan>;
	writePlan(plan: Plan): Promise<{ written: string[]; failures: string[]; report: string }>;
	runAutomatic(): Promise<unknown>;
	saveSettings(): Promise<void>;
}
export interface TestPlugins { enabledPlugins: Set<string>; plugins: Record<string, TestPlugin>; disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<boolean> }
export async function reloadPlugin(id: string) {
	return browser.executeObsidian(async ({ app }, pluginId) => {
		const plugins = (app as unknown as { plugins: TestPlugins }).plugins;
		const errors: string[] = [];
		const original = console.error;
		const onError = (e: ErrorEvent) => errors.push(e.message);
		const onReject = (e: PromiseRejectionEvent) => errors.push(String(e.reason));
		console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); original(...args); };
		window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onReject);
		try {
			const enabled = plugins.enabledPlugins.has(pluginId) && pluginId in plugins.plugins;
			await plugins.disablePlugin(pluginId); const reloaded = await plugins.enablePlugin(pluginId);
			return { enabled, reloaded, errors };
		} finally { console.error = original; window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onReject); }
	}, id);
}
export async function resetSettings(folder: string, pro = false): Promise<void> {
	await browser.executeObsidian(async ({ app }, folder, proEnabled) => {
		const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair'];
		p.pro.signOut(); p.receipts = {}; p.lastResult = null;
		p.settings = { folder, outputFolder: '', dateFolder: '', dateFormat: 'YYYY-MM-DD', automatic: false };
		if (proEnabled) {
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'test-sponsor' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('craft-link-repair-github-token', 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow(); if (!p.pro.isPro()) throw new Error('Local sponsor fixture did not enable Pro');
		}
		await p.saveSettings();
	}, folder, pro);
}

/** Vault.create returns a registered TFile, including JSON on older releases. */
export async function writeFixture(path: string, text: string): Promise<void> {
	await browser.executeObsidian(async ({ app, obsidian }, path, text) => {
		const parts = path.split('/'); parts.pop();
		let folder = '';
		for (const part of parts) {
			folder = obsidian.normalizePath(folder ? `${folder}/${part}` : part);
			if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
		}
		const file = app.vault.getFileByPath(path);
		if (file) await app.vault.process(file, () => text);
		else await app.vault.create(path, text);
	}, path, text);
}
